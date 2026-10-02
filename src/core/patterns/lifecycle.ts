/**
 * Artist lifecycles and how long new artists last.
 *
 * Lifecycle shapes are rule-based (so every label can be explained) and use monthly listening
 * from the artist's first month in range to the end of the range. Rules, in order:
 *  - new:       first played in the last 6 months, too early to tell.
 *  - seasonal:  in 2+ different years, 75%+ of listening falls in the same 3 calendar months.
 *  - flash:     65%+ of all listening falls in 3 consecutive months.
 *  - slow burn: the busiest 3 months start a year or more after discovery, the first 6 months
 *               averaged at most a quarter of that peak's monthly rate, and after the first
 *               year you listened at least twice as much per month as during it.
 *  - evergreen: played across 2+ years, in half the months or more, never more than 35% in any
 *               3 months, and still played in the last 6 months.
 *  - faded:     none of the above and not played in the last 6 months.
 *  - steady:    everything else.
 * Only artists with at least 2 hours and 10 plays are classified.
 *
 * Staying power is a Kaplan-Meier survival curve: for artists first played at least 3 months
 * after the range starts (so long-time favourites are not counted as new) and played on 2+
 * different days, "survival" is time from first to last play. An artist counts as stopped when
 * its last play is more than 6 months before the end of the range; otherwise it is censored
 * (still going, so we only know it lasted at least that long).
 */
import { MONTH_MS, monthOrd, type PatternInput } from './monthly';

export type LifeKind = 'evergreen' | 'slowburn' | 'flash' | 'seasonal' | 'steady' | 'faded' | 'new';
export const LIFE_KINDS: LifeKind[] = ['evergreen', 'slowburn', 'flash', 'seasonal', 'steady', 'faded', 'new'];
const DAY = 86_400_000;
const RECENT = 6;

export interface LifeArtist { id: number; name: string; kind: LifeKind; ms: number; firstMonth: number; lastMonth: number; peakMonth: number }

/** Classify one artist from its monthly listening (index 0 = first month in range). */
export function classifyLifecycle(monthly: ArrayLike<number>, firstIdx: number, endIdx: number): { kind: LifeKind; peakIdx: number } {
  let tot = 0, lastIdx = firstIdx, active = 0;
  for (let m = firstIdx; m <= endIdx; m++) { const v = monthly[m] ?? 0; tot += v; if (v > 0) { lastIdx = m; active++; } }
  let peak = 0, peakIdx = firstIdx;
  for (let m = firstIdx; m <= endIdx; m++) {
    const w = (monthly[m] ?? 0) + (monthly[m + 1] ?? 0) + (monthly[m + 2] ?? 0);
    if (w > peak) { peak = w; peakIdx = m; }
  }
  const peak3 = tot ? peak / tot : 0;
  if (firstIdx > endIdx - RECENT) return { kind: 'new', peakIdx };
  const span = lastIdx - firstIdx + 1;
  const recent = lastIdx > endIdx - RECENT;
  // Seasonality by calendar month (index -> month of year via the caller's alignment: index 0 = January of the first year).
  const cal = new Array(12).fill(0);
  const yearsWith = new Map<number, number>();
  for (let m = firstIdx; m <= endIdx; m++) cal[m % 12] += monthly[m] ?? 0;
  let bestW = 0, bestStart = 0;
  for (let s = 0; s < 12; s++) { const w = cal[s] + cal[(s + 1) % 12] + cal[(s + 2) % 12]; if (w > bestW) { bestW = w; bestStart = s; } }
  const inWindow = (m: number) => { const c = m % 12; return c === bestStart || c === (bestStart + 1) % 12 || c === (bestStart + 2) % 12; };
  for (let m = firstIdx; m <= endIdx; m++) {
    if (!inWindow(m)) continue;
    // A window that wraps the new year belongs to the year it starts in.
    const y = Math.floor((m - ((m % 12) - bestStart + 12) % 12) / 12);
    yearsWith.set(y, (yearsWith.get(y) ?? 0) + (monthly[m] ?? 0));
  }
  const strongYears = [...yearsWith.values()].filter((v) => v >= 0.1 * tot).length;
  if (tot && bestW / tot >= 0.75 && strongYears >= 2) return { kind: 'seasonal', peakIdx };
  if (peak3 >= 0.65) return { kind: 'flash', peakIdx };
  let early = 0;
  for (let m = firstIdx; m < firstIdx + 6 && m <= endIdx; m++) early += monthly[m] ?? 0;
  let firstYear = 0, later = 0;
  for (let m = firstIdx; m <= endIdx; m++) { if (m < firstIdx + 12) firstYear += monthly[m] ?? 0; else later += monthly[m] ?? 0; }
  const laterMonths = endIdx - firstIdx + 1 - 12;
  const grew = laterMonths > 0 && later / laterMonths >= 2 * (firstYear / 12);
  if (peakIdx - firstIdx >= 12 && early / 6 <= 0.25 * (peak / 3) && grew) return { kind: 'slowburn', peakIdx };
  if (span >= 24 && active / span >= 0.5 && peak3 <= 0.35 && recent) return { kind: 'evergreen', peakIdx };
  if (!recent) return { kind: 'faded', peakIdx };
  return { kind: 'steady', peakIdx };
}

export interface SurvivalPoint { t: number; s: number; atRisk: number }

/** Kaplan-Meier estimate. `t` in any unit; `stopped[i]` false = censored. */
export function kaplanMeier(t: number[], stopped: boolean[]): SurvivalPoint[] {
  const idx = t.map((_, i) => i).sort((a, b) => t[a] - t[b]);
  const out: SurvivalPoint[] = [{ t: 0, s: 1, atRisk: t.length }];
  let s = 1;
  let atRisk = t.length;
  let k = 0;
  while (k < idx.length) {
    const tt = t[idx[k]];
    let d = 0, c = 0;
    while (k < idx.length && t[idx[k]] === tt) { if (stopped[idx[k]]) d++; else c++; k++; }
    if (d > 0) { s *= 1 - d / atRisk; out.push({ t: tt, s, atRisk }); }
    atRisk -= d + c;
  }
  return out;
}

function survivalAt(curve: SurvivalPoint[], t: number): number {
  let s = 1;
  for (const p of curve) { if (p.t <= t) s = p.s; else break; }
  return s;
}

export interface LifecycleResult {
  firstMonth: number;
  months: number;
  counts: Record<LifeKind, number>;
  /** Classified artists, most listened first. */
  artists: LifeArtist[];
  /** Monthly listening (index from firstMonth) for the artists shown as examples. */
  series: Record<number, number[]>;
  survival: {
    curve: SurvivalPoint[];
    /** Months until half of new artists stop being played; null if more than half are still going. */
    halfLife: number | null;
    afterYear: number;
    artists: number;
    stopped: number;
    singleDay: number;
  };
  kindOf: Map<number, LifeKind>;
}

export function lifecycles(input: PatternInput, plays: number[], examples = 8): LifecycleResult {
  const { store } = input;
  const A = store.artistNames.length;
  const empty = { curve: [{ t: 0, s: 1, atRisk: 0 }], halfLife: null, afterYear: 1, artists: 0, stopped: 0, singleDay: 0 };
  const counts = Object.fromEntries(LIFE_KINDS.map((k) => [k, 0])) as Record<LifeKind, number>;
  if (!plays.length) return { firstMonth: 0, months: 0, counts, artists: [], series: {}, survival: empty, kindOf: new Map() };
  const firstT = store.endedAt[plays[0]];
  const lastT = store.endedAt[plays[plays.length - 1]];
  // Index months from January of the first year, so index % 12 is the calendar month.
  const m0 = Math.floor(monthOrd(firstT) / 12) * 12;
  const endIdx = monthOrd(lastT) - m0;
  const firstData = monthOrd(firstT) - m0;
  const ms = new Float64Array(A), pc = new Float64Array(A);
  const first = new Float64Array(A).fill(Infinity), last = new Float64Array(A).fill(-Infinity);
  const days = new Map<number, Set<number>>();
  const monthly = new Map<number, Float64Array>();
  for (const i of plays) {
    const a = store.artist[i], t = store.endedAt[i];
    ms[a] += store.msPlayed[i]; pc[a]++;
    if (t < first[a]) first[a] = t;
    if (t > last[a]) last[a] = t;
    let d = days.get(a);
    if (!d) days.set(a, (d = new Set()));
    if (d.size < 2) d.add(Math.floor(t / DAY));
  }
  for (const i of plays) {
    const a = store.artist[i];
    if (ms[a] < 2 * 3_600_000 || pc[a] < 10) continue;
    let s = monthly.get(a);
    if (!s) monthly.set(a, (s = new Float64Array(endIdx + 1)));
    s[monthOrd(store.endedAt[i]) - m0] += store.msPlayed[i];
  }
  const artists: LifeArtist[] = [];
  const kindOf = new Map<number, LifeKind>();
  for (const [a, s] of monthly) {
    const f = monthOrd(first[a]) - m0;
    const { kind, peakIdx } = classifyLifecycle(s, f, endIdx);
    counts[kind]++;
    kindOf.set(a, kind);
    artists.push({ id: a, name: store.artistNames[a], kind, ms: ms[a], firstMonth: f + m0, lastMonth: monthOrd(last[a]), peakMonth: peakIdx + m0 });
  }
  artists.sort((x, y) => y.ms - x.ms || x.id - y.id);
  const series: Record<number, number[]> = {};
  for (const k of LIFE_KINDS) {
    for (const x of artists.filter((y) => y.kind === k).slice(0, examples)) {
      series[x.id] = Array.from(monthly.get(x.id)!.slice(firstData)).map((v) => Math.round(v));
    }
  }

  // Survival of newly discovered artists.
  const t: number[] = [], stopped: boolean[] = [];
  let singleDay = 0;
  const discoveredAfter = input.from + 91 * DAY;
  const ever = new Float64Array(A).fill(Infinity);
  for (let i = 0; i < store.length; i++) if (store.msPlayed[i] >= input.minMs && store.endedAt[i] < ever[store.artist[i]]) ever[store.artist[i]] = store.endedAt[i];
  for (let a = 0; a < A; a++) {
    if (!(ms[a] > 0) || first[a] < discoveredAfter || ever[a] < first[a]) continue;
    if ((days.get(a)?.size ?? 0) < 2) { singleDay++; continue; }
    t.push(Math.max(0, (last[a] - first[a]) / MONTH_MS));
    stopped.push(lastT - last[a] > RECENT * MONTH_MS);
  }
  const full = kaplanMeier(t, stopped);
  const half = full.find((p) => p.s <= 0.5);
  // For display, keep the last step in each quarter-month (about a week); the shape is unchanged.
  const curve: SurvivalPoint[] = [];
  for (const p of full) {
    const q = { t: Math.round(p.t * 100) / 100, s: Math.round(p.s * 10_000) / 10_000, atRisk: p.atRisk };
    const prev = curve[curve.length - 1];
    if (prev && curve.length > 1 && Math.floor(prev.t * 4) === Math.floor(q.t * 4)) curve[curve.length - 1] = { ...q, atRisk: prev.atRisk };
    else curve.push(q);
  }
  return {
    firstMonth: m0 + firstData, months: endIdx - firstData + 1, counts, artists, series, kindOf,
    survival: { curve, halfLife: half ? half.t : null, afterYear: survivalAt(full, 12), artists: t.length, stopped: stopped.filter(Boolean).length, singleDay },
  };
}
