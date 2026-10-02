import { beforeAll, describe, expect, it } from 'vitest';
import { aggregate, periodTotal, valueAt, type AggregateSettings, type Metric } from '../../src/core/aggregate';
import { layoutFlow } from '../../src/core/flow';
import type { PlayStore } from '../../src/core/importer';
import { importFixture } from './helpers';

const base: AggregateSettings = { granularity: 'quarter', metric: 'hours', topN: 5, minMs: 30_000, range: null };
const dims = { width: 1000, height: 400, nodeWidth: 10, gap: 3 };
let store: PlayStore;
beforeAll(async () => {
  store = (await importFixture()).store;
});

describe('layoutFlow', () => {
  for (const metric of ['hours', 'share', 'plays'] as Metric[]) {
    it(`column totals equal stacked-area period totals (${metric})`, () => {
      const r = aggregate(store, { ...base, metric });
      const f = layoutFlow(r, metric, dims);
      f.columns.forEach((_c, i) => {
        const nodeSum = f.nodes.filter((n) => n.periodIndex === i).reduce((a, n) => a + n.value, 0);
        const stackSum = r.series.reduce((a, s) => a + (valueAt(s, r.periods[i], i, metric) ?? 0), 0);
        expect(nodeSum).toBeCloseTo(stackSum, 9);
        expect(nodeSum).toBeCloseTo(periodTotal(r.periods[i], metric) ?? 0, 9);
        // pixel heights are proportional to values with one shared scale
        for (const n of f.nodes.filter((n) => n.periodIndex === i)) expect(n.y1 - n.y0).toBeCloseTo(n.value * f.scale, 6);
      });
      // "Other" is included in the flow exactly as in the stack
      const otherNodes = f.nodes.filter((n) => n.seriesKey === 'other');
      expect(otherNodes.length).toBe(r.periods.filter((p) => p.ms > 0).length);
    });
  }

  it('only connects the same series across adjacent non-empty periods', () => {
    const r = aggregate(store, base);
    const f = layoutFlow(r, 'hours', dims);
    const empty = r.periods.findIndex((p) => p.ms === 0);
    expect(f.columns[empty].empty).toBe(true);
    for (const rb of f.ribbons) {
      expect(rb.from.seriesKey).toBe(rb.seriesKey);
      expect(rb.to.seriesKey).toBe(rb.seriesKey);
      expect(rb.to.periodIndex).toBe(rb.from.periodIndex + 1);
      expect(rb.from.periodIndex).not.toBe(empty);
      expect(rb.to.periodIndex).not.toBe(empty);
    }
    // Artist A is absent 2020 Q4 - 2021 Q4: no ribbons for A there, and it reappears in 2022.
    const aKey = r.series.find((s) => s.label === 'Artist A')!.key;
    const aCols = f.nodes.filter((n) => n.seriesKey === aKey).map((n) => r.periods[n.periodIndex].label);
    expect(aCols).toEqual(['2019 Q1', '2019 Q2', '2019 Q3', '2019 Q4', '2020 Q1', '2020 Q2', '2022 Q1', '2022 Q2', '2022 Q3', '2022 Q4']);
    expect(f.ribbons.filter((x) => x.seriesKey === aKey)).toHaveLength(5 + 3);
  });

  it('ranks the dominant artist first in each era and keeps Other at the bottom', () => {
    const r = aggregate(store, base);
    const f = layoutFlow(r, 'hours', dims);
    const top = (label: string) => {
      const i = r.periods.findIndex((p) => p.label === label);
      const k = f.nodes.find((n) => n.periodIndex === i && n.rank === 0)!.seriesKey;
      return r.series.find((s) => s.key === k)!.label;
    };
    expect(top('2019 Q2')).toBe('Artist A');
    expect(top('2021 Q2')).toBe('Artist B');
    expect(top('2022 Q3')).toBe('Artist A');
    for (const c of f.columns) {
      const col = f.nodes.filter((n) => n.periodIndex === c.periodIndex);
      if (col.length) expect(col[col.length - 1].seriesKey).toBe('other');
    }
  });

});
