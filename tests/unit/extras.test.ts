import { beforeAll, describe, expect, it } from 'vitest';
import { aggregate, artistGrouping, type AggregateSettings } from '../../src/core/aggregate';
import { detectActiveRange } from '../../src/core/coverage';
import { periodRanks } from '../../src/core/ranks';
import { listeningClock } from '../../src/core/clock';
import { importFiles, type PlayStore, type ImportAudit } from '../../src/core/importer';
import { musicRecord } from '../../fixtures/synthetic';
import { strToU8 } from 'fflate';
import { importFixture, NOW } from './helpers';

const base: AggregateSettings = { granularity: 'quarter', metric: 'hours', topN: 5, minMs: 30_000, range: null };
let store: PlayStore;
let audit: ImportAudit;
beforeAll(async () => {
  ({ store, audit } = await importFixture());
});

describe('per-file coverage and monthly counts', () => {
  it('reports each file’s own date range and the monthly histogram', () => {
    const f = audit.files.filter((x) => x.status === 'accepted');
    expect(new Date(f[0].firstPlay!).toISOString().slice(0, 10)).toBe('2019-01-02');
    expect(new Date(f[1].firstPlay!).toISOString().slice(0, 7)).toBe('2021-01');
    expect(audit.monthly.counts.reduce((a, b) => a + b, 0)).toBe(store.length);
    expect(audit.monthly.counts).toHaveLength(48);
  });
});

describe('detectActiveRange', () => {
  const m = (counts: number[]) => ({ firstMonth: 2016 * 12 + 2, counts });
  it('trims a few stray plays years before regular listening, and reports them', () => {
    const counts = [3, ...new Array(20).fill(0), 1, 0, ...new Array(30).fill(200)];
    const r = detectActiveRange(m(counts));
    expect(r.trimmed).toBe(true);
    expect(r.leading).toBe(4);
    expect(r.fromMonth).toBe(2016 * 12 + 2 + 23);
    expect(r.toMonth).toBe(2016 * 12 + 2 + counts.length - 1);
  });
  it('keeps real history with a long break', () => {
    const counts = [...new Array(12).fill(150), ...new Array(18).fill(0), ...new Array(12).fill(150)];
    expect(detectActiveRange(m(counts)).trimmed).toBe(false);
  });
  it('does not trim when the early segment is substantial', () => {
    const counts = [80, 80, 80, ...new Array(10).fill(0), ...new Array(30).fill(200)];
    expect(detectActiveRange(m(counts)).trimmed).toBe(false);
  });
  it('leaves the synthetic fixture and tiny histories alone', () => {
    expect(detectActiveRange(audit.monthly).trimmed).toBe(false);
    expect(detectActiveRange(m([5, 0, 0, 0, 0, 0, 5])).trimmed).toBe(false);
  });
  it('works end-to-end from an import with a stray early play', async () => {
    const recs = [musicRecord(Date.UTC(2016, 2, 5), 'Stray', 'Old', 200_000)];
    for (let i = 0; i < 400; i++) recs.push(musicRecord(Date.UTC(2019, 0, 1) + i * 86_400_000, 'Reg', 'Song', 200_000));
    const { audit: a } = await importFiles([{ name: 'Streaming_History_Audio_x.json', bytes: strToU8(JSON.stringify(recs)) }], { nowMs: NOW });
    const r = detectActiveRange(a.monthly);
    expect(r).toMatchObject({ trimmed: true, leading: 1, fromMonth: 2019 * 12 });
  });
});

describe('top N beyond 8 for labelled lanes', () => {
  it('allows up to the requested cap and still reconciles', () => {
    const r = aggregate(store, { ...base, topN: 30 }, undefined, undefined, 30);
    expect(r.series.filter((s) => s.kind === 'item')).toHaveLength(13); // every artist
    expect(r.series.find((s) => s.kind === 'other')).toBeUndefined();
    r.periods.forEach((p, i) => expect(r.series.reduce((a, s) => a + s.ms[i], 0)).toBeCloseTo(p.ms, 6));
  });
});

describe('periodRanks', () => {
  it('ranks among all artists per period', () => {
    const agg = aggregate(store, base);
    const g = artistGrouping(store);
    const ids = agg.topIds; // B, A, C, D, E
    const { ranks, competitors } = periodRanks(store, agg, g, ids);
    const label = (i: number) => agg.periods[i].label;
    const A = ranks[1];
    const B = ranks[0];
    expect(label(0)).toBe('2019 Q1');
    expect(A[0]).toBe(1);
    expect(B[0]).toBe(5); // 2019 Q1: A 80, C 16, D 14, E 12, B 10 (= F 10, tie broken by id)
    expect(A[6]).toBeNull(); // empty quarter
    expect(competitors[6]).toBe(0);
    expect(A[8]).toBeNull(); // A absent in 2021
    expect(B[8]).toBe(1);
    expect(A[12]).toBe(1); // A returns 2022
  });
});

describe('listeningClock', () => {
  it('buckets by UTC weekday/hour and supports a labelled fixed offset', () => {
    const recs = [musicRecord(Date.UTC(2024, 0, 1, 23, 30), 'X', 'Y', 60_000)]; // Monday 23:30 UTC
    return importFiles([{ name: 'a.json', bytes: strToU8(JSON.stringify(recs)) }], { nowMs: NOW }).then(({ store: s }) => {
      const utc = listeningClock(s, 0, Date.UTC(2030, 0, 1), 0, 0);
      expect(utc.ms[0][23]).toBe(60_000);
      const plus2 = listeningClock(s, 0, Date.UTC(2030, 0, 1), 0, 2);
      expect(plus2.ms[1][1]).toBe(60_000); // Tuesday 01:30 at UTC+2
      const total = listeningClock(store, 0, Date.UTC(2030, 0, 1), 30_000, 0);
      expect(total.ms.flat().reduce((a, b) => a + b, 0)).toBe(aggregate(store, base).included.ms);
    });
  });
});
