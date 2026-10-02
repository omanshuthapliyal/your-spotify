import { useState } from 'react';
import { useWidth } from './useWidth';
import type { Theme } from './theme';
import { fmtHours } from './format';

const FONT = "system-ui, -apple-system, 'Segoe UI', sans-serif";
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const monthLabel = (ord: number) => `${MONTHS[ord % 12]} ${Math.floor(ord / 12)}`;

/** Vertical bars for any labelled series (hours of day, length buckets, months). */
export function ColumnBars({ items, theme, fmt, label, height = 120, tickEvery = 1, highlightMax = false }: {
  items: Array<{ key: string; label: string; value: number; tip?: string }>; theme: Theme; fmt: (v: number) => string; label: string;
  height?: number; tickEvery?: number; highlightMax?: boolean;
}) {
  const [ref, width] = useWidth<HTMLDivElement>();
  const [hover, setHover] = useState<number | null>(null);
  const max = Math.max(1e-9, ...items.map((i) => i.value));
  const bw = Math.max(2, (width - 4) / Math.max(1, items.length));
  const peak = items.reduce((b, it, i) => (it.value > items[b].value ? i : b), 0);
  return (
    <div ref={ref} className="chart-wrap">
      <svg width={width} height={height + 40} role="img" aria-label={`${label}: ${items.map((i) => `${i.label} ${fmt(i.value)}`).join(', ')}`} fontFamily={FONT} onPointerLeave={() => setHover(null)}>
        {items.map((it, i) => {
          const h = (it.value / max) * height;
          return (
            <g key={it.key} onPointerEnter={() => setHover(i)} data-bar={it.key}>
              <rect x={i * bw} y={10} width={bw} height={height} fill="transparent" />
              <rect x={i * bw + Math.min(1.5, bw * 0.15)} y={height - h + 10} width={Math.max(1, bw - Math.min(3, bw * 0.3))} height={h} rx={Math.min(3, bw / 3)}
                fill={highlightMax && i === peak ? theme.series[1] : hover === i ? theme.series[16] : theme.series[0]} />
              {i % tickEvery === 0 && <text x={i * bw + bw / 2} y={height + 26} textAnchor="middle" fontSize={10.5} fill={theme.muted}>{it.label}</text>}
            </g>
          );
        })}
        <line x1={0} x2={items.length * bw} y1={height + 10} y2={height + 10} stroke={theme.axis} />
      </svg>
      {hover !== null && items[hover] && (
        <div className="tooltip" role="status" style={{ left: Math.min(hover * bw + bw + 8, width - 190), top: 4 }}>
          <div className="tt-title">{items[hover].tip ?? items[hover].label}</div>
          <div className="tt-row"><span>{label}</span><b>{fmt(items[hover].value)}</b></div>
        </div>
      )}
    </div>
  );
}

/** Monthly bars over a range, labelled by year. */
export function MonthBars({ months, from, to, theme, label, fmt }: {
  months: Array<[number, number]>; from: number; to: number; theme: Theme; label: string; fmt: (v: number) => string;
}) {
  const m = new Map(months);
  const items = Array.from({ length: Math.max(0, to - from + 1) }, (_, k) => {
    const ord = from + k;
    return { key: String(ord), label: ord % 12 === 0 ? String(Math.floor(ord / 12)) : '', value: m.get(ord) ?? 0, tip: monthLabel(ord) };
  });
  return <ColumnBars items={items} theme={theme} fmt={fmt} label={label} highlightMax />;
}

/** Ranked horizontal bars; rows are clickable when `onClick` is given. */
export function HBars({ rows, theme, testId }: {
  rows: Array<{ key: string; label: string; sub?: string; value: number; display: string; onClick?: () => void }>; theme: Theme; testId?: string;
}) {
  const max = Math.max(1e-9, ...rows.map((r) => r.value));
  return (
    <ol className="hbars" data-testid={testId}>
      {rows.map((r) => {
        const body = (
          <>
            <span className="hb-label"><b>{r.label}</b>{r.sub && <small>{r.sub}</small>}</span>
            <span className="hb-bar"><span style={{ width: `${(r.value / max) * 100}%`, background: theme.series[0] }} /></span>
            <span className="hb-val">{r.display}</span>
          </>
        );
        return <li key={r.key}>{r.onClick ? <button type="button" className="hb-row" onClick={r.onClick}>{body}</button> : <div className="hb-row">{body}</div>}</li>;
      })}
    </ol>
  );
}

/**
 * Heat rows: one row per artist, one cell per column (months or years), darker = more listening.
 * Gaps (no listening) stay empty, which is what makes comebacks and loyalty visible.
 */
export function HeatRows({ rows, columns, theme, unit, onRow, testId }: {
  rows: Array<{ key: string; label: string; cells: Map<number, number>; onClick?: () => void }>;
  columns: Array<{ key: number; label: string }>; theme: Theme; unit: 'month' | 'year'; onRow?: boolean; testId?: string;
}) {
  const [ref, width] = useWidth<HTMLDivElement>();
  const [hover, setHover] = useState<{ r: number; c: number; x: number; y: number } | null>(null);
  const left = Math.min(210, Math.max(110, width * 0.22));
  const cw = Math.max(2, (width - left - 4) / Math.max(1, columns.length));
  const rh = 22;
  const max = Math.max(1, ...rows.flatMap((r) => [...r.cells.values()]));
  const ramp = theme.name === 'dark' ? ['#163056', '#184f95', '#2a78d6', '#3987e5', '#6da7ec', '#9ec5f4'] : ['#cde2fb', '#9ec5f4', '#6da7ec', '#3987e5', '#256abf', '#184f95'];
  const color = (v: number) => (v <= 0 ? theme.emptyBand : ramp[Math.min(ramp.length - 1, Math.floor(Math.sqrt(v / max) * ramp.length))]);
  const tickEvery = unit === 'month' ? 12 : Math.max(1, Math.ceil(36 / cw));
  const height = rows.length * rh + 26;
  void onRow;
  return (
    <div ref={ref} className="chart-wrap" data-testid={testId}>
      <svg width={width} height={height} role="img" aria-label={`Listening per ${unit} for ${rows.map((r) => r.label).join(', ')}`} fontFamily={FONT} onPointerLeave={() => setHover(null)}>
        {rows.map((r, ri) => (
          <g key={r.key} data-heat-row={r.label}>
            <text x={left - 8} y={ri * rh + rh / 2} dy="0.35em" textAnchor="end" fontSize={12} fill={theme.ink} style={{ cursor: r.onClick ? 'pointer' : 'default' }} onClick={r.onClick}>
              <title>{r.label}</title>{r.label.length > 28 ? r.label.slice(0, 27) + '…' : r.label}
            </text>
            {columns.map((c, ci) => (
              <rect key={c.key} x={left + ci * cw} y={ri * rh + 3} width={Math.max(1, cw - (cw > 6 ? 1.5 : 0.5))} height={rh - 6} rx={cw > 8 ? 3 : 1}
                fill={color(r.cells.get(c.key) ?? 0)} onPointerEnter={() => setHover({ r: ri, c: ci, x: left + ci * cw, y: ri * rh })} />
            ))}
          </g>
        ))}
        {columns.map((c, ci) => (ci % tickEvery === 0 ? (
          <text key={c.key} x={left + ci * cw + (unit === 'year' ? cw / 2 : 0)} y={rows.length * rh + 16} textAnchor={unit === 'year' ? 'middle' : 'start'} fontSize={10.5} fill={theme.muted}>{c.label}</text>
        ) : null))}
      </svg>
      {hover && rows[hover.r] && (
        <div className="tooltip" role="status" style={{ left: Math.min(hover.x + 12, width - 200), top: hover.y + 24 }}>
          <div className="tt-title">{rows[hover.r].label}</div>
          <div className="tt-row"><span>{columns[hover.c].label || monthLabel(columns[hover.c].key)}</span><b>{fmtHours(rows[hover.r].cells.get(columns[hover.c].key) ?? 0)}</b></div>
        </div>
      )}
    </div>
  );
}

export function monthColumns(from: number, to: number) {
  return Array.from({ length: Math.max(0, to - from + 1) }, (_, k) => ({ key: from + k, label: (from + k) % 12 === 0 ? String(Math.floor((from + k) / 12)) : '' }));
}
