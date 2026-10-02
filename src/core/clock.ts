/**
 * Listening clock: total listening time by weekday x hour. Spotify's `ts` is UTC and the export
 * carries no timezone, so the default is UTC. An optional fixed offset (no daylight saving) can
 * shift the display; it is always labelled.
 */
import type { PlayStore } from './importer';
import { offsetFn } from './tz';

export interface ClockResult {
  /** ms[weekday][hour], weekday 0 = Monday. */
  ms: number[][];
  plays: number[][];
  offsetHours: number;
  /** IANA timezone when a real zone (with daylight saving) was used, else null. */
  timeZone: string | null;
  weeks: number; // number of calendar weeks spanned, for per-week averages
}

export function listeningClock(store: PlayStore, from: number, to: number, minMs: number, offsetHours: number, scope: ((artistId: number) => number) | null = null, timeZone: string | null = null): ClockResult {
  const ms = Array.from({ length: 7 }, () => new Array(24).fill(0));
  const plays = Array.from({ length: 7 }, () => new Array(24).fill(0));
  const zone = timeZone ? offsetFn(timeZone) : null;
  const fixed = offsetHours * 3_600_000;
  for (let i = 0; i < store.length; i++) {
    const t = store.endedAt[i];
    const m = store.msPlayed[i];
    if (m < minMs || t < from || t >= to) continue;
    const w = scope ? scope(store.artist[i]) : 1;
    if (w <= 0) continue;
    const d = new Date(t + (zone ? zone(t) : fixed));
    const wd = (d.getUTCDay() + 6) % 7;
    const h = d.getUTCHours();
    ms[wd][h] += m * w;
    plays[wd][h] += w;
  }
  return { ms, plays, offsetHours, timeZone, weeks: Math.max(1, (to - from) / (7 * 86_400_000)) };
}
