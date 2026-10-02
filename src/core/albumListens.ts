/**
 * "Album listens": how many times you actually sat down with an album, as opposed to the sum of
 * its individual track plays.
 *
 * Rule: plays of one album form a sitting while the gap between one play ending and the next one
 * starting is at most 30 minutes (other albums in between do not break it). A sitting counts as
 * one album listen if it contains at least 3 different tracks of that album. Only plays that pass
 * the minimum-play filter count. Albums you never played 3 tracks of in one sitting have none.
 *
 * Returns a per-play mark: 1 on the first play of every qualifying sitting, else 0. Counting the
 * marks inside a date range gives album listens in that range.
 */
import type { PlayStore } from './importer';

export const ALBUM_SESSION_GAP_MS = 30 * 60_000;
export const ALBUM_MIN_TRACKS = 3;

export function albumListenMarks(store: PlayStore, minMs: number, gapMs = ALBUM_SESSION_GAP_MS, minTracks = ALBUM_MIN_TRACKS): Uint8Array {
  const n = store.length;
  const order = Array.from({ length: n }, (_, i) => i).sort((a, b) => store.endedAt[a] - store.endedAt[b] || a - b);
  const marks = new Uint8Array(n);
  const unknown = new Set<number>();
  store.albumNames.forEach((name, i) => { if (name === '(unknown album)') unknown.add(i); });
  const state = new Map<number, { first: number; lastEnd: number; tracks: Set<number> }>();
  const close = (s: { first: number; tracks: Set<number> }) => { if (s.tracks.size >= minTracks) marks[s.first] = 1; };
  for (const i of order) {
    const ms = store.msPlayed[i];
    if (ms < minMs) continue;
    const al = store.album[i];
    if (unknown.has(al)) continue;
    const end = store.endedAt[i];
    const start = end - ms;
    const s = state.get(al);
    if (s && start - s.lastEnd <= gapMs) {
      s.tracks.add(store.track[i]);
      s.lastEnd = Math.max(s.lastEnd, end);
    } else {
      if (s) close(s);
      state.set(al, { first: i, lastEnd: end, tracks: new Set([store.track[i]]) });
    }
  }
  for (const s of state.values()) close(s);
  return marks;
}

export const WHOLE_MIN_TRACKS = 4;
export const WHOLE_COVERAGE = 0.8;
export const WHOLE_UNSKIPPED = 0.8;

export interface AlbumSitting {
  album: number;
  start: number;
  end: number;
  /** Different tracks of the album played in this sitting. */
  tracks: number;
  plays: number;
  skips: number;
  ms: number;
}

export interface WholeAlbumRow {
  album: number;
  /** Different tracks of this album you have ever played (the album length as far as your history knows). */
  knownTracks: number;
  wholeListens: number;
  sittings: number;
  /** Average share of the known tracks covered per sitting with 3+ tracks. */
  avgCoverage: number;
  firstWhole: number | null;
  lastWhole: number | null;
  wholeMs: number;
}

export interface WholeAlbums {
  rows: WholeAlbumRow[];
  perYear: Array<{ year: number; count: number }>;
  /** Sittings (3+ tracks) by how much of the album they covered: <25%, 25-50, 50-80, 80-100, 100%. */
  coverage: Array<{ label: string; count: number }>;
  totalWhole: number;
  albumsConsidered: number;
}

/**
 * Album sittings: plays of one album with no gap over 30 minutes between one ending and the next
 * starting (other albums in between do not break it). Uses plays that pass the minimum filter.
 */
export function albumSittings(store: PlayStore, minMs: number, gapMs = ALBUM_SESSION_GAP_MS): AlbumSitting[] {
  const order = Array.from({ length: store.length }, (_, i) => i).sort((a, b) => store.endedAt[a] - store.endedAt[b] || a - b);
  const unknown = new Set<number>();
  store.albumNames.forEach((name, i) => { if (name === '(unknown album)') unknown.add(i); });
  const open = new Map<number, AlbumSitting & { set: Set<number> }>();
  const out: AlbumSitting[] = [];
  const close = (s: AlbumSitting & { set: Set<number> }) => { const { set, ...rest } = s; out.push({ ...rest, tracks: set.size }); };
  for (const i of order) {
    const ms = store.msPlayed[i];
    if (ms < minMs) continue;
    const al = store.album[i];
    if (unknown.has(al)) continue;
    const end = store.endedAt[i];
    const start = end - ms;
    const s = open.get(al);
    if (s && start - s.end <= gapMs) {
      s.set.add(store.track[i]); s.end = Math.max(s.end, end); s.plays++; s.ms += ms; if (store.skip[i] === 1) s.skips++;
    } else {
      if (s) close(s);
      open.set(al, { album: al, start, end, tracks: 0, plays: 1, skips: store.skip[i] === 1 ? 1 : 0, ms, set: new Set([store.track[i]]) });
    }
  }
  for (const s of open.values()) close(s);
  return out.sort((a, b) => a.start - b.start);
}

/**
 * Whole-album listening. Album length is unknown in the export, so it is taken as the number of
 * different tracks of the album you have ever played. A whole-album listen is a sitting that covers
 * at least 80% of those tracks with at least 80% of its plays not skipped. Albums with fewer than
 * 4 known tracks are not considered.
 */
export function wholeAlbums(store: PlayStore, minMs: number, from: number, to: number, scope: ((artistId: number) => number) | null = null): WholeAlbums {
  const known = new Map<number, Set<number>>();
  for (let i = 0; i < store.length; i++) {
    if (store.msPlayed[i] < minMs) continue;
    const al = store.album[i];
    let s = known.get(al); if (!s) { s = new Set(); known.set(al, s); } s.add(store.track[i]);
  }
  const rows = new Map<number, WholeAlbumRow & { cov: number[] }>();
  const perYear = new Map<number, number>();
  const buckets = [['under 25%', 0.25], ['25–50%', 0.5], ['50–80%', 0.8], ['80–99%', 1], ['100%', Infinity]] as const;
  const coverage = buckets.map(([label]) => ({ label: label as string, count: 0 }));
  let totalWhole = 0;
  for (const s of albumSittings(store, minMs)) {
    if (s.start < from || s.start >= to) continue;
    const k = known.get(s.album)?.size ?? 0;
    if (k < WHOLE_MIN_TRACKS || s.tracks < 3) continue;
    if (scope && scope(store.albumArtist[s.album]) <= 0) continue;
    const cov = s.tracks / k;
    coverage[cov >= 1 ? 4 : buckets.findIndex(([, max]) => cov < max)].count++;
    const r = rows.get(s.album) ?? { album: s.album, knownTracks: k, wholeListens: 0, sittings: 0, avgCoverage: 0, firstWhole: null, lastWhole: null, wholeMs: 0, cov: [] };
    r.sittings++;
    r.cov.push(cov);
    if (cov >= WHOLE_COVERAGE && (s.plays - s.skips) / s.plays >= WHOLE_UNSKIPPED) {
      r.wholeListens++; r.wholeMs += s.ms; totalWhole++;
      if (r.firstWhole === null) r.firstWhole = s.start;
      r.lastWhole = s.start;
      const y = new Date(s.start).getUTCFullYear();
      perYear.set(y, (perYear.get(y) ?? 0) + 1);
    }
    rows.set(s.album, r);
  }
  const list = [...rows.values()].map(({ cov, ...r }) => ({ ...r, avgCoverage: cov.reduce((a, b) => a + b, 0) / cov.length }))
    .sort((a, b) => b.wholeListens - a.wholeListens || b.avgCoverage - a.avgCoverage || b.sittings - a.sittings);
  return { rows: list, perYear: [...perYear.entries()].sort((a, b) => a[0] - b[0]).map(([year, count]) => ({ year, count })), coverage, totalWhole, albumsConsidered: list.length };
}
