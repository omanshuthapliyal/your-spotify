import type { AggregateResult, Metric } from '../core/aggregate';
import { seriesColor, type Theme } from './theme';
import { fmtHours, fmtMetric } from './format';

interface Props {
  result: AggregateResult;
  metric: Metric;
  theme: Theme;
  pinned: string | null;
  onHover: (key: string | null) => void;
  onTogglePin: (key: string) => void;
}

/** Legend for stacked charts. "Other" is never drawn, so it is listed with an outline swatch and "not drawn". */
export function Legend({ result, metric, theme, pinned, onHover, onTogglePin }: Props) {
  const total = result.included.ms;
  // Top of the stack first, matching the visual order.
  const items = [...result.series].reverse();
  return (
    <ul className="legend" aria-label="Legend. Hover to highlight, click to pin a highlight.">
      {items.map((s) => {
        const summary = metric === 'plays' ? fmtMetric(s.totalPlays, 'plays') + ' plays'
          : metric === 'share' ? fmtMetric(total ? (s.totalMs / total) * 100 : 0, 'share')
          : fmtHours(s.totalMs);
        return (
          <li key={s.key}>
            <button
              type="button"
              className={`legend-item${pinned === s.key ? ' pinned' : ''}${pinned && pinned !== s.key ? ' faded' : ''}`}
              aria-pressed={pinned === s.key}
              onMouseEnter={() => onHover(s.key)}
              onMouseLeave={() => onHover(null)}
              onFocus={() => onHover(s.key)}
              onBlur={() => onHover(null)}
              onClick={() => onTogglePin(s.key)}
            >
              <span
                className={`swatch${s.kind === 'unclassified' ? ' hatched' : ''}`}
                style={s.kind === 'other' ? { background: 'transparent', border: `1.5px solid ${theme.ink2}` } : { background: seriesColor(s, theme) }}
              />
              <span className="legend-label">{s.label}{s.kind === 'other' ? ` (${s.memberCount})` : ''}</span>
              <span className="legend-value">{summary}{s.kind === 'other' ? ' · not drawn' : ''}</span>
            </button>
          </li>
        );
      })}
    </ul>
  );
}
