/**
 * Listening eras: change-point segmentation of your monthly artist mix.
 *
 * Each fitted month is a vector of square-rooted artist shares (top artists plus one "everyone
 * else" entry), so squared distances are Hellinger distances between monthly mixes. Optimal
 * segmentation by dynamic programming minimises the within-era spread, with eras of at least
 * MIN_ERA_MONTHS fitted months.
 *
 * How many eras: a permutation test. The months are shuffled (which destroys any real eras but
 * keeps the month-to-month noise) and segmented the same way. One more era is accepted only
 * while its improvement beats the same step on shuffled history (p <= 0.05 over NULL_RUNS
 * shuffles). A steady listener therefore gets one era, and noise never creates one.
 *
 * Each boundary carries an uncertainty window: the positions where it could sit while keeping at
 * least 90% of the improvement it brings.
 */
import { fittedMonths, monthlyMatrix, qualifyingPlays, rng, type MonthlyMatrix, type PatternInput } from './monthly';

export const MIN_ERA_MONTHS = 3;
export const MAX_ERAS = 10;
export const NULL_RUNS = 39;
const ERA_ARTISTS = 50;

export interface EraItem { id: number; name: string; ms: number; share: number; lift?: number }

export interface Era {
  fromMonth: number;
  toMonth: number;
  ms: number;
  plays: number;
  top: EraItem[];
  /** Artists far more prominent in this era than in the rest of your history. */
  defining: EraItem[];
  /** Most common genre, as a share of the era's listening that has a genre. */
  genre: { name: string; share: number } | null;
  /** Hellinger distance (0-1) between this era's artist mix and the previous era's. */
  shift: number | null;
  /** Where the start of this era could plausibly sit (month ordinals), null for the first era. */
  startWindow: { from: number; to: number } | null;
}

export interface ErasResult {
  eras: Era[];
  fittedMonths: number;
  sparseMonths: number;
  /** Share of within-era spread removed by the chosen eras (0-1). */
  explained: number;
}

/** Optimal segmentation for every era count up to maxK. `starts[k-1]` lists era start indices. */
export function segmentSeries(X: Float64Array[], minLen: number, maxK: number): { costs: number[]; starts: number[][] } {
  const n = X.length;
  const D = n ? X[0].length : 0;
  const S = Array.from({ length: n + 1 }, () => new Float64Array(D));
  const Q = new Float64Array(n + 1);
  for (let i = 0; i < n; i++) {
    let q = 0;
    for (let d = 0; d < D; d++) { S[i + 1][d] = S[i][d] + X[i][d]; q += X[i][d] * X[i][d]; }
    Q[i + 1] = Q[i] + q;
  }
  const cost = (i: number, j: number) => {
    let s = 0;
    for (let d = 0; d < D; d++) { const v = S[j][d] - S[i][d]; s += v * v; }
    return Math.max(0, Q[j] - Q[i] - s / (j - i));
  };
  const C: Float64Array[] = Array.from({ length: n + 1 }, () => new Float64Array(n + 1));
  for (let i = 0; i < n; i++) for (let j = i + minLen; j <= n; j++) C[i][j] = cost(i, j);
  const K = Math.max(1, Math.min(maxK, Math.floor(n / minLen)));
  const dp: Float64Array[] = [];
  const arg: Int32Array[] = [];
  for (let k = 1; k <= K; k++) {
    const row = new Float64Array(n + 1).fill(Infinity);
    const a = new Int32Array(n + 1).fill(-1);
    for (let j = k * minLen; j <= n; j++) {
      if (k === 1) { row[j] = C[0][j]; a[j] = 0; continue; }
      for (let i = (k - 1) * minLen; i <= j - minLen; i++) {
        const v = dp[k - 2][i] + C[i][j];
        if (v < row[j]) { row[j] = v; a[j] = i; }
      }
    }
    dp.push(row); arg.push(a);
  }
  const costs: number[] = [];
  const starts: number[][] = [];
  for (let k = 1; k <= K; k++) {
    costs.push(dp[k - 1][n]);
    const st: number[] = [];
    let j = n;
    for (let kk = k; kk >= 1; kk--) { const i = arg[kk - 1][j]; st.unshift(i); j = i; }
    starts.push(st);
  }
  return { costs, starts };
}

/**
 * Era count by permutation test: accept era k+1 while the real improvement C_k - C_(k+1) is beaten
 * by at most 5% of shuffled runs. Returns the count and the per-step p-values that were tested.
 */
export function chooseEraCount(X: Float64Array[], minLen: number, costs: number[], runs = NULL_RUNS, seed = 5): { k: number; p: number[] } {
  if (costs.length < 2 || costs[0] <= 1e-12) return { k: 1, p: [] };
  const r = rng(seed);
  const nulls: number[][] = [];
  for (let s = 0; s < runs; s++) {
    const perm = X.slice();
    for (let i = perm.length - 1; i > 0; i--) { const j = Math.floor(r() * (i + 1)); [perm[i], perm[j]] = [perm[j], perm[i]]; }
    nulls.push(segmentSeries(perm, minLen, costs.length).costs);
  }
  const p: number[] = [];
  let k = 1;
  while (k < costs.length) {
    const gain = costs[k - 1] - costs[k];
    const beaten = nulls.filter((c) => c.length > k && c[k - 1] - c[k] >= gain - 1e-12).length;
    const pk = (1 + beaten) / (1 + runs);
    p.push(pk);
    if (pk > 0.05) break;
    k++;
  }
  return { k, p };
}

function vectors(mm: MonthlyMatrix, months: number[]): Float64Array[] {
  const D = mm.artists.length + 1;
  return months.map((m) => {
    const v = new Float64Array(D);
    const t = mm.total[m];
    for (let j = 0; j < mm.artists.length; j++) v[j] = Math.sqrt(mm.ms[m][j] / t);
    v[D - 1] = Math.sqrt(mm.rest[m] / t);
    return v;
  });
}

export function listeningEras(input: PatternInput, plays = qualifyingPlays(input), mm = monthlyMatrix(input, plays, ERA_ARTISTS)): ErasResult {
  const fm = fittedMonths(mm);
  const empty: ErasResult = { eras: [], fittedMonths: fm.length, sparseMonths: mm.months - fm.length, explained: 0 };
  if (fm.length < MIN_ERA_MONTHS) return empty;
  const X = vectors(mm, fm);
  const seg = segmentSeries(X, MIN_ERA_MONTHS, MAX_ERAS);
  const { k } = chooseEraCount(X, MIN_ERA_MONTHS, seg.costs);
  const st = seg.starts[k - 1];
  const explained = seg.costs[0] > 0 ? 1 - seg.costs[k - 1] / seg.costs[0] : 0;

  // Boundary windows: slide each boundary with its neighbours fixed.
  const cost = (i: number, j: number) => {
    const D = X[0].length;
    let q = 0;
    const s = new Float64Array(D);
    for (let r = i; r < j; r++) for (let d = 0; d < D; d++) { s[d] += X[r][d]; q += X[r][d] * X[r][d]; }
    let ss = 0;
    for (let d = 0; d < D; d++) ss += s[d] * s[d];
    return Math.max(0, q - ss / (j - i));
  };
  const windows: Array<{ from: number; to: number } | null> = st.map((b, e) => {
    if (e === 0) return null;
    const p = st[e - 1];
    const q = e + 1 < st.length ? st[e + 1] : fm.length;
    const whole = cost(p, q);
    const best = cost(p, b) + cost(b, q);
    const tol = 0.1 * Math.max(0, whole - best);
    let lo = b, hi = b;
    for (let c = p + MIN_ERA_MONTHS; c <= q - MIN_ERA_MONTHS; c++) {
      if (cost(p, c) + cost(c, q) - best <= tol + 1e-12) { lo = Math.min(lo, c); hi = Math.max(hi, c); }
    }
    return { from: fm[lo] + mm.firstMonth, to: fm[hi] + mm.firstMonth };
  });

  // Era spans in calendar months: sparse months join the era running at the time.
  const { store } = input;
  const startMonths = st.map((b, e) => (e === 0 ? 0 : fm[b]));
  const totalByArtist = mm.artistMs;
  let grand = 0;
  for (const v of mm.total) grand += v;
  const eras: Era[] = startMonths.map((sm, e) => {
    const em = e + 1 < startMonths.length ? startMonths[e + 1] - 1 : mm.months - 1;
    const am = new Map<number, number>();
    let ms = 0, pl = 0;
    for (let m = sm; m <= em; m++) {
      ms += mm.total[m]; pl += mm.plays[m];
      for (let j = 0; j < mm.artists.length; j++) if (mm.ms[m][j]) am.set(mm.artists[j], (am.get(mm.artists[j]) ?? 0) + mm.ms[m][j]);
    }
    const ranked = [...am].sort((a, b) => b[1] - a[1] || a[0] - b[0]);
    const top = ranked.slice(0, 5).map(([id, v]) => ({ id, name: store.artistNames[id], ms: v, share: ms ? v / ms : 0 }));
    const outside = grand - ms;
    const defining = ranked
      .filter(([, v]) => ms > 0 && v / ms >= 0.02)
      .map(([id, v]) => {
        const out = totalByArtist[id] - v;
        const lift = outside > 0 ? (v / ms) / Math.max(out / outside, 0.002) : 1;
        return { id, name: store.artistNames[id], ms: v, share: v / ms, lift };
      })
      .filter((x) => x.lift >= 3)
      .sort((a, b) => b.lift * b.share - a.lift * a.share)
      .slice(0, 3);
    let genre: Era['genre'] = null;
    if (input.genreOf) {
      // Top genre among the era's classified listening (each artist's first genre); only shown
      // when at least 30% of the era is classified.
      const gm = new Map<string, number>();
      let classified = 0;
      for (const [id, v] of am) { const g = input.genreOf(id); if (g) { gm.set(g, (gm.get(g) ?? 0) + v); classified += v; } }
      const best = [...gm].sort((a, b) => b[1] - a[1])[0];
      if (best && ms && classified >= 0.3 * ms) genre = { name: best[0], share: best[1] / classified };
    }
    return { fromMonth: sm + mm.firstMonth, toMonth: em + mm.firstMonth, ms, plays: pl, top, defining, genre, shift: null, startWindow: windows[e] };
  });
  // Shift between consecutive eras' artist mixes (all artists in the matrix plus the rest bucket).
  const mix = (e: Era) => {
    const v = new Float64Array(mm.artists.length + 1);
    for (let m = e.fromMonth - mm.firstMonth; m <= e.toMonth - mm.firstMonth; m++) {
      for (let j = 0; j < mm.artists.length; j++) v[j] += mm.ms[m][j];
      v[mm.artists.length] += mm.rest[m];
    }
    const s = v.reduce((a, b) => a + b, 0) || 1;
    return v.map((x) => x / s);
  };
  for (let e = 1; e < eras.length; e++) {
    const a = mix(eras[e - 1]), b = mix(eras[e]);
    let bc = 0;
    for (let j = 0; j < a.length; j++) bc += Math.sqrt(a[j] * b[j]);
    eras[e].shift = Math.sqrt(Math.max(0, 1 - bc));
  }
  return { eras, fittedMonths: fm.length, sparseMonths: mm.months - fm.length, explained };
}
