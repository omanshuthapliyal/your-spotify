import { beforeAll, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { aggregate, type AggregateSettings } from '../../src/core/aggregate';
import { buildGenreGrouping, parseCsv, parseGenreCsv, UNCLASSIFIED } from '../../src/core/genres';
import type { PlayStore } from '../../src/core/importer';
import { EXPECTED } from '../../fixtures/synthetic';
import { importFixture } from './helpers';

const csv = readFileSync(join(import.meta.dirname, '..', '..', 'fixtures', 'genres_sample.csv'), 'utf8');
const base: AggregateSettings = { granularity: 'quarter', metric: 'hours', topN: 8, minMs: 30_000, range: null };
const H = 3_600_000;
let store: PlayStore;
beforeAll(async () => {
  store = (await importFixture()).store;
});

describe('parseGenreCsv', () => {
  it('parses quotes, header, multiple genres per row and repeated artist rows', () => {
    expect(parseCsv('a,"b, c"\n"say ""hi""",d\r\n')).toEqual([['a', 'b, c'], ['say "hi"', 'd']]);
    const m = parseGenreCsv(csv);
    expect(m.genresByArtist.get('Artist B')).toEqual(['Electronic', 'Pop']);
    expect(m.genresByArtist.get('Artist D')).toEqual(['Jazz', 'Soul']);
    // capitalisation variants merge to the first spelling, with a warning
    expect(m.genresByArtist.get('Artist C')).toEqual(['Indie Rock']);
    expect(m.issues.some((i) => i.includes('capitalisation'))).toBe(true);
    expect(m.issues.some((i) => i.includes('"Artist D" appears on several rows'))).toBe(true);
    expect(m.issues.some((i) => i.includes('"Artist E" has no genre'))).toBe(true);
    expect(m.genresByArtist.has('Artist E')).toBe(false);
  });
});

describe('genre aggregation', () => {
  it('reconciles genre totals with artist totals and keeps Unclassified visible', () => {
    const info = buildGenreGrouping(store, parseGenreCsv(csv));
    const g = aggregate(store, base, info.grouping);
    const a = aggregate(store, base);
    expect(g.included).toEqual(a.included);
    expect(g.included.ms).toBe(EXPECTED.acceptedMs);
    g.periods.forEach((p, i) => {
      expect(g.series.reduce((s, x) => s + x.ms[i], 0)).toBeCloseTo(p.ms, 6);
      expect(p.ms).toBe(a.periods[i].ms);
    });
    const un = g.series.find((s) => s.kind === 'unclassified')!;
    expect(un.label).toBe(UNCLASSIFIED);
    // Unclassified = E, F..J, Sigur Rós (exact name not in CSV), Boundary Artist. Not folded into Other.
    expect(g.series.find((s) => s.kind === 'other')).toBeUndefined();
    const coverage = 1 - un.totalMs / g.included.ms;
    expect(coverage).toBeGreaterThan(0.6);
    expect(coverage).toBeLessThan(1);
  });

  it('splits multi-genre artists equally so nothing is double counted', () => {
    const info = buildGenreGrouping(store, parseGenreCsv(csv));
    const g = aggregate(store, base, info.grouping);
    const byLabel = Object.fromEntries(g.series.map((s) => [s.label, s]));
    // Artist B: 740 plays (37 h) split into Electronic and Pop
    expect(byLabel['Electronic'].totalMs / H).toBeCloseTo(18.5, 9);
    expect(byLabel['Pop'].totalMs / H).toBeCloseTo(18.5, 9);
    expect(byLabel['Electronic'].totalPlays).toBeCloseTo(370, 9);
    // Indie Rock = Artist A (30 h) + Artist C (12 h)
    expect(byLabel['Indie Rock'].totalMs / H).toBeCloseTo(42, 9);
    expect(info.multiGenreArtists).toBe(2);
  });

  it('reports near matches and unmatched CSV rows without applying them', () => {
    const info = buildGenreGrouping(store, parseGenreCsv(csv.replace('Sigur Ros,Post-Rock', 'sigur ros,Post-Rock')));
    expect(info.nearMatches).toEqual([{ csv: 'sigur ros', exported: ['Sigur Ros', 'Sigur Rós'] }]);
    expect(info.unmatchedCsvArtists).toEqual(['Not In Export']);
    const g = aggregate(store, base, info.grouping);
    expect(g.series.find((s) => s.label === 'Post-Rock')).toBeUndefined();
  });

  it('groups extra genres into Other genres when top N is small', () => {
    const info = buildGenreGrouping(store, parseGenreCsv(csv));
    const g = aggregate(store, { ...base, topN: 2 }, info.grouping);
    expect(g.series.map((s) => s.kind)).toEqual(['item', 'item', 'other', 'unclassified']);
    g.periods.forEach((p, i) => expect(g.series.reduce((s, x) => s + x.ms[i], 0)).toBeCloseTo(p.ms, 6));
  });
});
