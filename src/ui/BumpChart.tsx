import { forwardRef, useMemo, useState } from 'react';
import { valueAt, type AggregateResult, type Metric } from '../core/aggregate';
import type { RankResult } from '../core/ranks';
import { seriesColor, type Theme } from './theme';
import { fmtMetric } from './format';
import { edgeAnchor } from './FlowChart';
import { tipStyle } from './Tooltip';

interface Props {
  result: AggregateResult;
  ranks: RankResult;
  metric: Metric;
  maxRank: number;
  width: number;
  theme: Theme;
  highlight: string | null;
  onSelect: (seriesKey: string, periodIndex: number) => void;
}

function luminance(hex: string) {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/**
 * Bump chart: rank of each top item among ALL items per period. A line is drawn only while the
 * item is inside the shown ranks; leaving or entering the shown ranks is marked with a short
 * fading stub, so lines never pile up on an "out of range" row.
 */
export const BumpChart = forwardRef<SVGSVGElement, Props>(function BumpChart({ result, ranks, metric, maxRank, width, theme, highlight, onSelect }, ref) {
  const [hover, setHover] = useState<{ s: number; i: number; x: number; y: number } | null>(null);
  const narrow = width < 640;
  const items = useMemo(() => result.series.filter((s) => s.kind === 'item'), [result]);
  const P = result.periods.length;
  const rowH = narrow ? 30 : 38;
  const M = { top: 22, right: narrow ? 14 : 170, bottom: 36, left: narrow ? 30 : 46 };
  const height = M.top + maxRank * rowH + M.bottom;
  const innerW = Math.max(10, width - M.left - M.right);
  const colW = P > 1 ? innerW / (P - 1) : innerW;
  const x = (i: number) => (P > 1 ? i * colW : innerW / 2);
  const y = (rank: number) => (rank - 0.5) * rowH;
  const big = colW >= 46 && rowH >= 34; // room for rank numbers inside markers
  const R = big ? 11 : 5;
  const stride = Math.max(1, Math.ceil(64 / Math.max(1, colW)));
  const dim = highlight ?? (hover ? items[hover.s]?.key : null);
  const inRange = (v: number | null | undefined): v is number => v != null && v <= maxRank;

  const geo = items.map((s, si) => {
    const r = ranks.ranks[si] ?? [];
    const segs: string[] = [];
    const stubs: string[] = [];
    const ends: Array<{ i: number; rank: number }> = []; // last point of each run
    // Stubs are short and capped in pixels so wide columns do not draw long arcs.
    const st = Math.min(colW * 0.22, 34);
    const lowOf = (a: number) => Math.min(y(maxRank) + rowH * 0.45, y(a) + rowH * 1.6);
    for (let i = 0; i < P; i++) {
      const a = r[i];
      const b = r[i + 1];
      if (inRange(a) && i + 1 < P && inRange(b)) {
        const x0 = x(i), x1 = x(i + 1), y0 = y(a), y1 = y(b), xm = (x0 + x1) / 2;
        segs.push(`M${x0},${y0}C${xm},${y0} ${xm},${y1} ${x1},${y1}`);
      } else if (inRange(a) && i + 1 < P && b != null) {
        // drops out of the shown ranks: a short stub heading down
        stubs.push(`M${x(i)},${y(a)}C${x(i) + st * 0.6},${y(a)} ${x(i) + st * 0.8},${lowOf(a)} ${x(i) + st},${lowOf(a)}`);
      }
      if (inRange(a) && !inRange(b)) ends.push({ i, rank: a });
      if (inRange(a) && i > 0 && !inRange(r[i - 1]) && r[i - 1] != null) {
        // comes back into the shown ranks
        stubs.push(`M${x(i) - st},${lowOf(a)}C${x(i) - st * 0.8},${lowOf(a)} ${x(i) - st * 0.6},${y(a)} ${x(i)},${y(a)}`);
      }
    }
    return { s, si, r, segs, stubs, ends };
  });

  // End-of-run labels, de-overlapped per column (the higher rank wins).
  const byCol = new Map<number, Array<{ key: string; label: string; rank: number }>>();
  for (const g of geo) for (const e of g.ends) byCol.set(e.i, [...(byCol.get(e.i) ?? []), { key: g.s.key, label: g.s.label, rank: e.rank }]);
  const labels: Array<{ key: string; label: string; x: number; y: number; last: boolean }> = [];
  for (const [i, arr] of byCol) {
    arr.sort((a, b) => a.rank - b.rank);
    let lastY = -Infinity;
    for (const a of arr) {
      const yy = y(a.rank);
      if (yy - lastY < 14) continue;
      lastY = yy;
      labels.push({ key: a.key, label: a.label, x: x(i), y: yy, last: i === P - 1 });
    }
  }

  return (
    <div className="chart-wrap" style={{ height }}>
      <svg
        ref={ref}
        width={width}
        height={height}
        viewBox={`0 0 ${width} ${height}`}
        role="img"
        aria-label={`Rank chart: each top item's rank among all items per UTC ${result.settings.granularity}, ranks 1 to ${maxRank} shown. Lines end when an item leaves the top ${maxRank}.`}
        fontFamily="system-ui, -apple-system, 'Segoe UI', sans-serif"
        className="chart-svg"
        onPointerLeave={() => setHover(null)}
      >
        <rect width={width} height={height} fill={theme.surface} />
        <g transform={`translate(${M.left},${M.top})`}>
          {Array.from({ length: maxRank }, (_, k) => (
            <g key={k}>
              <line x1={0} x2={innerW} y1={(k + 0.5) * rowH} y2={(k + 0.5) * rowH} stroke={theme.grid} />
              <text x={-14} y={(k + 0.5) * rowH} dy="0.35em" textAnchor="end" fontSize={11} fill={theme.muted} style={{ fontVariantNumeric: 'tabular-nums' }}>#{k + 1}</text>
            </g>
          ))}
          {result.periods.map((p, i) => p.ms === 0 ? (
            <rect key={`e${i}`} data-empty-period={p.label} x={x(i) - Math.max(8, colW * 0.4) / 2} y={0} width={Math.max(8, colW * 0.4)} height={maxRank * rowH} fill={theme.emptyBand} rx={3} />
          ) : null)}
          {geo.map(({ s, segs, stubs }) => {
            const color = seriesColor(s, theme);
            const on = !dim || dim === s.key;
            return (
              <g key={s.key} opacity={on ? 1 : 0.12}>
                <path d={stubs.join('')} fill="none" stroke={color} strokeWidth={2.5} strokeLinecap="round" opacity={0.4} />
                <path d={segs.join('')} fill="none" stroke={color} strokeWidth={dim === s.key ? 5 : 3.5} strokeLinecap="round" />
              </g>
            );
          })}
          {geo.map(({ s, si, r }) => {
            const color = seriesColor(s, theme);
            const on = !dim || dim === s.key;
            const ink = luminance(color) > 0.45 ? theme.ink : '#ffffff';
            return (
              <g key={`m${s.key}`} data-bump={s.label} opacity={on ? 1 : 0.12}>
                {r.map((v, i) => (inRange(v) ? (
                  <g key={i} style={{ cursor: 'pointer' }}
                    onPointerEnter={() => setHover({ s: si, i, x: M.left + x(i), y: M.top + y(v) })}
                    onClick={() => onSelect(s.key, i)}>
                    <circle cx={x(i)} cy={y(v)} r={R} fill={color} stroke={theme.surface} strokeWidth={2} data-rank={v} data-period={result.periods[i].label} />
                    {big && <text x={x(i)} y={y(v)} dy="0.35em" textAnchor="middle" fontSize={10.5} fontWeight={700} fill={ink} pointerEvents="none">{v}</text>}
                  </g>
                ) : null))}
              </g>
            );
          })}
          {!narrow && labels.map((l) => (
            <text key={`${l.key}-${l.x}`} x={l.x + R + 5} y={l.y} dy="0.35em" fontSize={12} fill={theme.ink} fontWeight={600}
              stroke={theme.surface} strokeWidth={3.5} paintOrder="stroke" pointerEvents="none" opacity={!dim || dim === l.key ? 1 : 0.15}>
              {truncate(l.label, l.last ? 22 : 16)}
            </text>
          ))}
          {result.periods.map((p, i) => i % stride === 0 ? (
            <text key={p.label} x={x(i)} y={maxRank * rowH + 24} textAnchor={edgeAnchor(M.left + x(i), width)} fontSize={11.5} fill={theme.muted}>{p.label}</text>
          ) : null)}
        </g>
      </svg>
      {hover && items[hover.s] && (() => {
        const s = items[hover.s];
        const p = result.periods[hover.i];
        const rank = ranks.ranks[hover.s][hover.i];
        const valMetric = metric === 'share' ? 'hours' : metric;
        return (
          <div className="tooltip" role="status" style={tipStyle(hover.x, hover.y, width)}>
            <div className="tt-title"><span className="swatch" style={{ background: seriesColor(s, theme) }} />{s.label}</div>
            <div className="tt-row"><span>{p.label} (UTC)</span><b>#{rank} of {ranks.competitors[hover.i]}</b></div>
            <div className="tt-row tt-muted"><span>{metric === 'plays' ? 'Times played' : 'Listening'}</span><b>{fmtMetric(valueAt(s, p, hover.i, valMetric), valMetric)}</b></div>
            <div className="tt-note">Click for details</div>
          </div>
        );
      })()}
    </div>
  );
});

function truncate(s: string, n: number) {
  return s.length > n ? s.slice(0, n - 1) + '…' : s;
}
