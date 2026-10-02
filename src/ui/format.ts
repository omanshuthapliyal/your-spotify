import type { Metric } from '../core/aggregate';

const nf0 = new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 });
const nf1 = new Intl.NumberFormat('en-US', { minimumFractionDigits: 1, maximumFractionDigits: 1 });

export function fmtInt(n: number): string {
  return nf0.format(n);
}
export function fmtHours(ms: number): string {
  const h = ms / 3_600_000;
  if (h === 0) return '0 h';
  if (h < 0.1) return `${Math.max(1, Math.round(ms / 60_000))} min`;
  return `${h >= 100 ? nf0.format(h) : nf1.format(h)} h`;
}
export function fmtMetric(v: number | null, metric: Metric): string {
  if (v === null) return '–';
  if (metric === 'hours') return v === 0 ? '0 h' : v < 0.1 ? `${Math.max(1, Math.round(v * 60))} min` : `${v >= 100 ? nf0.format(v) : nf1.format(v)} h`;
  if (metric === 'share') return `${nf1.format(v)}%`;
  return Number.isInteger(v) ? nf0.format(v) : nf1.format(v);
}
export function fmtAxis(v: number, metric: Metric): string {
  if (metric === 'share') return `${nf0.format(v)}%`;
  if (metric === 'hours') return `${nf0.format(v)} h`;
  return nf0.format(v);
}
export function fmtDate(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}
