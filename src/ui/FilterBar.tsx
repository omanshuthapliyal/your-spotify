import { useState, type ReactNode } from 'react';
import type { AggregateSettings } from '../core/aggregate';
import type { Period } from '../core/period';
import { Controls } from './Controls';

const METRIC = { hours: 'Hours', share: 'Share', plays: 'Plays' } as const;
const PER = { month: 'per month', quarter: 'per quarter', year: 'per year' } as const;

/**
 * One compact line that applies to every view: year chips, a readable summary of the current
 * filters, and an Edit button that opens the full controls.
 */
export function FilterBar(p: {
  settings: AggregateSettings; periods: Period[]; years: number[]; allRange: { from: number; to: number } | null;
  topNLabel: string; showTopN: boolean; onChange: (s: AggregateSettings) => void; note: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const { settings: s } = p;
  const set = (patch: Partial<AggregateSettings>) => p.onChange({ ...s, ...patch });
  const yearOfRange = (() => {
    if (!s.range) return null;
    const y = new Date(s.range.from).getUTCFullYear();
    return s.range.from === Date.UTC(y, 0, 1) && s.range.to === Date.UTC(y + 1, 0, 1) - 1 ? y : null;
  })();
  const isAll = (!s.range && !p.allRange) || Boolean(s.range && p.allRange && s.range.from === p.allRange.from && s.range.to === p.allRange.to);
  const rangeText = isAll ? 'All years' : yearOfRange ? String(yearOfRange)
    : s.range ? `${p.periods.find((x) => x.end > s.range!.from)?.label ?? ''} – ${p.periods.find((x) => x.end > s.range!.to)?.label ?? p.periods[p.periods.length - 1]?.label}` : 'Full history';
  return (
    <div className="filter-bar" data-testid="filter-bar">
      <div className="filter-line">
        <div className="year-chips" role="group" aria-label="Quick date range">
          <button type="button" className={`chip chip-btn${isAll ? ' on' : ''}`} aria-pressed={isAll} onClick={() => set({ range: p.allRange })}>All years</button>
          {p.years.map((y) => (
            <button key={y} type="button" className={`chip chip-btn${yearOfRange === y ? ' on' : ''}`} aria-pressed={yearOfRange === y}
              onClick={() => set({ range: { from: Date.UTC(y, 0, 1), to: Date.UTC(y + 1, 0, 1) - 1 } })}>{y}</button>
          ))}
        </div>
        <span className="filter-summary" data-testid="filter-summary">
          {rangeText} · {PER[s.granularity]} · {METRIC[s.metric]}{p.showTopN ? ` · top ${s.topN}` : ''} · plays ≥ {s.minMs / 1000} s
        </span>
        <button type="button" className="btn ghost" aria-expanded={open} onClick={() => setOpen((v) => !v)}>{open ? 'Done' : 'Edit filters'}</button>
      </div>
      {open && <Controls settings={s} periods={p.periods} years={[]} allRange={p.allRange} topNLabel={p.topNLabel} showTopN={p.showTopN} onChange={p.onChange} hideChips />}
      {p.note && <p className="muted small range-hint">{p.note}</p>}
    </div>
  );
}
