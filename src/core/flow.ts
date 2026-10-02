/**
 * Flow ("ribbon") layout built from the exact same AggregateResult as the stacked-area view.
 *
 * What the marks mean:
 *  - Each column is one period. Nodes in a column are the displayed series (top N + Other),
 *    sorted largest first (Other and Unclassified always at the bottom), sized by the metric.
 *    Column totals therefore equal the stacked-area period totals.
 *  - A ribbon connects the SAME series in two adjacent periods. Its end widths equal that
 *    series' value in each period. Ribbons never connect different artists: the export has no
 *    artist-to-artist transition data, so a crossing only means the ranking changed.
 *  - No ribbon is drawn into or out of an empty period or a zero value.
 *  - With `otherBelow`, columns share a baseline: top-N nodes stack upward from it (largest
 *    nearest the line) and "Other" hangs below it, on the same scale.
 */
import { valueAt, periodTotal, type AggregateResult, type Metric } from './aggregate';

export interface FlowNode {
  seriesKey: string;
  periodIndex: number;
  value: number;
  rank: number;
  /** True when the node is drawn shorter than its value (Other below a capped baseline). */
  clipped?: boolean;
  x0: number;
  x1: number;
  y0: number;
  y1: number;
}

export interface FlowRibbon {
  seriesKey: string;
  from: FlowNode;
  to: FlowNode;
  path: string;
}

export interface FlowColumn {
  periodIndex: number;
  x: number;
  total: number | null;
  empty: boolean;
}

export interface FlowLayout {
  nodes: FlowNode[];
  ribbons: FlowRibbon[];
  columns: FlowColumn[];
  scale: number; // px per metric unit
  /** y of the shared baseline when `otherBelow` is set. */
  baseline: number | null;
}

export interface FlowDims {
  width: number;
  height: number;
  nodeWidth: number;
  gap: number;
  otherBelow?: boolean;
}

export function layoutFlow(r: AggregateResult, metric: Metric, dims: FlowDims): FlowLayout {
  const P = r.periods.length;
  const S = r.series.length;
  const { width, height, nodeWidth, gap } = dims;
  const step = P > 1 ? (width - nodeWidth) / (P - 1) : 0;
  const totals = r.periods.map((p) => periodTotal(p, metric));
  // Scale by what is drawn (equal to the period totals unless a caller filtered out series).
  const drawn = r.periods.map((p, i) => r.series.reduce((a, s) => a + (valueAt(s, p, i, metric) ?? 0), 0));
  const below = Boolean(dims.otherBelow) && r.series.some((s) => s.kind === 'other');
  const otherOf = (i: number) => {
    const o = r.series.find((s) => s.kind === 'other');
    return o ? valueAt(o, r.periods[i], i, metric) ?? 0 : 0;
  };
  const maxTotal = Math.max(0, ...drawn);
  const maxAbove = below ? Math.max(0, ...drawn.map((d, i) => d - otherOf(i))) : maxTotal;
  // Other below the baseline is capped at the height of the tallest top-N column, so a dominant
  // Other (e.g. 95% for albums) cannot squeeze the top N; capped nodes are flagged as clipped.
  const maxBelow = below ? Math.min(Math.max(0, ...r.periods.map((_, i) => otherOf(i))), maxAbove) : 0;
  const usable = Math.max(1, height - Math.max(0, S - 1) * gap - (below ? 3 * gap : 0));
  const scale = maxAbove + maxBelow > 0 ? usable / (maxAbove + maxBelow) : 0;
  const baseline = below ? (maxAbove * scale) + Math.max(0, S - 2) * gap + gap : null;

  const nodes: FlowNode[] = [];
  const byKey = new Map<string, (FlowNode | null)[]>();
  r.series.forEach((s) => byKey.set(s.key, new Array(P).fill(null)));
  const columns: FlowColumn[] = [];

  for (let i = 0; i < P; i++) {
    const x0 = P > 1 ? i * step : (width - nodeWidth) / 2;
    const p = r.periods[i];
    const entries = r.series
      .map((s, si) => ({ s, si, v: valueAt(s, p, i, metric) ?? 0 }))
      .filter((e) => e.v > 0)
      .sort((a, b) => {
        const fa = a.s.kind === 'item' ? 0 : 1;
        const fb = b.s.kind === 'item' ? 0 : 1;
        return fa - fb || b.v - a.v || a.si - b.si;
      });
    columns.push({ periodIndex: i, x: x0 + nodeWidth / 2, total: totals[i], empty: entries.length === 0 });
    if (baseline !== null) {
      // Items rise from the baseline (largest nearest it); Other hangs below it.
      let up = baseline;
      entries.forEach((e, rank) => {
        const clipped = e.s.kind === 'other' && e.v > maxBelow;
        const h = (clipped ? maxBelow : e.v) * scale;
        let y0: number;
        if (e.s.kind === 'other') y0 = baseline + 2 * gap;
        else { y0 = up - h; up = y0 - gap; }
        const node: FlowNode = { seriesKey: e.s.key, periodIndex: i, value: e.v, rank, clipped, x0, x1: x0 + nodeWidth, y0, y1: y0 + h };
        nodes.push(node);
        byKey.get(e.s.key)![i] = node;
      });
      continue;
    }
    const colHeight = entries.reduce((a, e) => a + e.v * scale, 0) + Math.max(0, entries.length - 1) * gap;
    let y = (height - colHeight) / 2;
    entries.forEach((e, rank) => {
      const h = e.v * scale;
      const node: FlowNode = { seriesKey: e.s.key, periodIndex: i, value: e.v, rank, x0, x1: x0 + nodeWidth, y0: y, y1: y + h };
      nodes.push(node);
      byKey.get(e.s.key)![i] = node;
      y += h + gap;
    });
  }

  const ribbons: FlowRibbon[] = [];
  for (const [key, col] of byKey) {
    for (let i = 0; i + 1 < P; i++) {
      const a = col[i];
      const b = col[i + 1];
      if (!a || !b) continue;
      ribbons.push({ seriesKey: key, from: a, to: b, path: ribbonPath(a, b) });
    }
  }
  return { nodes, ribbons, columns, scale, baseline };
}

function ribbonPath(a: FlowNode, b: FlowNode): string {
  const xa = a.x1;
  const xb = b.x0;
  const xm = (xa + xb) / 2;
  const f = (n: number) => n.toFixed(2);
  return `M${f(xa)},${f(a.y0)}C${f(xm)},${f(a.y0)} ${f(xm)},${f(b.y0)} ${f(xb)},${f(b.y0)}` +
    `L${f(xb)},${f(b.y1)}C${f(xm)},${f(b.y1)} ${f(xm)},${f(a.y1)} ${f(xa)},${f(a.y1)}Z`;
}
