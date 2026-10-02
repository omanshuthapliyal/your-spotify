import { forwardRef, useState } from 'react';
import type { ClockResult } from '../core/clock';
import type { Theme } from './theme';
import { fmtHours, fmtInt } from './format';
import { tipStyle } from './Tooltip';

const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
// Sequential single-hue ramp (blue). Light: near-surface -> dark. Dark: near-surface -> bright.
const RAMP_LIGHT = ['#eef4fd', '#cde2fb', '#9ec5f4', '#6da7ec', '#3987e5', '#256abf', '#184f95', '#0d366b'];
const RAMP_DARK = ['#1f2530', '#163056', '#184f95', '#1c5cab', '#2a78d6', '#3987e5', '#6da7ec', '#9ec5f4'];

function zoneName(c: ClockResult) {
  return c.timeZone ?? offsetLabel(c.offsetHours);
}

export function offsetLabel(h: number) {
  return h === 0 ? 'UTC' : `UTC${h > 0 ? '+' : '−'}${Math.abs(h)}`;
}

function rampColor(t: number, ramp: string[]) {
  const x = Math.max(0, Math.min(1, t)) * (ramp.length - 1);
  const i = Math.floor(x);
  const f = x - i;
  if (i >= ramp.length - 1) return ramp[ramp.length - 1];
  const a = hex(ramp[i]);
  const b = hex(ramp[i + 1]);
  return `rgb(${a.map((v, k) => Math.round(v + (b[k] - v) * f)).join(',')})`;
}
function hex(h: string) {
  return [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
}

interface Props {
  clock: ClockResult;
  width: number;
  theme: Theme;
}

export const ClockChart = forwardRef<SVGSVGElement, Props>(function ClockChart({ clock, width, theme }, ref) {
  const [hover, setHover] = useState<{ d: number; h: number; x: number; y: number } | null>(null);
  const narrow = width < 640;
  const M = { top: 26, right: 12, bottom: 56, left: narrow ? 36 : 48 };
  const innerW = Math.max(10, width - M.left - M.right);
  const cw = innerW / 24;
  const ch = Math.max(18, Math.min(cw, 40));
  const height = M.top + 7 * ch + M.bottom;
  const max = Math.max(1, ...clock.ms.flat());
  const ramp = theme.name === 'dark' ? RAMP_DARK : RAMP_LIGHT;
  const hourStride = narrow ? 6 : 3;
  const total = clock.ms.flat().reduce((a, b) => a + b, 0);

  return (
    <div className="chart-wrap" style={{ height }}>
      <svg
        ref={ref}
        width={width}
        height={height}
        viewBox={`0 0 ${width} ${height}`}
        role="img"
        aria-label={`Listening clock: listening time by weekday and hour of day in ${zoneName(clock)}. Darker means more listening.`}
        fontFamily="system-ui, -apple-system, 'Segoe UI', sans-serif"
        className="chart-svg"
        onPointerLeave={() => setHover(null)}
      >
        <rect width={width} height={height} fill={theme.surface} />
        <g transform={`translate(${M.left},${M.top})`}>
          {Array.from({ length: 24 }, (_, h) => h % hourStride === 0 && (
            <text key={h} x={h * cw + 1} y={-8} fontSize={11} fill={theme.muted} style={{ fontVariantNumeric: 'tabular-nums' }}>{String(h).padStart(2, '0')}:00</text>
          ))}
          {clock.ms.map((row, d) => (
            <g key={d}>
              <text x={-8} y={d * ch + ch / 2} dy="0.35em" textAnchor="end" fontSize={11.5} fill={theme.ink2}>{DAYS[d]}</text>
              {row.map((v, h) => (
                <rect
                  key={h}
                  x={h * cw + 1}
                  y={d * ch + 1}
                  width={cw - 2}
                  height={ch - 2}
                  rx={3}
                  fill={v === 0 ? theme.emptyBand : rampColor(v / max, ramp)}
                  data-cell={`${DAYS[d]}-${h}`}
                  data-ms={v}
                  onPointerEnter={() => setHover({ d, h, x: M.left + h * cw + cw, y: M.top + d * ch })}
                />
              ))}
            </g>
          ))}
          {/* scale legend */}
          <g transform={`translate(0,${7 * ch + 18})`}>
            <defs>
              <linearGradient id="clock-ramp" x1="0" x2="1" y1="0" y2="0">
                {ramp.map((c, i) => <stop key={i} offset={i / (ramp.length - 1)} stopColor={c} />)}
              </linearGradient>
            </defs>
            <rect x={0} y={0} width={Math.min(260, innerW)} height={10} rx={3} fill="url(#clock-ramp)" />
            <text x={0} y={26} fontSize={11} fill={theme.muted}>0</text>
            <text x={Math.min(260, innerW)} y={26} fontSize={11} fill={theme.muted} textAnchor="end">{fmtHours(max)} per cell</text>
            {!narrow && <text x={Math.min(260, innerW) + 16} y={9} fontSize={11} fill={theme.muted}>Total listening per weekday-hour over the range, {zoneName(clock)}</text>}
          </g>
        </g>
      </svg>
      {hover && (
        <div className="tooltip" role="status" style={tipStyle(hover.x, hover.y, width)}>
          <div className="tt-title">{DAYS[hover.d]} {String(hover.h).padStart(2, '0')}:00–{String((hover.h + 1) % 24).padStart(2, '0')}:00 <span className="tt-muted">{zoneName(clock)}</span></div>
          <div className="tt-row"><span>Total</span><b>{fmtHours(clock.ms[hover.d][hover.h])}</b></div>
          <div className="tt-row"><span>Plays</span><b>{fmtInt(clock.plays[hover.d][hover.h])}</b></div>
          <div className="tt-row tt-muted"><span>Share of all listening</span><b>{total ? ((clock.ms[hover.d][hover.h] / total) * 100).toFixed(1) : '0.0'}%</b></div>
          <div className="tt-row tt-muted"><span>Average per week</span><b>{Math.round(clock.ms[hover.d][hover.h] / clock.weeks / 60_000)} min</b></div>
        </div>
      )}
    </div>
  );
});
