import { forwardRef, useMemo, useState } from 'react';
import { METRIC_LABEL, type AggregateResult, type Metric } from '../core/aggregate';
import { layoutFlow, type FlowNode } from '../core/flow';
import { seriesColor, type Theme } from './theme';
import { fmtMetric } from './format';
import { Tooltip, tipStyle, type HoverState } from './Tooltip';
import { chartHeight, type OtherMode } from './StackedArea';

interface Props {
  result: AggregateResult;
  metric: Metric;
  otherMode: OtherMode;
  width: number;
  theme: Theme;
  highlight: string | null;
  onSelect: (seriesKey: string, periodIndex: number) => void;
}

/** Greedy vertical de-overlap for a column of labels. */
function placeLabels<T extends { y: number }>(items: T[], minGap: number, top: number, bottom: number): T[] {
  const sorted = [...items].sort((a, b) => a.y - b.y);
  const out: T[] = [];
  for (const it of sorted) {
    const prev = out[out.length - 1];
    if (it.y < top || it.y > bottom) continue;
    if (prev && it.y - prev.y < minGap) continue;
    out.push(it);
  }
  return out;
}

export const FlowChart = forwardRef<SVGSVGElement, Props>(function FlowChart({ result: full, metric, otherMode, width, theme, highlight, onSelect }, ref) {
  const result = useMemo(
    () => (otherMode === 'hidden' ? { ...full, series: full.series.filter((s) => s.kind !== 'other') } : full),
    [full, otherMode],
  );
  const [hover, setHover] = useState<HoverState | null>(null);
  const narrow = width < 640;
  const M = { top: 14, right: narrow ? 12 : 128, bottom: 36, left: narrow ? 12 : 128 };
  const height = chartHeight(width) + 40;
  const innerW = Math.max(10, width - M.left - M.right);
  const innerH = height - M.top - M.bottom;
  const P = result.periods.length;
  const nodeWidth = Math.max(4, Math.min(14, (innerW / Math.max(1, P)) * 0.28));

  const layout = useMemo(
    () => layoutFlow(result, metric, { width: innerW, height: innerH, nodeWidth, gap: P > 30 ? 1.5 : 3, otherBelow: otherMode === 'below' }),
    [result, metric, innerW, innerH, nodeWidth, P, otherMode],
  );
  const seriesByKey = useMemo(() => new Map(result.series.map((s) => [s.key, s])), [result]);

  const colW = P > 1 ? (innerW - nodeWidth) / (P - 1) : innerW;
  const stride = Math.max(1, Math.ceil(64 / Math.max(1, colW)));

  const edgeLabels = (colIndex: number, side: 'left' | 'right') => {
    const nodes = layout.nodes.filter((n) => n.periodIndex === colIndex && n.y1 - n.y0 >= 3);
    const items = nodes.map((n) => ({ n, y: (n.y0 + n.y1) / 2 }));
    return placeLabels(items, 13, 0, innerH).map(({ n, y }) => (
      <text
        key={`${side}${n.seriesKey}`}
        x={side === 'left' ? n.x0 - 6 : n.x1 + 6}
        y={y}
        dy="0.35em"
        textAnchor={side === 'left' ? 'end' : 'start'}
        fontSize={11.5}
        fill={theme.ink2}
        pointerEvents="none"
      >
        {truncate(seriesByKey.get(n.seriesKey)!.label, 17)}
      </text>
    ));
  };
  // First non-empty and last non-empty columns get edge labels.
  const firstCol = layout.columns.find((c) => !c.empty)?.periodIndex ?? 0;
  const lastCol = [...layout.columns].reverse().find((c) => !c.empty)?.periodIndex ?? P - 1;

  // Inline labels where a series first appears after the first column, if the node is tall enough.
  const entryLabels = useMemo(() => {
    const seen = new Set<string>();
    const out: FlowNode[] = [];
    for (const n of layout.nodes) {
      if (!seen.has(n.seriesKey)) {
        seen.add(n.seriesKey);
        if (n.periodIndex !== firstCol && n.y1 - n.y0 >= 16) out.push(n);
      }
    }
    return out;
  }, [layout, firstCol]);

  const dim = highlight ?? hover?.key ?? null;
  const op = (key: string, on: number, off: number) => (dim && dim !== key ? off : on);
  const nodeHover = (n: FlowNode) => setHover({ i: n.periodIndex, key: n.seriesKey, x: M.left + n.x1, y: M.top + n.y0 });

  return (
    <div className="chart-wrap" style={{ height }}>
      <svg
        ref={ref}
        width={width}
        height={height}
        viewBox={`0 0 ${width} ${height}`}
        role="img"
        aria-label={`Flow chart of ${METRIC_LABEL[metric]} per UTC ${result.settings.granularity}. Each column is a period; bands are the same artists as the timeline, sorted largest first. Ribbons join the same artist in neighbouring periods.`}
        fontFamily="system-ui, -apple-system, 'Segoe UI', sans-serif"
        className="chart-svg"
        onPointerLeave={() => setHover(null)}
      >
        <rect width={width} height={height} fill={theme.surface} />
        <g transform={`translate(${M.left},${M.top})`}>
          {layout.columns.map((c) => c.empty ? (
            <g key={`e${c.periodIndex}`} data-empty-period={result.periods[c.periodIndex].label}>
              <rect x={c.x - Math.max(nodeWidth, colW * 0.5) / 2} y={0} width={Math.max(nodeWidth, colW * 0.5)} height={innerH} fill={theme.emptyBand} rx={3} />
              <text x={c.x} y={innerH / 2} fontSize={11} fill={theme.muted} textAnchor="middle" transform={`rotate(-90 ${c.x} ${innerH / 2})`}>no plays</text>
            </g>
          ) : null)}
          {layout.baseline !== null && (
            <line x1={-6} x2={innerW + 6} y1={layout.baseline + (P > 30 ? 1.5 : 3)} y2={layout.baseline + (P > 30 ? 1.5 : 3)} stroke={theme.ink2} strokeWidth={1.5} data-zero-line="" pointerEvents="none" />
          )}
          {layout.ribbons.map((r) => {
            const s = seriesByKey.get(r.seriesKey)!;
            return (
              <path
                key={`${r.seriesKey}-${r.from.periodIndex}`}
                d={r.path}
                fill={seriesColor(s, theme)}
                opacity={op(r.seriesKey, 0.42, 0.07)}
                data-ribbon={s.label}
                onPointerMove={(e) => setHover({ i: r.from.periodIndex, toI: r.to.periodIndex, key: r.seriesKey, x: e.nativeEvent.offsetX, y: e.nativeEvent.offsetY })}
                onClick={() => onSelect(r.seriesKey, r.from.periodIndex)}
                style={{ cursor: 'pointer' }}
              />
            );
          })}
          {layout.nodes.map((n) => {
            const s = seriesByKey.get(n.seriesKey)!;
            return (
              <rect
                key={`${n.seriesKey}-${n.periodIndex}`}
                x={n.x0}
                y={n.y0}
                width={n.x1 - n.x0}
                height={Math.max(0.5, n.y1 - n.y0)}
                rx={Math.min(2, (n.y1 - n.y0) / 2)}
                fill={seriesColor(s, theme)}
                opacity={op(n.seriesKey, 1, 0.2)}
                data-node={s.label}
                data-period={result.periods[n.periodIndex].label}
                data-value={n.value}
                data-clipped={n.clipped ? '' : undefined}
                onPointerEnter={() => nodeHover(n)}
                onClick={() => onSelect(n.seriesKey, n.periodIndex)}
                style={{ cursor: 'pointer' }}
              />
            );
          })}
          {layout.nodes.filter((n) => n.clipped).map((n) => (
            <path key={`cut${n.periodIndex}`} pointerEvents="none" stroke={theme.surface} strokeWidth={2.5} fill="none"
              d={`M${n.x0 - 3},${n.y1 - 7} L${n.x1 + 3},${n.y1 - 12} M${n.x0 - 3},${n.y1 - 2} L${n.x1 + 3},${n.y1 - 7}`}>
              <title>Clipped: Other is taller than shown</title>
            </path>
          ))}
          {!narrow && edgeLabels(firstCol, 'left')}
          {!narrow && edgeLabels(lastCol, 'right')}
          {entryLabels.map((n) => (!dim || dim === n.seriesKey) && (
            <text
              key={`in${n.seriesKey}`}
              x={n.x0 - 5}
              y={(n.y0 + n.y1) / 2}
              dy="0.35em"
              textAnchor="end"
              fontSize={11.5}
              fontWeight={600}
              fill={theme.ink}
              stroke={theme.surface}
              strokeWidth={3}
              paintOrder="stroke"
              pointerEvents="none"
            >
              {truncate(seriesByKey.get(n.seriesKey)!.label, 18)}
            </text>
          ))}
          {result.periods.map((p, i) => i % stride === 0 ? (
            <text key={p.label} x={layout.columns[i].x} y={innerH + 22} textAnchor={edgeAnchor(M.left + layout.columns[i].x, width)} fontSize={11} fill={theme.muted}>{p.label}</text>
          ) : null)}
        </g>
      </svg>
      {hover && (
        hover.toI === undefined ? <NodeTip result={result} metric={metric} theme={theme} hover={hover} width={width} layoutRank={layout.nodes.find((n) => n.periodIndex === hover.i && n.seriesKey === hover.key)?.rank} />
          : <Tooltip result={result} metric={metric} theme={theme} hover={hover} width={width} />
      )}
    </div>
  );
});

function NodeTip({ result, metric, theme, hover, width, layoutRank }: { result: AggregateResult; metric: Metric; theme: Theme; hover: HoverState; width: number; layoutRank?: number }) {
  const s = result.series.find((x) => x.key === hover.key);
  const p = result.periods[hover.i];
  if (!s || !p) return null;
  const count = result.series.filter((x) => (x.ms[hover.i] ?? 0) > 0).length;
  const style = tipStyle(hover.x, hover.y + 20, width);
  const v = metric === 'hours' ? s.ms[hover.i] / 3_600_000 : metric === 'plays' ? s.plays[hover.i] : p.ms ? (s.ms[hover.i] / p.ms) * 100 : null;
  return (
    <div className="tooltip" role="status" style={style}>
      <div className="tt-title"><span className="swatch" style={{ background: seriesColor(s, theme) }} />{s.label}</div>
      <div className="tt-row"><span>{p.label} (UTC)</span><b>{fmtMetric(v, metric)}</b></div>
      {layoutRank !== undefined && <div className="tt-row tt-muted"><span>Position in period</span><b>{layoutRank + 1} of {count}</b></div>}
      <div className="tt-note">Click for top tracks</div>
    </div>
  );
}

export function edgeAnchor(x: number, width: number): 'start' | 'middle' | 'end' {
  if (x < 32) return 'start';
  if (x > width - 32) return 'end';
  return 'middle';
}

function truncate(s: string, n: number) {
  return s.length > n ? s.slice(0, n - 1) + '…' : s;
}
