import { beforeAll, describe, expect, it } from 'vitest';
import { aggregate, valueAt, type AggregateResult, type AggregateSettings } from '../../src/core/aggregate';
import { ColorRegistry } from '../../src/core/colors';
import type { PlayStore } from '../../src/core/importer';
import { EXPECTED } from '../../fixtures/synthetic';
import { importFixture } from './helpers';

const H = 3_600_000;
const base: AggregateSettings = { granularity: 'quarter', metric: 'hours', topN: 5, minMs: 30_000, range: null };
let store: PlayStore;
beforeAll(async () => {
  store = (await importFixture()).store;
});

function byLabel(r: AggregateResult, label: string) {
  const s = r.series.find((x) => x.label === label);
  if (!s) throw new Error(`no series ${label}`);
  return s;
}
function reconcile(r: AggregateResult) {
  r.periods.forEach((p, i) => {
    const sumMs = r.series.reduce((a, s) => a + s.ms[i], 0);
    const sumPlays = r.series.reduce((a, s) => a + s.plays[i], 0);
    expect(sumMs).toBeCloseTo(p.ms, 6);
    expect(sumPlays).toBeCloseTo(p.plays, 6);
  });
  expect(r.periods.reduce((a, p) => a + p.ms, 0)).toBeCloseTo(r.included.ms, 3);
}

describe('aggregate (default settings)', () => {
  it('reconciles totals with the fixture and with the import', () => {
    const r = aggregate(store, base);
    expect(r.included).toEqual({ count: EXPECTED.acceptedPlays, ms: EXPECTED.acceptedMs });
    expect(r.belowThreshold).toEqual(EXPECTED.belowThreshold30s);
    expect(r.outsideRange).toEqual({ count: 0, ms: 0 });
    expect(r.included.count + r.belowThreshold.count).toBe(store.length);
    reconcile(r);
  });

  it('keeps empty periods on the axis with zero hours and undefined share', () => {
    const r = aggregate(store, base);
    expect(r.periods).toHaveLength(EXPECTED.quarters);
    const i = r.periods.findIndex((p) => p.label === EXPECTED.emptyQuarterLabel);
    expect(i).toBe(6);
    expect(r.periods[i].ms).toBe(0);
    for (const s of r.series) {
      expect(valueAt(s, r.periods[i], i, 'hours')).toBe(0);
      expect(valueAt(s, r.periods[i], i, 'share')).toBeNull();
    }
  });

  it('shares sum to 100% in every non-empty period', () => {
    const r = aggregate(store, { ...base, metric: 'share' });
    r.periods.forEach((p, i) => {
      if (p.ms === 0) return;
      expect(r.series.reduce((a, s) => a + (valueAt(s, p, i, 'share') ?? 0), 0)).toBeCloseTo(100, 9);
    });
  });

  it('picks top N across the whole range and folds the rest into Other', () => {
    const r = aggregate(store, base);
    expect(r.series.map((s) => s.label)).toEqual(['Artist B', 'Artist A', 'Artist C', 'Artist D', 'Artist E', 'Other artists']);
    const other = byLabel(r, 'Other artists');
    // F..J, two Sigur variants, Boundary Artist
    expect(other.memberCount).toBe(8);
    // 2019 Q1: F..J = 10+8+6+4+2 = 30 plays = 1.5 h
    expect(other.ms[0] / H).toBeCloseTo(1.5, 9);
    expect(byLabel(r, 'Artist A').ms[0] / H).toBeCloseTo(4, 9);
    expect(byLabel(r, 'Artist B').totalPlays).toBe(740);
    expect(byLabel(r, 'Artist A').totalPlays).toBe(600);
  });

  it('makes the listening eras visible: A early, B later, A returns', () => {
    const r = aggregate(store, base);
    const leader = r.periods.map((p, i) => {
      if (p.ms === 0) return '-';
      return [...r.series].sort((a, b) => b.ms[i] - a.ms[i])[0].label.replace('Artist ', '');
    });
    expect(leader.join('')).toBe('AAAABB-BBBBBAAAA');
  });

  it('attributes UTC boundary plays to the correct quarter', () => {
    const r = aggregate(store, { ...base, topN: 8 });
    const other = byLabel(r, 'Other artists'); // Boundary Artist is outside the top 8
    const q4 = r.periods.findIndex((p) => p.label === '2019 Q4');
    // Other in 2019 Q4 = I + J (4 + 2 plays) + 1 boundary play; in 2020 Q1 the same.
    expect(other.plays[q4]).toBe(7);
    expect(other.plays[q4 + 1]).toBe(7);
  });
});

describe('aggregate controls', () => {
  it('applies the minimum duration, including the exact 30 s edge', () => {
    const r0 = aggregate(store, { ...base, minMs: 0 });
    expect(r0.belowThreshold.count).toBe(0);
    expect(r0.included.count).toBe(store.length);
    const r29 = aggregate(store, { ...base, minMs: 29_999 });
    expect(r29.belowThreshold.count).toBe(30); // only the 5 s plays
    const r30 = aggregate(store, { ...base, minMs: 30_000 });
    expect(r30.belowThreshold.count).toBe(31);
    reconcile(r0);
  });

  it('supports month and year periods', () => {
    const m = aggregate(store, { ...base, granularity: 'month' });
    expect(m.periods).toHaveLength(48);
    expect(m.periods.filter((p) => p.ms === 0).map((p) => p.label)).toEqual(['Jul 2020', 'Aug 2020', 'Sep 2020']);
    const y = aggregate(store, { ...base, granularity: 'year' });
    expect(y.periods.map((p) => p.label)).toEqual(['2019', '2020', '2021', '2022']);
    reconcile(m);
    reconcile(y);
  });

  it('restricts to a date range and re-ranks top N within it', () => {
    const r = aggregate(store, { ...base, topN: 1, range: { from: Date.UTC(2022, 0, 1), to: Date.UTC(2022, 11, 31, 23, 59, 59) } });
    expect(r.periods.map((p) => p.label)).toEqual(['2022 Q1', '2022 Q2', '2022 Q3', '2022 Q4']);
    expect(r.series[0].label).toBe('Artist A');
    const y2021 = aggregate(store, { ...base, range: { from: Date.UTC(2021, 0, 1), to: Date.UTC(2021, 11, 31, 23, 59, 59) } });
    expect(y2021.included.count).toBe(694);
    expect(y2021.included.count + y2021.outsideRange.count + y2021.belowThreshold.count).toBe(store.length);
    reconcile(r);
  });

  it('ranks by play count when the metric is plays', () => {
    const r = aggregate(store, { ...base, metric: 'plays', topN: 4 });
    expect(r.series.slice(0, 4).map((s) => s.label)).toEqual(['Artist B', 'Artist A', 'Artist C', 'Artist D']);
  });

  it('caps top N at 20 colour slots', () => {
    const r = aggregate(store, { ...base, topN: 50 });
    expect(r.series.filter((s) => s.kind === 'item')).toHaveLength(13); // all 13 artists (cap is 20)
  });
});

describe('stable colors', () => {
  it('keeps each artist color when top N, range and metric change', () => {
    const allTime = aggregate(store, { ...base, topN: 8 }).topIds;
    const reg = new ColorRegistry(allTime);
    const color = (r: AggregateResult) => Object.fromEntries(r.series.filter((s) => s.kind === 'item').map((s) => [s.label, s.colorSlot]));
    const a = color(aggregate(store, { ...base, topN: 3 }, undefined, (ids) => reg.assign(ids)));
    const b = color(aggregate(store, { ...base, topN: 8, metric: 'plays' }, undefined, (ids) => reg.assign(ids)));
    const c = color(aggregate(store, { ...base, range: { from: Date.UTC(2022, 0, 1), to: Date.UTC(2023, 0, 1) } }, undefined, (ids) => reg.assign(ids)));
    for (const [artist, slot] of Object.entries(a)) {
      expect(b[artist]).toBe(slot);
      if (artist in c) expect(c[artist]).toBe(slot);
    }
  });

  it('never gives two displayed groups the same slot and remembers new assignments', () => {
    const reg = new ColorRegistry([10, 11, 12, 13, 14, 15, 16, 17]);
    const m1 = reg.assign([10, 99, 12]);
    expect(m1.get(10)).toBe(0);
    expect(m1.get(12)).toBe(2);
    expect(m1.get(99)).toBe(1); // lowest free slot
    expect(new Set(m1.values()).size).toBe(3);
    expect(reg.assign([99]).get(99)).toBe(1);
    const m2 = reg.assign([11, 99]); // both claim slot 1
    expect(new Set(m2.values()).size).toBe(2);
    expect(m2.get(11)).toBe(1);
  });
});
