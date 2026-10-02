/**
 * Taste components: non-negative matrix factorisation of the month x artist listening-share
 * matrix with the KL divergence (equivalent to a PLSA topic model, where months are documents
 * and artists are words). Each component is a group of artists you tend to play in the same
 * months. Components are named by their top artists, never by invented labels.
 *
 * Hours are then attributed exactly: each play of a modelled artist is split across components in
 * proportion to W[month, c] * H[c, artist], and plays of other artists go to "Other", so component
 * totals add up to your real listening in every period.
 *
 * Stability: the model is refitted from five random starts; each component's stability is its
 * average best-match cosine similarity (artist profiles) across the other fits. Real listening
 * often has tastes that can be split more than one way, so low-stability tastes are flagged.
 */
import type { AggregateResult, AggregateSettings, SeriesData } from '../aggregate';
import { enumeratePeriods, periodOrdinal } from '../period';
import { fittedMonths, monthlyMatrix, monthOrd, qualifyingPlays, rng, type MonthlyMatrix, type PatternInput } from './monthly';

export const TASTE_ARTISTS = 80;
export const TASTE_SEEDS = [11, 23, 37, 41, 53];
const ITERS = 400;

export interface NmfResult { W: Float64Array; H: Float64Array; rows: number; cols: number; k: number; divergence: number }

/** KL-NMF by multiplicative updates (Lee and Seung). V is row-major rows x cols. */
function nmfKL(V: Float64Array, rows: number, cols: number, k: number, seed: number, iters = ITERS): NmfResult {
  const r = rng(seed);
  const W = new Float64Array(rows * k).map(() => 0.1 + r());
  const H = new Float64Array(k * cols).map(() => 0.1 + r());
  const R = new Float64Array(rows * cols);
  const Q = new Float64Array(rows * cols);
  const eps = 1e-12;
  /** R = WH; Q = V / R. */
  const recon = () => {
    for (let i = 0; i < rows; i++) for (let j = 0; j < cols; j++) {
      let s = 0;
      for (let c = 0; c < k; c++) s += W[i * k + c] * H[c * cols + j];
      R[i * cols + j] = s + eps;
      Q[i * cols + j] = V[i * cols + j] / (s + eps);
    }
  };
  const div = () => {
    let d = 0;
    for (let x = 0; x < V.length; x++) d += (V[x] > 0 ? V[x] * Math.log(V[x] / R[x]) : 0) - V[x] + R[x];
    return d;
  };
  let prev = Infinity;
  let d = Infinity;
  for (let it = 0; it < iters; it++) {
    recon();
    // H update
    for (let c = 0; c < k; c++) {
      let wsum = 0;
      for (let i = 0; i < rows; i++) wsum += W[i * k + c];
      for (let j = 0; j < cols; j++) {
        let num = 0;
        for (let i = 0; i < rows; i++) num += W[i * k + c] * Q[i * cols + j];
        H[c * cols + j] *= num / (wsum + eps);
      }
    }
    recon();
    // W update
    for (let c = 0; c < k; c++) {
      let hsum = 0;
      for (let j = 0; j < cols; j++) hsum += H[c * cols + j];
      for (let i = 0; i < rows; i++) {
        let num = 0;
        for (let j = 0; j < cols; j++) num += H[c * cols + j] * Q[i * cols + j];
        W[i * k + c] *= num / (hsum + eps);
      }
    }
    if (it % 10 === 9) {
      recon();
      d = div();
      if (Math.abs(prev - d) <= 1e-6 * Math.max(1, Math.abs(d))) break;
      prev = d;
    }
  }
  recon();
  d = div();
  // Normalise: each artist profile (H row) sums to 1, scale moves into W.
  for (let c = 0; c < k; c++) {
    let s = 0;
    for (let j = 0; j < cols; j++) s += H[c * cols + j];
    if (s <= 0) continue;
    for (let j = 0; j < cols; j++) H[c * cols + j] /= s;
    for (let i = 0; i < rows; i++) W[i * k + c] *= s;
  }
  return { W, H, rows, cols, k, divergence: d };
}

function cosine(a: Float64Array, ao: number, b: Float64Array, bo: number, n: number) {
  let ab = 0, aa = 0, bb = 0;
  for (let j = 0; j < n; j++) { const x = a[ao + j], y = b[bo + j]; ab += x * y; aa += x * x; bb += y * y; }
  return aa && bb ? ab / Math.sqrt(aa * bb) : 0;
}

/** Greedy one-to-one matching of components between two fits; returns best cosine per component of `a`. */
function matchComponents(a: NmfResult, b: NmfResult): number[] {
  const pairs: Array<[number, number, number]> = [];
  for (let x = 0; x < a.k; x++) for (let y = 0; y < b.k; y++) pairs.push([x, y, cosine(a.H, x * a.cols, b.H, y * b.cols, a.cols)]);
  pairs.sort((p, q) => q[2] - p[2]);
  const out = new Array(a.k).fill(0);
  const ua = new Set<number>(), ub = new Set<number>();
  for (const [x, y, s] of pairs) {
    if (ua.has(x) || ub.has(y)) continue;
    out[x] = s; ua.add(x); ub.add(y);
  }
  return out;
}

export interface Taste {
  index: number;
  label: string;
  /** Artists that make up this taste, by weight in its profile. */
  artists: Array<{ id: number; name: string; weight: number }>;
  ms: number;
  share: number;
  peak: string | null;
  /** 0-1: average match with the same taste in refits from other random starts. */
  stability: number;
}

export interface TastesResult {
  k: number;
  tastes: Taste[];
  /** Hours by taste per period (series 'taste:c'), plus Other for artists outside the model. */
  result: AggregateResult;
  modelledShare: number;
  /** R^2 of the month x artist share matrix. */
  fit: number;
  fittedMonths: number;
  artists: number;
}

export function tasteComponents(input: PatternInput, settings: AggregateSettings, k: number,
  plays = qualifyingPlays(input), mm: MonthlyMatrix = monthlyMatrix(input, plays, TASTE_ARTISTS)): TastesResult | null {
  const fm = fittedMonths(mm);
  const cols = mm.artists.length;
  const kk = Math.max(2, Math.min(k, Math.floor(fm.length / 2), cols));
  if (fm.length < 4 || cols < 4 || kk < 2) return null;
  const rows = fm.length;
  const V = new Float64Array(rows * cols);
  fm.forEach((m, i) => { for (let j = 0; j < cols; j++) V[i * cols + j] = mm.ms[m][j] / mm.total[m]; });
  const fits = TASTE_SEEDS.map((s) => nmfKL(V, rows, cols, kk, s));
  const best = fits.reduce((a, b) => (b.divergence < a.divergence ? b : a));
  const others = fits.filter((f) => f !== best);
  const stab = new Array(kk).fill(0);
  for (const o of others) matchComponents(best, o).forEach((s, c) => (stab[c] += s / others.length));

  // R^2 on V
  let mean = 0;
  for (const v of V) mean += v;
  mean /= V.length;
  let ssr = 0, sst = 0;
  for (let i = 0; i < rows; i++) for (let j = 0; j < cols; j++) {
    let s = 0;
    for (let c = 0; c < kk; c++) s += best.W[i * kk + c] * best.H[c * cols + j];
    const v = V[i * cols + j];
    ssr += (v - s) ** 2; sst += (v - mean) ** 2;
  }

  // Per-month weights; sparse months use the listening-weighted average month.
  const wOf = new Map<number, Float64Array>();
  const wbar = new Float64Array(kk);
  let wt = 0;
  fm.forEach((m, i) => {
    const w = best.W.slice(i * kk, i * kk + kk);
    wOf.set(m, w);
    for (let c = 0; c < kk; c++) wbar[c] += w[c] * mm.total[m];
    wt += mm.total[m];
  });
  for (let c = 0; c < kk; c++) wbar[c] /= wt || 1;

  const periods = enumeratePeriods(input.from, input.to - 1, settings.granularity);
  const P = periods.length;
  const p0 = periods.length ? periodOrdinal(periods[0].start, settings.granularity) : 0;
  const mk = (key: string, label: string, kind: SeriesData['kind'], id: number | null, slot: number | null): SeriesData =>
    ({ key, label, kind, id, colorSlot: slot, ms: new Array(P).fill(0), plays: new Array(P).fill(0), totalMs: 0, totalPlays: 0, memberCount: 1 });
  const comp = Array.from({ length: kk }, (_, c) => mk(`taste:${c}`, '', 'item', c, c));
  const other = mk('other', 'Artists outside the model', 'other', null, null);
  other.memberCount = Math.max(0, [...mm.artistMs].filter((v) => v > 0).length - cols);
  const pMs = new Float64Array(P), pPlays = new Float64Array(P);
  const { store } = input;
  const r = new Float64Array(kk);
  let first = Infinity, last = -Infinity, incMs = 0;
  for (const i of plays) {
    const t = store.endedAt[i];
    const p = periodOrdinal(t, settings.granularity) - p0;
    if (p < 0 || p >= P) continue;
    const v = store.msPlayed[i];
    pMs[p] += v; pPlays[p]++; incMs += v;
    if (t < first) first = t;
    if (t > last) last = t;
    const j = mm.col[store.artist[i]];
    if (j < 0) { other.ms[p] += v; other.plays[p]++; continue; }
    const w = wOf.get(monthOrd(t) - mm.firstMonth) ?? wbar;
    let s = 0;
    for (let c = 0; c < kk; c++) { r[c] = w[c] * best.H[c * cols + j]; s += r[c]; }
    if (s <= 0) { other.ms[p] += v; other.plays[p]++; continue; }
    for (let c = 0; c < kk; c++) { comp[c].ms[p] += v * r[c] / s; comp[c].plays[p] += r[c] / s; }
  }
  for (const s of [...comp, other]) { s.totalMs = s.ms.reduce((a, b) => a + b, 0); s.totalPlays = s.plays.reduce((a, b) => a + b, 0); }

  // Order tastes by listening; colours follow that order.
  const order = comp.map((_, c) => c).sort((a, b) => comp[b].totalMs - comp[a].totalMs || a - b);
  const tastes: Taste[] = order.map((c, rank) => {
    const prof = Array.from({ length: cols }, (_, j) => [j, best.H[c * cols + j]] as const).sort((a, b) => b[1] - a[1]);
    const artists = prof.slice(0, 8).filter(([, w]) => w > 0.005).map(([j, w]) => ({ id: mm.artists[j], name: store.artistNames[mm.artists[j]], weight: w }));
    const label = artists.slice(0, 3).map((a) => a.name).join(' · ');
    const s = comp[c];
    s.label = label; s.key = `taste:${rank}`; s.id = rank; s.colorSlot = rank;
    let pk = -1;
    s.ms.forEach((v, p) => { if (pk < 0 || v > s.ms[pk]) pk = p; });
    return { index: rank, label, artists, ms: s.totalMs, share: incMs ? s.totalMs / incMs : 0, peak: pk >= 0 && s.ms[pk] > 0 ? periods[pk].label : null, stability: stab[c] };
  });
  const series = [...order.map((c) => comp[c]), other];
  const result: AggregateResult = {
    settings: { ...settings, topN: kk },
    periods: periods.map((p, i) => ({ ...p, ms: pMs[i], plays: pPlays[i] })),
    series,
    coverage: incMs ? { first, last } : null,
    included: { count: plays.length, ms: incMs },
    belowThreshold: { count: 0, ms: 0 },
    outsideRange: { count: 0, ms: 0 },
    groupCount: kk,
    topIds: tastes.map((t) => t.index),
  };
  let modelled = 0;
  for (const a of mm.artists) modelled += mm.artistMs[a];
  return { k: kk, tastes, result, modelledShare: incMs ? modelled / incMs : 0, fit: sst > 0 ? 1 - ssr / sst : 0, fittedMonths: fm.length, artists: cols };
}
