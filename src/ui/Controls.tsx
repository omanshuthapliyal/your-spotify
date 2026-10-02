import { MAX_TOP_N, type AggregateSettings, type Metric } from '../core/aggregate';
import type { Granularity, Period } from '../core/period';

interface Props {
  settings: AggregateSettings;
  periods: Period[]; // full-history periods at the current granularity
  /** Calendar years with data, for one-click year chips. */
  years: number[];
  /** The default ("All") range: regular listening, or null for full history. */
  allRange: { from: number; to: number } | null;
  topNLabel: string;
  showTopN: boolean;
  /** The filter bar shows the year chips itself. */
  hideChips?: boolean;
  onChange: (s: AggregateSettings) => void;
}

export function Segmented<T extends string>({ label, value, options, onChange, disabled, onUnavailable }: {
  label: string; value: T; options: Array<[T, string]>; onChange: (v: T) => void; disabled?: Partial<Record<T, string>>;
  /** Options that are clickable but not yet usable (e.g. Genre before a mapping is loaded). */
  onUnavailable?: (v: T) => boolean;
}) {
  return (
    <div className="control" role="radiogroup" aria-label={label}>
      <span className="control-label">{label}</span>
      <div className="segmented">
        {options.map(([v, text]) => (
          <button
            key={v}
            type="button"
            role="radio"
            aria-checked={value === v}
            className={`${value === v ? 'on' : ''}${onUnavailable?.(v) ? ' unavailable' : ''}`}
            title={onUnavailable?.(v) ? 'No genre mapping loaded yet. Click to see how to add one.' : disabled?.[v]}
            disabled={Boolean(disabled?.[v])}
            onClick={() => onChange(v)}
          >{text}</button>
        ))}
      </div>
    </div>
  );
}

export function Controls({ settings, periods, years, allRange, topNLabel, showTopN, onChange, hideChips }: Props) {
  const set = (patch: Partial<AggregateSettings>) => onChange({ ...settings, ...patch });
  const fromIdx = settings.range ? Math.max(0, periods.findIndex((p) => p.end > settings.range!.from)) : 0;
  const toIdxRaw = settings.range ? periods.findIndex((p) => p.end > settings.range!.to) : -1;
  const toIdx = toIdxRaw === -1 ? periods.length - 1 : toIdxRaw;
  const setRange = (a: number, b: number) => {
    if (a <= 0 && b >= periods.length - 1) set({ range: null });
    else set({ range: { from: periods[a].start, to: periods[b].end - 1 } });
  };
  const yearOfRange = (() => {
    const r = settings.range;
    if (!r) return null;
    const y = new Date(r.from).getUTCFullYear();
    return r.from === Date.UTC(y, 0, 1) && r.to === Date.UTC(y + 1, 0, 1) - 1 ? y : null;
  })();
  const isAll = (!settings.range && !allRange) || (settings.range && allRange && settings.range.from === allRange.from && settings.range.to === allRange.to);
  return (
    <div className="controls-wrap">
    {!hideChips && <div className="year-chips" role="group" aria-label="Quick date range">
      <button type="button" className={`chip chip-btn${isAll ? ' on' : ''}`} aria-pressed={Boolean(isAll)} onClick={() => set({ range: allRange })}>All years</button>
      {years.map((y) => (
        <button key={y} type="button" className={`chip chip-btn${yearOfRange === y ? ' on' : ''}`} aria-pressed={yearOfRange === y}
          onClick={() => set({ range: { from: Date.UTC(y, 0, 1), to: Date.UTC(y + 1, 0, 1) - 1 } })}>{y}</button>
      ))}
    </div>}
    <div className="controls" aria-label="Filters for every view">
      <div className="control range">
        <span className="control-label">Dates</span>
        <span className="range-pair">
          <select value={fromIdx} aria-label="Range start" onChange={(e) => setRange(Number(e.target.value), Math.max(Number(e.target.value), toIdx))}>
            {periods.map((p, i) => <option key={p.label} value={i}>{p.label}</option>)}
          </select>
          <span className="muted">to</span>
          <select value={toIdx} aria-label="Range end" onChange={(e) => setRange(Math.min(fromIdx, Number(e.target.value)), Number(e.target.value))}>
            {periods.map((p, i) => <option key={p.label} value={i}>{p.label}</option>)}
          </select>
        </span>
      </div>
      <Segmented<Granularity> label="Per" value={settings.granularity} onChange={(g) => set({ granularity: g })}
        options={[['month', 'Month'], ['quarter', 'Quarter'], ['year', 'Year']]} />
      <Segmented<Metric> label="Measure" value={settings.metric} onChange={(m) => set({ metric: m })}
        options={[['hours', 'Hours'], ['share', 'Share'], ['plays', 'Plays']]} />
      {showTopN && <label className="control">
        <span className="control-label">Show top</span>
        <select value={settings.topN} onChange={(e) => set({ topN: Number(e.target.value) })} aria-label={topNLabel}>
          {Array.from({ length: MAX_TOP_N }, (_, i) => i + 1).map((n) => <option key={n} value={n}>{n}</option>)}
        </select>
      </label>}
      <details className="menu more-filters">
        <summary className="btn ghost">More · plays ≥ {settings.minMs / 1000} s</summary>
        <div className="menu-panel menu-right">
          <label className="control">
            <span className="control-label">Ignore plays shorter than</span>
            <span className="input-suffix">
              <input type="number" min={0} max={600} step={5} value={settings.minMs / 1000} aria-label="Minimum play duration in seconds"
                onChange={(e) => { const v = Number(e.target.value); if (Number.isFinite(v) && v >= 0) set({ minMs: Math.round(v * 1000) }); }} />
              <span>s</span>
            </span>
          </label>
          <p className="muted small">Spotify logs skips and previews as short plays. 30 s is the common cut-off. All periods are in UTC.</p>
        </div>
      </details>
    </div>
    </div>
  );
}
