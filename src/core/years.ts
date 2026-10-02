/**
 * Artist formation/birth years and album release years (from `npm run enrich`), and listening
 * time bucketed by decade. Years never come from Spotify; unknown years stay in an explicit
 * "Unknown" bucket so totals still add up.
 */
import { parseCsv } from './genres';
import type { PlayStore } from './importer';

export interface YearInfo {
  artistFormed: Map<string, number>; // artist name -> year
  artistMeta: Map<string, { type: string; country: string; ended: number | null }>;
  albumYear: Map<string, number>; // `${artist}\u0000${album}` -> year
}

function table(csv: string): Array<Record<string, string>> {
  const rows = parseCsv(csv);
  if (!rows.length) return [];
  const h = rows[0].map((c) => c.trim().toLowerCase());
  return rows.slice(1).map((r) => Object.fromEntries(h.map((k, i) => [k, (r[i] ?? '').trim()])));
}

const year = (s: string | undefined) => (s && /^\d{4}$/.test(s) ? Number(s) : null);

export function parseYearInfo(artistCsv: string | null, albumCsv: string | null): YearInfo {
  const info: YearInfo = { artistFormed: new Map(), artistMeta: new Map(), albumYear: new Map() };
  for (const r of artistCsv ? table(artistCsv) : []) {
    const y = year(r.formed_year);
    if (y) info.artistFormed.set(r.artist, y);
    info.artistMeta.set(r.artist, { type: r.type ?? '', country: r.country ?? '', ended: year(r.ended_year) });
  }
  for (const r of albumCsv ? table(albumCsv) : []) {
    const y = year(r.year);
    if (y) info.albumYear.set(`${r.artist}\u0000${r.album}`, y);
  }
  return info;
}

/** Year per artist id / album id in this store (null where unknown). */
export function resolveYears(store: PlayStore, info: YearInfo) {
  const artist = store.artistNames.map((n) => info.artistFormed.get(n) ?? null);
  const album = store.albumNames.map((n, i) => info.albumYear.get(`${store.artistNames[store.albumArtist[i]]}\u0000${n}`) ?? null);
  return { artist, album };
}

export interface DecadeBucket {
  decade: number | null; // 1970 = the 1970s; null = unknown
  label: string;
  ms: number;
  plays: number;
  items: number; // distinct artists/albums in the bucket
}

/**
 * Listening time by decade of the artist's formation or the album's release, within a time
 * range, after the duration filter, optionally weighted by an artist scope (genre branch).
 */
export function decadeBreakdown(
  store: PlayStore, by: 'artist' | 'album', years: Array<number | null>,
  from: number, to: number, minMs: number, scope: ((artistId: number) => number) | null,
): DecadeBucket[] {
  const ms = new Map<number | null, number>();
  const plays = new Map<number | null, number>();
  const items = new Map<number | null, Set<number>>();
  const col = by === 'artist' ? store.artist : store.album;
  for (let i = 0; i < store.length; i++) {
    const t = store.endedAt[i];
    const m = store.msPlayed[i];
    if (m < minMs || t < from || t >= to) continue;
    const w = scope ? scope(store.artist[i]) : 1;
    if (w <= 0) continue;
    const y = years[col[i]];
    const d = y === null ? null : Math.floor(y / 10) * 10;
    ms.set(d, (ms.get(d) ?? 0) + m * w);
    plays.set(d, (plays.get(d) ?? 0) + w);
    if (!items.has(d)) items.set(d, new Set());
    items.get(d)!.add(col[i]);
  }
  const known = [...ms.keys()].filter((d): d is number => d !== null).sort((a, b) => a - b);
  const out: DecadeBucket[] = [];
  if (known.length) {
    for (let d = known[0]; d <= known[known.length - 1]; d += 10) {
      out.push({ decade: d, label: `${d}s`, ms: ms.get(d) ?? 0, plays: plays.get(d) ?? 0, items: items.get(d)?.size ?? 0 });
    }
  }
  if (ms.has(null)) out.push({ decade: null, label: 'Unknown', ms: ms.get(null)!, plays: plays.get(null)!, items: items.get(null)!.size });
  return out;
}
