import { forwardRef, useMemo, useState } from 'react';
import { area, curveMonotoneX } from 'd3-shape';
import { valueAt, METRIC_LABEL, type AggregateResult, type Metric, type SeriesData } from '../core/aggregate';
import type { Theme } from './theme';
import { fmtMetric } from './format';
import { edgeAnchor } from './FlowChart';
import { tipStyle } from './Tooltip';

export type ErasSort = 'peak' | 'total';

interface Props {
  result: AggregateResult;
  metric: Metric;
  sort: ErasSort;
  width: number;
  theme: Theme;
  onSelect: (seriesKey: string, periodIndex: number) => void;
}

interface Lane {
  s: SeriesData;
  values: Array<number | null>;
  peak: number;
  peakValue: number;
  /** True when the peak clearly stands out (>= 1.5x the median of non-empty periods). */
  distinct: boolean;
}

/**
 * Ridgeline: one lane per artist, all lanes on ONE shared value scale so heights are comparable.
 * Lanes are sorted by the period of each artist's peak, which reads as a chronological story.
 * Only top-N artists are drawn; nothing is folded into a visual "Other" here (its size is reported).
 */
export const ErasChart = forwardRef<SVGSVGElement, Props>(function ErasChart({ result, metric, sort, width, theme, onSelect }, ref) {
  const [hover, setHover] = useState<{ lane: number; i: number; x: number; y: number } | null>(null);
  const narrow = width < 640;
  const P = result.periods.length;

  const lanes = useMemo<Lane[]>(() => {
    const items = result.series.filter((s) => s.kind === 'item');
    const ls = items.map((s) => {
      const values = result.periods.map((p, i) => valueAt(s, p, i, metric));
      let peak = 0;
      values.forEach((v, i) => { if ((v ?? 0) > (values[peak] ?? 0)) peak = i; });
      const nz = values.filter((v): v is number => (v ?? 0) > 0).sort((a, b) => a - b);
      const median = nz.length ? nz[Math.floor(nz.length / 2)] : 0;
      const peakValue = values[peak] ?? 0;
      return { s, values, peak, peakValue, distinct: peakValue > 0 && peakValue >= 1.5 * median };
    });
    return sort === 'peak'
      ? ls.sort((a, b) => a.peak - b.peak || b.s.totalMs - a.s.totalMs)
      : ls.sort((a, b) => b.s.totalMs - a.s.totalMs);
  }, [result, metric, sort]);

  const laneH = narrow ? 30 : 30;
  const overlap = 2.2; // a lane's peak may rise 2.2 lanes high: the ridgeline look
  const M = { top: Math.round(laneH * (overlap - 1)) + 22, right: narrow ? 8 : 24, bottom: 34, left: narrow ? 8 : 190 };
  const height = M.top + lanes.length * laneH + M.bottom;
  const innerW = Math.max(10, width - M.left - M.right);
  const bw = innerW / Math.max(1, P);
  const maxV = Math.max(1e-9, ...lanes.map((l) => l.peakValue));
  const amp = laneH * overlap;

  const paths = useMemo(() => lanes.map((l, li) => {
    const base = (li + 1) * laneH;
    const ok = (i: number) => i >= 0 && i < P && result.periods[i].ms > 0;
    const pts: Array<{ x: number; y: number; d: boolean }> = [];
    l.values.forEach((v, i) => {
      const y = base - ((v ?? 0) / maxV) * amp;
      if (!ok(i)) { pts.push({ x: (i + 0.5) * bw, y, d: false }); return; }
      if (!ok(i - 1)) pts.push({ x: i * bw, y, d: true });
      pts.push({ x: (i + 0.5) * bw, y, d: true });
      if (!ok(i + 1)) pts.push({ x: (i + 1) * bw, y, d: true });
    });
    const gen = area<{ x: number; y: number; d: boolean }>().x((d) => d.x).y0(base).y1((d) => d.y).defined((d) => d.d).curve(curveMonotoneX);
    return { base, d: gen(pts) ?? '' };
  }), [lanes, laneH, P, bw, maxV, amp, result]);

  const stride = Math.max(1, Math.ceil(64 / bw));
  // Peak labels: keep one only when it does not overlap a label already placed (top lanes first).
  const peakLabel = new Set<string>();
  {
    const boxes: Array<{ x0: number; x1: number; y0: number; y1: number }> = [];
    lanes.forEach((l, li) => {
      if (!l.distinct) return;
      const cx = Math.min(Math.max((l.peak + 0.5) * bw, 30), innerW - 30);
      const cy = (li + 1) * laneH - (l.peakValue / maxV) * amp - 4;
      const b = { x0: cx - 34, x1: cx + 34, y0: cy - 16, y1: cy + 6 };
      if (boxes.some((o) => b.x0 < o.x1 && b.x1 > o.x0 && b.y0 < o.y1 && b.y1 > o.y0)) return;
      boxes.push(b);
      peakLabel.add(l.s.key);
    });
  }
  const fill = theme.series[0];
  const step = (i: number) => (i % stride === 0);

  const pick = (clientX: number, clientY: number, el: SVGRectElement) => {
    const box = el.getBoundingClientRect();
    const px = clientX - box.left;
    const py = clientY - box.top;
    const i = Math.min(P - 1, Math.max(0, Math.floor(px / bw)));
    const lane = Math.min(lanes.length - 1, Math.max(0, Math.floor(py / laneH)));
    return { i, lane, x: M.left + px, y: M.top + py };
  };

  const hl = hover ? lanes[hover.lane] : null;
  return (
    <div className="chart-wrap" style={{ height }}>
      <svg
        ref={ref}
        width={width}
        height={height}
        viewBox={`0 0 ${width} ${height}`}
        role="img"
        aria-label={`Eras ridgeline: ${lanes.length} artists, one lane each on a shared scale of ${METRIC_LABEL[metric]}, sorted by ${sort === 'peak' ? 'when each peaked' : 'total listening'}. ${lanes.map((l) => `${l.s.label} peaked ${result.periods[l.peak]?.label}`).join('; ')}.`}
        fontFamily="system-ui, -apple-system, 'Segoe UI', sans-serif"
        className="chart-svg"
        onPointerLeave={() => setHover(null)}
      >
        <rect width={width} height={height} fill={theme.surface} />
        <g transform={`translate(${M.left},${M.top})`}>
          {result.periods.map((p, i) => (p.ms === 0 ? (
            <rect key={`e${i}`} data-empty-period={p.label} x={i * bw} y={-M.top + 4} width={bw} height={lanes.length * laneH + M.top - 4} fill={theme.emptyBand} />
          ) : null))}
          {result.periods.map((_, i) => step(i) && (
            <line key={`g${i}`} x1={(i + 0.5) * bw} x2={(i + 0.5) * bw} y1={-M.top + 4} y2={lanes.length * laneH} stroke={theme.grid} />
          ))}
          {lanes.map((l, li) => {
            const active = !hl || hl === l;
            return (
              <g key={l.s.key} data-lane={l.s.label} opacity={active ? 1 : 0.35}>
                <path d={paths[li].d} fill={fill} fillOpacity={hl === l ? 0.95 : 0.78} stroke={theme.surface} strokeWidth={1.25} />
                <line x1={0} x2={innerW} y1={paths[li].base} y2={paths[li].base} stroke={theme.axis} strokeWidth={0.75} />
                {!narrow && (
                  <text x={-10} y={paths[li].base - 6} textAnchor="end" fontSize={12} fill={theme.ink} fontWeight={hl === l ? 700 : 500}>
                    <title>{l.s.label}</title>{truncate(l.s.label, 26)}
                  </text>
                )}
                {narrow && (
                  <text x={4} y={paths[li].base - 4} fontSize={11} fill={theme.ink} fontWeight={600} stroke={theme.surface} strokeWidth={3} paintOrder="stroke">
                    {truncate(l.s.label, 22)}
                  </text>
                )}
                {!narrow && l.distinct && peakLabel.has(l.s.key) && (
                  <text
                    x={Math.min(Math.max((l.peak + 0.5) * bw, 30), innerW - 30)}
                    y={paths[li].base - (l.peakValue / maxV) * amp - 4}
                    textAnchor="middle"
                    fontSize={10.5}
                    fill={theme.ink2}
                    stroke={theme.surface}
                    strokeWidth={3}
                    paintOrder="stroke"
                    pointerEvents="none"
                    opacity={active ? 1 : 0}
                  >
                    {result.periods[l.peak].label}
                  </text>
                )}
              </g>
            );
          })}
          {result.periods.map((p, i) => step(i) ? (
            <text key={p.label} x={(i + 0.5) * bw} y={lanes.length * laneH + 20} textAnchor={edgeAnchor(M.left + (i + 0.5) * bw, width)} fontSize={11} fill={theme.muted}>{p.label}</text>
          ) : null)}
          <rect
            data-testid="eras-hit"
            x={0}
            y={0}
            width={innerW}
            height={lanes.length * laneH}
            fill="transparent"
            style={{ cursor: 'pointer' }}
            onPointerMove={(e) => setHover(pick(e.clientX, e.clientY, e.currentTarget))}
            onClick={(e) => { const h = pick(e.clientX, e.clientY, e.currentTarget); onSelect(lanes[h.lane].s.key, h.i); }}
          />
        </g>
      </svg>
      {hover && hl && (
        <div className="tooltip" role="status" style={tipStyle(hover.x, hover.y, width)}>
          <div className="tt-title">{hl.s.label}</div>
          <div className="tt-row"><span>{result.periods[hover.i].label} (UTC)</span><b>{result.periods[hover.i].ms === 0 ? 'no plays' : fmtMetric(hl.values[hover.i], metric)}</b></div>
          <div className="tt-row tt-muted"><span>Peak</span><b>{result.periods[hl.peak].label} · {fmtMetric(hl.peakValue, metric)}</b></div>
          <div className="tt-note">Click for top tracks</div>
        </div>
      )}
    </div>
  );
});

function truncate(s: string, n: number) {
  return s.length > n ? s.slice(0, n - 1) + '…' : s;
}
