/**
 * Shared inputs for the pattern models: UTC calendar months, qualifying plays only (at least the
 * minimum play length, inside the selected range). Months are ordinals (year * 12 + month).
 */
import type { PlayStore } from '../importer';

export const MONTH_MS = 30.4375 * 86_400_000;

export function monthOrd(t: number): number {
  const d = new Date(t);
  return d.getUTCFullYear() * 12 + d.getUTCMonth();
}

export interface PatternInput {
  store: PlayStore;
  from: number;
  to: number;
  minMs: number;
  /** First genre per artist, when genres are loaded. */
  genreOf: ((artistId: number) => string | null) | null;
}

export interface MonthlyMatrix {
  firstMonth: number;
  months: number;
  /** Modelled artists (store ids), most listened first. */
  artists: number[];
  /** col[artistId] = column in `ms`, or -1 when the artist is not modelled. */
  col: Int32Array;
  /** ms[m][j]: listening to modelled artist j in month m. */
  ms: Float64Array[];
  /** Listening to all other artists, per month. */
  rest: Float64Array;
  total: Float64Array;
  plays: Float64Array;
  /** Per store artist, listening in range. */
  artistMs: Float64Array;
  artistPlays: Float64Array;
}

/** Indices of qualifying plays, in time order. */
export function qualifyingPlays(i: PatternInput): number[] {
  const { store } = i;
  const out: number[] = [];
  for (let k = 0; k < store.length; k++) {
    const t = store.endedAt[k];
    if (store.msPlayed[k] >= i.minMs && t >= i.from && t < i.to) out.push(k);
  }
  return out.sort((a, b) => store.endedAt[a] - store.endedAt[b] || a - b);
}

export function monthlyMatrix(i: PatternInput, plays: number[], maxArtists: number): MonthlyMatrix {
  const { store } = i;
  const artistMs = new Float64Array(store.artistNames.length);
  const artistPlays = new Float64Array(store.artistNames.length);
  let lo = Infinity, hi = -Infinity;
  for (const k of plays) {
    artistMs[store.artist[k]] += store.msPlayed[k];
    artistPlays[store.artist[k]]++;
    const m = monthOrd(store.endedAt[k]);
    if (m < lo) lo = m;
    if (m > hi) hi = m;
  }
  const months = plays.length ? hi - lo + 1 : 0;
  const artists = Array.from({ length: artistMs.length }, (_, a) => a)
    .filter((a) => artistMs[a] > 0)
    .sort((a, b) => artistMs[b] - artistMs[a] || a - b)
    .slice(0, maxArtists);
  const col = new Int32Array(artistMs.length).fill(-1);
  artists.forEach((a, j) => (col[a] = j));
  const ms = Array.from({ length: months }, () => new Float64Array(artists.length));
  const rest = new Float64Array(months);
  const total = new Float64Array(months);
  const pc = new Float64Array(months);
  for (const k of plays) {
    const m = monthOrd(store.endedAt[k]) - lo;
    const v = store.msPlayed[k];
    const j = col[store.artist[k]];
    if (j >= 0) ms[m][j] += v;
    else rest[m] += v;
    total[m] += v;
    pc[m]++;
  }
  return { firstMonth: months ? lo : 0, months, artists, col, ms, rest, total, plays: pc, artistMs, artistPlays };
}

/**
 * Months with enough listening to describe a taste: at least 1 hour and at least 10% of the
 * median non-empty month. Sparser months are left out of model fitting (but still counted).
 */
export function fittedMonths(mm: MonthlyMatrix): number[] {
  const nz = [...mm.total].filter((v) => v > 0).sort((a, b) => a - b);
  const median = nz.length ? nz[nz.length >> 1] : 0;
  const min = Math.max(3_600_000, 0.1 * median);
  const out: number[] = [];
  for (let m = 0; m < mm.months; m++) if (mm.total[m] >= min) out.push(m);
  return out;
}

/** Deterministic PRNG (mulberry32), so every model run is reproducible. */
export function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
export const monthLabel = (ord: number) => `${MONTH_NAMES[ord % 12]} ${Math.floor(ord / 12)}`;
