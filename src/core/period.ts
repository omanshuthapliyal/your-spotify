/** UTC period arithmetic. All bucketing in the app goes through these functions. */
export type Granularity = 'month' | 'quarter' | 'year';

export interface Period {
  index: number;
  start: number; // inclusive, epoch ms UTC
  end: number; // exclusive, epoch ms UTC
  label: string;
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** Ordinal count of periods since year 0 for the given timestamp. */
export function periodOrdinal(ms: number, g: Granularity): number {
  const d = new Date(ms);
  const y = d.getUTCFullYear();
  const m = d.getUTCMonth();
  if (g === 'year') return y;
  if (g === 'quarter') return y * 4 + Math.floor(m / 3);
  return y * 12 + m;
}

function ordinalStart(ord: number, g: Granularity): number {
  if (g === 'year') return Date.UTC(ord, 0, 1);
  if (g === 'quarter') return Date.UTC(Math.floor(ord / 4), (ord % 4) * 3, 1);
  return Date.UTC(Math.floor(ord / 12), ord % 12, 1);
}

export function ordinalLabel(ord: number, g: Granularity): string {
  if (g === 'year') return String(ord);
  if (g === 'quarter') return `${Math.floor(ord / 4)} Q${(ord % 4) + 1}`;
  return `${MONTHS[ord % 12]} ${Math.floor(ord / 12)}`;
}

export function periodStart(ms: number, g: Granularity): number {
  return ordinalStart(periodOrdinal(ms, g), g);
}

/** Every period from the one containing `fromMs` to the one containing `toMs`, inclusive. Empty periods included. */
export function enumeratePeriods(fromMs: number, toMs: number, g: Granularity): Period[] {
  const a = periodOrdinal(fromMs, g);
  const b = periodOrdinal(toMs, g);
  const out: Period[] = [];
  for (let o = a; o <= b; o++) {
    out.push({ index: o - a, start: ordinalStart(o, g), end: ordinalStart(o + 1, g), label: ordinalLabel(o, g) });
  }
  return out;
}

