import { beforeAll, describe, expect, it } from 'vitest';
import { strToU8 } from 'fflate';
import { musicRecord } from '../../fixtures/synthetic';
import { importFiles, type PlayStore } from '../../src/core/importer';
import type { AggregateSettings } from '../../src/core/aggregate';
import { computePatterns } from '../../src/core/patterns';
import { chooseEraCount, segmentSeries } from '../../src/core/patterns/eras';
import { adjustedRand, louvain } from '../../src/core/patterns/colisten';
import { classifyLifecycle, kaplanMeier } from '../../src/core/patterns/lifecycle';
import { rng } from '../../src/core/patterns/monthly';
import { NOW } from './helpers';

/**
 * A synthetic history with planted structure, 36 months from Jan 2020:
 *  - Eras: group X dominates 2020, Y 2021, Z 2022; group B plays in the background throughout.
 *  - Sessions are drawn from one group at a time, so the co-listening groups are X, Y, Z and B.
 *  - Six solo artists with known lifecycle shapes, each played in sessions of their own.
 */
const START = Date.UTC(2020, 0, 1);
const GROUPS: Record<string, string[]> = {
  X: ['X1', 'X2', 'X3', 'X4', 'X5'], Y: ['Y1', 'Y2', 'Y3', 'Y4', 'Y5'], Z: ['Z1', 'Z2', 'Z3', 'Z4', 'Z5'], B: ['B1', 'B2', 'B3', 'B4'],
};
const groupOf = (name: string) => name[0];
const SOLO: Record<string, (m: number) => number> = {
  'Flash Artist': (m) => (m === 5 || m === 6 ? 24 : 0),
  'Evergreen Artist': () => 2,
  'Slow Burn Artist': (m) => (m < 6 ? 1 : m >= 20 && m <= 26 ? 8 : m > 26 ? 2 : 0),
  'Seasonal Artist': (m) => (m % 12 === 11 ? 15 : 0),
  'Faded Artist': (m) => (m <= 14 ? 3 : 0),
  'New Artist': (m) => (m >= 33 ? 16 : 0),
};
const PLAY = 200_000;

function plantedRecords() {
  const r = rng(42);
  const recs: unknown[] = [];
  const session = (t0: number, artists: string[], n: number) => {
    let t = t0;
    for (let k = 0; k < n; k++) {
      const a = artists[Math.floor(r() * artists.length)];
      t += PLAY + 5_000;
      recs.push(musicRecord(t, a, `${a} Song ${1 + Math.floor(r() * 6)}`, PLAY));
    }
  };
  for (let m = 0; m < 36; m++) {
    const era = m < 12 ? 'X' : m < 24 ? 'Y' : 'Z';
    const monthStart = Date.UTC(2020, m, 1);
    for (let s = 0; s < 40; s++) {
      const g = r() < 0.8 ? era : 'B';
      const t0 = monthStart + (1 + (s % 27)) * 86_400_000 + (8 + Math.floor(r() * 4)) * 3_600_000 + (s % 2) * 6 * 3_600_000;
      session(t0, GROUPS[g], 6 + Math.floor(r() * 5));
    }
    Object.entries(SOLO).forEach(([name, f], i) => {
      for (let p = 0; p < f(m); p++) recs.push(musicRecord(monthStart + (2 + (p % 25)) * 86_400_000 + (22 + (i % 2)) * 3_600_000 + p * 1_000, name, `${name} Song ${1 + (p % 4)}`, PLAY));
    });
  }
  return recs;
}

let store: PlayStore;
let state: ReturnType<typeof computePatterns>;
const settings: AggregateSettings = { granularity: 'month', metric: 'hours', topN: 12, minMs: 30_000, range: null };
const input = () => ({ store, from: START, to: Date.UTC(2023, 0, 1), minMs: 30_000, genreOf: null });

beforeAll(async () => {
  const body = JSON.stringify(plantedRecords());
  const { store: s } = await importFiles([{ name: 'Streaming_History_Audio_2020-2022_0.json', bytes: strToU8(body) }], { nowMs: NOW });
  store = s;
  state = computePatterns(input(), settings, 4);
});

describe('segmentation and model building blocks', () => {
  it('finds a planted change point in a 1-D series', () => {
    const r = rng(3);
    const X = Array.from({ length: 24 }, (_, i) => Float64Array.of((i < 12 ? 0 : 5) + r()));
    const seg = segmentSeries(X, 2, 4);
    expect(seg.starts[1]).toEqual([0, 12]);
    expect(chooseEraCount(X, 2, seg.costs).k).toBe(2);
  });

  it('constant and pure-noise series are one era', () => {
    const X = Array.from({ length: 12 }, () => Float64Array.of(1, 2));
    expect(chooseEraCount(X, 3, segmentSeries(X, 3, 4).costs).k).toBe(1);
    // On pure noise the permutation test should invent an era about 5% of the time at most.
    const r = rng(9);
    let falseEras = 0;
    for (let trial = 0; trial < 60; trial++) {
      const N = Array.from({ length: 40 }, () => Float64Array.of(r(), r(), r()));
      if (chooseEraCount(N, 3, segmentSeries(N, 3, 8).costs, 39, trial + 1).k > 1) falseEras++;
    }
    expect(falseEras).toBeLessThanOrEqual(6);
  });

  it('Louvain separates two cliques joined by one weak link; ARI of identical labels is 1', () => {
    const edges: Array<[number, number, number]> = [];
    for (const base of [0, 4]) for (let a = 0; a < 4; a++) for (let b = a + 1; b < 4; b++) edges.push([base + a, base + b, 1]);
    edges.push([3, 4, 0.1]);
    const c = louvain(8, edges);
    expect(new Set([c[0], c[1], c[2], c[3]]).size).toBe(1);
    expect(new Set([c[4], c[5], c[6], c[7]]).size).toBe(1);
    expect(c[0]).not.toBe(c[4]);
    expect(adjustedRand([0, 0, 1, 1], [5, 5, 2, 2])).toBe(1);
    expect(adjustedRand([0, 0, 1, 1], [0, 1, 0, 1])).toBeLessThan(0.1);
  });

  it('Kaplan-Meier matches a hand computation', () => {
    const c = kaplanMeier([1, 2, 2, 3, 4], [true, true, false, true, false]);
    expect(c.map((p) => [p.t, +p.s.toFixed(4)])).toEqual([[0, 1], [1, 0.8], [2, 0.6], [3, 0.3]]);
  });

  it('lifecycle rules on simple shapes', () => {
    const flat = new Array(36).fill(5);
    expect(classifyLifecycle(flat, 0, 35).kind).toBe('evergreen');
    // A long flat history is not a slow burn just because its first months are a small share.
    const long = Array.from({ length: 60 }, (_, m) => 5 + (m === 40 ? 3 : 0));
    expect(classifyLifecycle(long, 0, 59).kind).toBe('evergreen');
    const spike = new Array(36).fill(0); spike[10] = 50; spike[11] = 40; spike[20] = 2;
    expect(classifyLifecycle(spike, 10, 35).kind).toBe('flash');
    expect(classifyLifecycle([...new Array(30).fill(0), 9, 9], 30, 35).kind).toBe('new');
  });
});

describe('patterns on a history with planted structure', () => {
  it('eras: three eras starting at the planted boundaries', () => {
    const { eras } = state.view.eras;
    expect(eras).toHaveLength(3);
    expect(eras.map((e) => e.fromMonth - 2020 * 12)).toEqual([0, 12, 24]);
    expect(eras.map((e) => groupOf(e.top[0].name))).toEqual(['X', 'Y', 'Z']);
    expect(eras[1].shift).toBeGreaterThan(0.5);
    expect(eras[1].startWindow!.from).toBeLessThanOrEqual(2021 * 12);
    expect(eras[1].startWindow!.to).toBeGreaterThanOrEqual(2021 * 12);
    expect(eras[1].startWindow!.to - eras[1].startWindow!.from).toBeLessThanOrEqual(2);
    expect(eras.every((e) => e.defining.every((d) => groupOf(d.name) === groupOf(e.top[0].name) || d.name.includes('Artist')))).toBe(true);
  });

  it('tastes: each component is one planted group, and hours reconcile exactly', () => {
    const t = state.tastes!;
    expect(t.k).toBe(4);
    const groups = t.tastes.map((x) => new Set(x.artists.slice(0, 3).map((a) => groupOf(a.name))));
    for (const g of groups) expect(g.size).toBe(1);
    expect(new Set(groups.map((g) => [...g][0]))).toEqual(new Set(['X', 'Y', 'Z', 'B']));
    for (const x of t.tastes) expect(x.stability).toBeGreaterThan(0.9);
    const total = t.result.series.reduce((a, s) => a + s.totalMs, 0);
    expect(total).toBeCloseTo(t.result.included.ms, 3);
    t.result.periods.forEach((p, i) => expect(t.result.series.reduce((a, s) => a + s.ms[i], 0)).toBeCloseTo(p.ms, 3));
  });

  it('map: planted session groups become co-listening groups', () => {
    const { nodes, stability } = state.view.map;
    const g = (name: string) => nodes.find((n) => n.name === name)!.group;
    for (const k of ['X', 'Y', 'Z', 'B']) {
      const ids = new Set(GROUPS[k].map(g));
      expect(ids.size).toBe(1);
      expect([...ids][0]).toBeGreaterThanOrEqual(0);
    }
    expect(new Set(['X1', 'Y1', 'Z1', 'B1'].map(g)).size).toBe(4);
    expect(stability).toBeGreaterThan(0.9);
    const x1 = store.artistNames.indexOf('X1');
    const nb = state.neighbours.get(x1)!;
    expect(nb.length).toBeGreaterThan(2);
    expect(nb.slice(0, 4).every((n) => groupOf(n.name) === 'X')).toBe(true);
    for (const n of nodes) { expect(n.x).toBeGreaterThanOrEqual(0); expect(n.x).toBeLessThanOrEqual(1); }
  });

  it('lifecycles: each solo artist gets its planted shape', () => {
    const kind = (name: string) => state.kindOf.get(store.artistNames.indexOf(name));
    expect(kind('Flash Artist')).toBe('flash');
    expect(kind('Evergreen Artist')).toBe('evergreen');
    expect(kind('Slow Burn Artist')).toBe('slowburn');
    expect(kind('Seasonal Artist')).toBe('seasonal');
    expect(kind('Faded Artist')).toBe('faded');
    expect(kind('New Artist')).toBe('new');
    const s = state.view.life.survival;
    // Discovered 3+ months after the start, on 2+ days: Y*, Z*, Flash, Slow Burn?, Seasonal, New.
    expect(s.artists).toBeGreaterThan(5);
    expect(s.curve[0]).toEqual({ t: 0, s: 1, atRisk: s.artists });
  });

  it('is deterministic', () => {
    const again = computePatterns(input(), settings, 4);
    expect(JSON.stringify([again.view, again.tastes])).toBe(JSON.stringify([state.view, state.tastes]));
  });
});
