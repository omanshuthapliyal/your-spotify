import { periodTotal, valueAt, type AggregateResult, type Metric } from '../core/aggregate';
import { seriesColor, type Theme } from './theme';
import { fmtHours, fmtInt, fmtMetric } from './format';

export interface HoverState {
  i: number;
  key: string | null;
  x: number;
  y: number;
  /** Flow ribbons: the next period, to show a change. */
  toI?: number;
}

const TIP_W = 250;

/** Keep the tooltip inside the chart: prefer right of the pointer, else left, else pinned to an edge. */
export function tipStyle(x: number, y: number, width: number) {
  const top = Math.max(4, y - 20);
  if (x + 14 + TIP_W <= width) return { left: x + 14, top };
  if (x - 14 - TIP_W >= 0) return { right: width - x + 14, top };
  return { left: Math.max(4, width - TIP_W - 4), top: top + 24 };
}

export function Tooltip({ result, metric, theme, hover, width }: { result: AggregateResult; metric: Metric; theme: Theme; hover: HoverState; width: number }) {
  const p = result.periods[hover.i];
  if (!p) return null;
  const style = tipStyle(hover.x, hover.y, width);

  if (hover.toI !== undefined && hover.key) {
    const s = result.series.find((x) => x.key === hover.key)!;
    const q = result.periods[hover.toI];
    const a = valueAt(s, p, hover.i, metric) ?? 0;
    const b = valueAt(s, q, hover.toI, metric) ?? 0;
    const d = b - a;
    return (
      <div className="tooltip" role="status" style={style}>
        <div className="tt-title"><span className="swatch" style={{ background: seriesColor(s, theme) }} />{s.label}</div>
        <div className="tt-row"><span>{p.label}</span><b>{fmtMetric(a, metric)}</b></div>
        <div className="tt-row"><span>{q.label}</span><b>{fmtMetric(b, metric)}</b></div>
        <div className="tt-row tt-muted"><span>Change</span><b>{d >= 0 ? '+' : '−'}{fmtMetric(Math.abs(d), metric)}</b></div>
        <div className="tt-note">Same artist in adjacent periods, not a transition between artists.</div>
      </div>
    );
  }

  const rows = result.series
    .map((s) => ({ s, v: valueAt(s, p, hover.i, metric) }))
    .reverse(); // top of the stack first
  return (
    <div className="tooltip" role="status" style={style}>
      <div className="tt-title">{p.label} <span className="tt-muted">(UTC)</span></div>
      {p.ms === 0 ? (
        <div className="tt-muted">No music plays recorded in this period.</div>
      ) : (
        <>
          {rows.map(({ s, v }) => (
            <div key={s.key} className={`tt-row${hover.key === s.key ? ' tt-active' : ''}`}>
              <span><span className="swatch" style={{ background: seriesColor(s, theme) }} />{s.label}</span>
              <b>{fmtMetric(v, metric)}</b>
            </div>
          ))}
          <div className="tt-row tt-total">
            <span>Total</span>
            <b>{metric === 'share' ? `${fmtHours(p.ms)} · ${fmtInt(p.plays)} plays` : fmtMetric(periodTotal(p, metric), metric)}</b>
          </div>
        </>
      )}
      <div className="tt-note">Click for top tracks</div>
    </div>
  );
}
