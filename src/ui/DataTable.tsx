import { periodTotal, valueAt, METRIC_LABEL, type AggregateResult, type Metric } from '../core/aggregate';
import { fmtMetric } from './format';

export function DataTable({ result, metric }: { result: AggregateResult; metric: Metric }) {
  const series = [...result.series].reverse();
  return (
    <div className="table-scroll" tabIndex={0} aria-label="Chart data table">
      <table className="data-table">
        <caption>{METRIC_LABEL[metric]} per UTC {result.settings.granularity}</caption>
        <thead>
          <tr>
            <th scope="col">Period</th>
            {series.map((s) => <th scope="col" key={s.key}>{s.label}</th>)}
            <th scope="col">Total</th>
          </tr>
        </thead>
        <tbody>
          {result.periods.map((p, i) => (
            <tr key={p.label} className={p.ms === 0 ? 'empty-row' : undefined}>
              <th scope="row">{p.label}</th>
              {series.map((s) => <td key={s.key}>{fmtMetric(valueAt(s, p, i, metric), metric)}</td>)}
              <td>{p.ms === 0 ? 'no plays' : fmtMetric(periodTotal(p, metric), metric)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
