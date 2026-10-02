import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Engine, type Query } from '../../src/worker/engine';
import { FAKE_SENSITIVE, EXPECTED } from '../../fixtures/synthetic';
import type { TreeData } from '../../src/core/genreTree';
import { fixtureInputs } from './helpers';

const settings = { granularity: 'quarter' as const, metric: 'hours' as const, topN: 5, minMs: 30_000, range: null };
const q = (kind: Query['kind'], extra: Partial<Query> = {}): Query => ({ settings, kind, ...extra });
const csv = readFileSync(join(import.meta.dirname, '..', '..', 'fixtures', 'genres_sample.csv'), 'utf8');
const tree: TreeData = { genres: {
  'indie rock': { parents: [{ name: 'rock', rel: 'subgenre' }] }, rock: { parents: [] },
  electronic: { parents: [] }, pop: { parents: [] }, jazz: { parents: [] }, soul: { parents: [] },
} };
const H = 3_600_000;

async function engine(withGenres = false) {
  const e = new Engine();
  await e.import(fixtureInputs());
  if (withGenres) {
    e.setEnrichment(tree, 'artist,formed_year\nArtist A,1991\nArtist B,2005\n', 'album,artist,year\nArtist A Album,Artist A,1994\n');
    e.setGenres(csv);
  }
  return e;
}

describe('Engine (worker core)', () => {
  it('returns only compact aggregates with no sensitive fields', async () => {
    const e = await engine();
    const r = e.aggregate(q('artist'));
    const d = e.details(q('artist'), 'other', 0);
    const payload = JSON.stringify({ r, d, t: e.table(q('track')), x: e.entity('artist', 0, settings) });
    for (const v of Object.values(FAKE_SENSITIVE)) expect(payload).not.toContain(v);
    expect(r.series.every((s) => s.ms.length === r.periods.length)).toBe(true);
  });

  it('details for a series and period reconcile with the aggregate', async () => {
    const e = await engine();
    const r = e.aggregate(q('artist'));
    for (const s of r.series) {
      expect(e.details(q('artist'), s.key, 0).ms).toBeCloseTo(s.ms[0], 6);
      expect(e.details(q('artist'), s.key, null).ms).toBeCloseTo(s.totalMs, 6);
    }
    const b = r.series.find((s) => s.label === 'Artist B')!;
    expect(e.details(q('artist'), b.key, 1).topTracks.map((t) => t.name)).toEqual(['Artist B Song 1', 'Artist B Song 2', 'Artist B Song 3']);
    expect(e.details(q('artist'), 'other', 0).topArtists.map((a) => a.name)).toEqual(['Artist F', 'Artist G', 'Artist H', 'Artist I', 'Artist J']);
  });

  it('keeps artist colors stable across settings changes', async () => {
    const e = await engine();
    const slot = (r: ReturnType<Engine['aggregate']>) => Object.fromEntries(r.series.map((s) => [s.label, s.colorSlot]));
    const a = slot(e.aggregate(q('artist')));
    const b = slot(e.aggregate({ ...q('artist'), settings: { ...settings, granularity: 'month', topN: 8, metric: 'share' } }));
    for (const k of Object.keys(a)) if (k !== 'Other artists') expect(b[k]).toBe(a[k]);
  });

  it('groups by album and by track, labelled with the artist, and totals reconcile', async () => {
    const e = await engine();
    for (const kind of ['album', 'track'] as const) {
      const r = e.aggregate(q(kind, { settings: { ...settings, topN: 3 } }));
      expect(r.included.ms).toBe(EXPECTED.acceptedMs);
      r.periods.forEach((p, i) => expect(r.series.reduce((s, x) => s + x.ms[i], 0)).toBeCloseTo(p.ms, 6));
    }
    const albums = e.aggregate(q('album', { settings: { ...settings, topN: 2 } }));
    expect(albums.series.slice(0, 2).map((s) => s.label)).toEqual(['Artist B Album · Artist B', 'Artist A Album · Artist A']);
    const tracks = e.table(q('track'));
    expect(tracks.rows[0]).toMatchObject({ sub: 'Artist B' });
    expect(tracks.total).toBe(36 - 1); // every track with a 30 s+ play; Artist C's short plays are on Song 1 which also has long plays
  });

  it('tables rank items with first/last play, peak and share', async () => {
    const e = await engine(true);
    const t = e.table(q('artist'));
    expect(t.rows[0]).toMatchObject({ name: 'Artist B', peak: '2020 Q4', genre: 'Electronic, Pop', year: 2005 });
    expect(t.rows[1]).toMatchObject({ name: 'Artist A', peak: '2019 Q1', year: 1991, distinctTracks: 3 });
    expect(t.rows.reduce((s, r) => s + r.share, 0)).toBeCloseTo(1, 9);
    const al = e.table(q('album'));
    expect(al.rows.find((r) => r.name === 'Artist A Album')!.year).toBe(1994);
    // Fixture plays are hours apart, so no sitting has 3 different tracks: 0 album listens,
    // while track plays are still reported separately.
    const aAlbum = al.rows.find((r) => r.name === 'Artist A Album')!;
    expect(aAlbum.plays).toBe(0);
    expect(aAlbum.trackPlays).toBe(600);
    const tr = e.table(q('track'));
    expect(tr.rows[0].plays).toBe(tr.rows[0].trackPlays);
  });

  it('scopes any view to a genre branch without double counting', async () => {
    const e = await engine(true);
    const nodes = e.treeSummary(settings);
    const rock = nodes.find((n) => n.id === 'g:rock')!;
    // Rock = Indie Rock = Artist A (30 h) + Artist C (12 h)
    expect(rock.ms / H).toBeCloseTo(42, 6);
    const artistsInRock = e.aggregate(q('artist', { scope: 'g:rock' }));
    expect(artistsInRock.included.ms / H).toBeCloseTo(42, 6);
    expect(artistsInRock.series.filter((s) => s.kind === 'item').map((s) => s.label)).toEqual(['Artist A', 'Artist C']);
    // Artist B is split 50/50 between Electronic and Pop: half its time is in each branch.
    const pop = e.aggregate(q('artist', { scope: 'g:pop' }));
    expect(pop.included.ms / H).toBeCloseTo(18.5, 6);
    // Exclusion counts are scoped too: only Artist C's 30 short plays are in Rock (plus none of D's).
    expect(artistsInRock.belowThreshold.count).toBe(30);
    const decades = e.decades(q('artist', { scope: 'g:rock' }), 'artist');
    expect(decades.map((d) => [d.label, Math.round(d.ms / H)])).toEqual([['1990s', 30], ['Unknown', 12]]);
  });

  it('branch view partitions the root into top-level branches plus Unclassified', async () => {
    const e = await engine(true);
    const r = e.aggregate(q('branch'));
    expect(r.included.ms).toBe(EXPECTED.acceptedMs);
    r.periods.forEach((p, i) => expect(r.series.reduce((s, x) => s + x.ms[i], 0)).toBeCloseTo(p.ms, 6));
    expect(r.series.find((s) => s.kind === 'unclassified')).toBeTruthy();
    const inRock = e.aggregate(q('branch', { branch: 'g:rock' }));
    expect(inRock.included.ms / H).toBeCloseTo(42, 6);
    expect(inRock.series.map((s) => s.label)).toContain('Indie Rock');
  });

  it('entity info covers artists, albums, tracks and genre nodes', async () => {
    const e = await engine(true);
    const a = e.entity('artist', 0, settings);
    expect(a).toMatchObject({ title: 'Artist A', rank: 2, peak: '2019 Q1', genres: ['Indie Rock'], year: 1991 });
    expect(a.periods.reduce((s, p) => s + p.ms, 0) / H).toBeCloseTo(30, 6);
    expect(a.topAlbums[0].name).toBe('Artist A Album');
    const g = e.entity('genre', 'g:rock', settings);
    expect(g.path!.map((p) => p.id)).toEqual(['root', 'g:rock']);
    expect(g.children!.map((c) => c.label)).toEqual(['Indie Rock']);
    expect(g.topArtists.map((x) => x.name)).toEqual(['Artist A', 'Artist C']);
  });

  it('top N can be chosen by times played independently of the measure', async () => {
    const e = await engine();
    const byTime = e.aggregate(q('artist', { settings: { ...settings, topN: 3, rankBy: 'time' } }));
    const byPlays = e.aggregate(q('artist', { settings: { ...settings, topN: 3, rankBy: 'plays', metric: 'hours' } }));
    expect(byTime.series.slice(0, 3).map((s) => s.label)).toEqual(['Artist B', 'Artist A', 'Artist C']);
    expect(byPlays.series.slice(0, 3).map((s) => s.label)).toEqual(['Artist B', 'Artist A', 'Artist C']);
    expect(byPlays.settings.metric).toBe('hours'); // values still in hours
    const albumsByListens = e.aggregate(q('album', { settings: { ...settings, topN: 2, rankBy: 'plays', metric: 'plays' } }));
    expect(albumsByListens.series.filter((s) => s.kind === 'item').every((s) => s.totalPlays === 0)).toBe(true);
  });

  it('summary matches what the charts count', async () => {
    const e = await engine();
    const sum = e.summary(settings);
    const agg = e.aggregate(q('artist'));
    expect(sum.plays).toBe(agg.included.count);
    expect(sum.ms).toBe(agg.included.ms);
    expect(sum).toMatchObject({ artists: 13, tracks: 35, plays: EXPECTED.acceptedPlays });
    expect(sum.activeDays).toBeGreaterThan(300);
  });

  it('search finds artists, albums, songs and genres, best match first', async () => {
    const e = await engine(true);
    const hits = e.search('artist a');
    expect(hits[0]).toMatchObject({ kind: 'artist', name: 'Artist A' });
    expect(hits.some((h) => h.kind === 'album' && h.name === 'Artist A Album')).toBe(true);
    expect(hits.some((h) => h.kind === 'track')).toBe(true);
    expect(e.search('indie')[0]).toMatchObject({ kind: 'genre', name: 'Indie Rock' });
    expect(e.search('x')).toEqual([]);
  });

  it('entity history: discovery, best month, streak, years', async () => {
    const e = await engine();
    const bId = e.table(q('artist')).rows.find((r) => r.name === 'Artist B')!.id;
    const b = e.entity('artist', bId, settings);
    expect(b.title).toBe('Artist B');
    expect(new Date(b.discovered!).getUTCFullYear()).toBe(2019);
    expect(b.yearsPlayed).toBe(4);
    expect(b.longestStreakDays).toBeGreaterThanOrEqual(1);
    expect(b.bestMonth!.label).toMatch(/20(20|21)/);
  });

  it('covers: albums, their songs, and artists (most-played album with a cover)', async () => {
    const e = await engine();
    e.setArt({ 'Artist A\u0000Artist A Album': 'art/a.jpg', 'Artist B\u0000Artist B Album': null });
    const al = e.table(q('album')).rows;
    expect(al.find((r) => r.name === 'Artist A Album')!.art).toBe('art/a.jpg');
    expect(al.find((r) => r.name === 'Artist B Album')!.art).toBeNull();
    expect(e.table(q('track')).rows.find((r) => r.sub === 'Artist A')!.art).toBe('art/a.jpg');
    const ar = e.table(q('artist')).rows;
    expect(ar.find((r) => r.name === 'Artist A')!.art).toBe('art/a.jpg');
    expect(ar.find((r) => r.name === 'Artist B')!.art).toBeNull();
    const aId = ar.find((r) => r.name === 'Artist A')!.id;
    expect(e.entity('artist', aId, settings).art).toBe('art/a.jpg');
  });

  it('clears data on reset and on a failed import', async () => {
    const e = await engine();
    e.reset();
    expect(() => e.aggregate(q('artist'))).toThrow(/No data/);
    await e.import(fixtureInputs());
    expect((await e.import([])).error).toBeTruthy();
    expect(() => e.aggregate(q('artist'))).toThrow(/No data/);
  });
});
