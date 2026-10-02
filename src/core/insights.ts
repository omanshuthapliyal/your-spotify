/**
 * Lifetime insights computed from the play store. Everything respects the date range; most use
 * the minimum-play filter. Skip and shuffle rates use ALL plays, since quick skips are exactly
 * the short plays the filter removes. Days and hours are in the chosen timezone (see tz.ts).
 *
 * Definitions (shown in the UI):
 *  - Discovery: the first play of an artist in your whole history (not just the range).
 *  - Stuck: a discovered artist you played again 6+ months after discovering them.
 *  - Effective artists: exp(Shannon entropy) of the artist shares in a year: "you listened as if
 *    to N artists equally" (higher = more varied).
 *  - Session: plays with no gap over 30 minutes between one ending and the next starting.
 *  - Skip: Spotify's skipped flag, or the play ended with the forward button.
 *  - Streak: consecutive calendar days with at least one play of an artist.
 *  - Comeback: an artist returns after a gap of a year or more.
 */
import type { PlayStore } from './importer';

const DAY = 86_400_000;
const SESSION_GAP = 30 * 60_000;

export interface YearRow {
  year: number;
  ms: number;
  plays: number;
  artists: number;
  newArtists: number;
  topArtist: { id: number; name: string; ms: number } | null;
  topAlbum: { id: number; name: string; sub: string; ms: number; art?: string | null } | null;
  topTrack: { id: number; name: string; sub: string; ms: number; plays: number } | null;
  topGenre: string | null;
  top10Share: number;
  effectiveArtists: number;
  skipRate: number | null;
  shuffleRate: number | null;
  medianMusicAge: number | null;
  newMusicShare: number | null;
}

export interface Insights {
  timeZone: string;
  years: YearRow[];
  /** Daily listening (ms), keyed by local day number (days since 1970-01-01 in the timezone). */
  days: Array<[number, number]>;
  discovery: Array<{ year: number; discovered: number; stuck: number }>;
  sessions: { count: number; perWeek: number; medianMinutes: number; longest: { start: number; minutes: number; plays: number; topArtist: string } | null };
  obsessions: {
    /** plays = qualifying plays that day; completed = those not skipped. */
    biggestTrackDay: { day: number; track: string; artist: string; plays: number; completed: number } | null;
    biggestArtistDay: { day: number; artist: string; ms: number } | null;
    longestRepeat: { start: number; track: string; artist: string; count: number } | null;
    longestStreak: { startDay: number; artist: string; days: number } | null;
  };
  mostSkipped: Array<{ id: number; name: string; artist: string; plays: number; skipRate: number }>;
  comebacks: Array<{ id: number; name: string; gapDays: number; returnedAt: number; msAfter: number }>;
  loyal: Array<{ id: number; name: string; years: number; ms: number }>;
  daysWithMusic: number;
  totalDays: number;
  /** New artists per local month: [year*12+month, count]. */
  discoveryMonthly: Array<[number, number]>;
  /** Per discovery year: the artists found that year who got the most listening (in range). */
  notableDiscoveries: Array<{ year: number; artists: Array<{ id: number; name: string; ms: number; first: number }> }>;
  /** Session counts by length bucket and by local start hour. */
  sessionLengths: Array<{ label: string; count: number }>;
  sessionStartHours: number[];
  /** Biggest single-day binges of one song. */
  topSongDays: Array<{ day: number; track: string; artist: string; plays: number; completed: number }>;
  /** Skip rate (over all plays) for your most-played artists. */
  artistSkips: Array<{ id: number; name: string; plays: number; skipRate: number }>;
  /** Monthly listening (ms) for comeback and loyal artists: id -> [month ordinal, ms][]. */
  artistMonths: Record<number, Array<[number, number]>>;
  /** Hours per calendar year for the loyal artists: id -> [year, ms][]. */
  artistYears: Record<number, Array<[number, number]>>;
}

const SESSION_BUCKETS: Array<[string, number]> = [['< 10 min', 10], ['10–30 min', 30], ['30–60 min', 60], ['1–2 h', 120], ['2–4 h', 240], ['4 h +', Infinity]];

function median(a: number[]): number | null {
  if (!a.length) return null;
  const s = [...a].sort((x, y) => x - y);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

export interface InsightOptions {
  from: number;
  to: number;
  minMs: number;
  offset: (t: number) => number;
  timeZone: string;
  albumYear: Array<number | null> | null;
  /** Genre label per artist (first genre), for "top genre" per year. */
  genreOf: ((artistId: number) => string | null) | null;
}

export function computeInsights(store: PlayStore, o: InsightOptions): Insights {
  const n = store.length;
  const order = Array.from({ length: n }, (_, i) => i).sort((a, b) => store.endedAt[a] - store.endedAt[b] || a - b);
  const localDay = (t: number) => Math.floor((t + o.offset(t)) / DAY);
  const yearOf = (t: number) => new Date(t + o.offset(t)).getUTCFullYear();
  const keep = (i: number) => store.msPlayed[i] >= o.minMs;

  // Discovery uses the whole history (first-ever qualifying play per artist).
  const firstPlay = new Float64Array(store.artistNames.length).fill(Infinity);
  const lastPlay = new Float64Array(store.artistNames.length).fill(-Infinity);
  for (const i of order) {
    if (!keep(i)) continue;
    const a = store.artist[i];
    if (firstPlay[a] === Infinity) firstPlay[a] = store.endedAt[i];
    lastPlay[a] = store.endedAt[i];
  }

  type Acc = { ms: number; plays: number; artistMs: Map<number, number>; albumMs: Map<number, number>; trackMs: Map<number, [number, number]>;
    genreMs: Map<string, number>; skips: number; skipKnown: number; shuf: number; shufKnown: number; ages: number[]; agedMs: number; newMs: number };
  const years = new Map<number, Acc>();
  const acc = (y: number) => {
    let a = years.get(y);
    if (!a) {
      a = { ms: 0, plays: 0, artistMs: new Map(), albumMs: new Map(), trackMs: new Map(), genreMs: new Map(), skips: 0, skipKnown: 0, shuf: 0, shufKnown: 0, ages: [], agedMs: 0, newMs: 0 };
      years.set(y, a);
    }
    return a;
  };
  const days = new Map<number, number>();
  const trackDay = new Map<string, number>();
  const trackDayDone = new Map<string, number>();
  const artistDay = new Map<string, number>();
  const artistDays = new Map<number, Set<number>>();
  const trackPlaysAll = new Map<number, [number, number]>(); // [plays, skips] over all plays in range
  let sessionsCount = 0;
  const sessionMinutes: number[] = [];
  const sessionStartHours = new Array(24).fill(0);
  const artistAllPlays = new Map<number, [number, number]>(); // [plays, skips], all plays in range
  let longest: Insights['sessions']['longest'] = null;
  let sStart = -1, sEnd = -Infinity, sPlays = 0;
  let sArtist = new Map<number, number>();
  const closeSession = () => {
    if (sStart < 0) return;
    sessionsCount++;
    const minutes = (sEnd - sStart) / 60_000;
    sessionMinutes.push(minutes);
    sessionStartHours[new Date(sStart + o.offset(sStart)).getUTCHours()]++;
    if (!longest || minutes > longest.minutes) {
      let best = -1, bestMs = -1;
      for (const [a, m] of sArtist) if (m > bestMs) { bestMs = m; best = a; }
      longest = { start: sStart, minutes, plays: sPlays, topArtist: best >= 0 ? store.artistNames[best] : '' };
    }
  };
  let repeat = { track: -1, count: 0, start: 0 };
  let longestRepeat: Insights['obsessions']['longestRepeat'] = null;

  for (const i of order) {
    const t = store.endedAt[i];
    if (t < o.from || t >= o.to) continue;
    const ms = store.msPlayed[i];
    const y = yearOf(t);
    const a = acc(y);
    // Skip / shuffle over all plays.
    if (store.skip[i] !== 2) { a.skipKnown++; a.skips += store.skip[i]; }
    if (store.shuffle[i] !== 2) { a.shufKnown++; a.shuf += store.shuffle[i]; }
    const ap = artistAllPlays.get(store.artist[i]) ?? [0, 0];
    ap[0]++; if (store.skip[i] === 1) ap[1]++;
    artistAllPlays.set(store.artist[i], ap);
    const tp = trackPlaysAll.get(store.track[i]) ?? [0, 0];
    tp[0]++; if (store.skip[i] === 1) tp[1]++;
    trackPlaysAll.set(store.track[i], tp);
    if (!keep(i)) continue;

    const ar = store.artist[i];
    const al = store.album[i];
    const tr = store.track[i];
    a.ms += ms; a.plays++;
    a.artistMs.set(ar, (a.artistMs.get(ar) ?? 0) + ms);
    a.albumMs.set(al, (a.albumMs.get(al) ?? 0) + ms);
    const te = a.trackMs.get(tr) ?? [0, 0]; te[0] += ms; te[1]++; a.trackMs.set(tr, te);
    const g = o.genreOf?.(ar);
    if (g) a.genreMs.set(g, (a.genreMs.get(g) ?? 0) + ms);
    const ry = o.albumYear?.[al];
    if (ry) { a.ages.push(y - ry); a.agedMs += ms; if (y - ry <= 1) a.newMs += ms; }

    const d = localDay(t);
    days.set(d, (days.get(d) ?? 0) + ms);
    const tk = `${d}:${tr}`; trackDay.set(tk, (trackDay.get(tk) ?? 0) + 1);
    if (store.skip[i] !== 1) trackDayDone.set(tk, (trackDayDone.get(tk) ?? 0) + 1);
    const ak = `${d}:${ar}`; artistDay.set(ak, (artistDay.get(ak) ?? 0) + ms);
    let ds = artistDays.get(ar); if (!ds) { ds = new Set(); artistDays.set(ar, ds); } ds.add(d);

    // Sessions.
    const start = t - ms;
    if (sStart >= 0 && start - sEnd <= SESSION_GAP) {
      sEnd = Math.max(sEnd, t); sPlays++;
    } else {
      closeSession();
      sStart = start; sEnd = t; sPlays = 1; sArtist = new Map();
    }
    sArtist.set(ar, (sArtist.get(ar) ?? 0) + ms);

    // Same track back to back.
    if (repeat.track === tr) repeat.count++;
    else repeat = { track: tr, count: 1, start: t };
    if (!longestRepeat || repeat.count > longestRepeat.count) {
      longestRepeat = { start: repeat.start, track: store.trackNames[tr], artist: store.artistNames[store.trackArtist[tr]], count: repeat.count };
    }
  }
  closeSession();

  const yearRows: YearRow[] = [...years.entries()].sort((x, y) => x[0] - y[0]).map(([year, a]) => {
    const top = <K,>(m: Map<K, number>) => { let k: K | null = null, v = -1; for (const [kk, vv] of m) if (vv > v) { v = vv; k = kk; } return k === null ? null : { k, v }; };
    const ta = top(a.artistMs);
    const tal = top(a.albumMs);
    let tt: { k: number; v: [number, number] } | null = null;
    for (const [k, v] of a.trackMs) if (!tt || v[0] > tt.v[0]) tt = { k, v };
    const tg = top(a.genreMs);
    const shares = [...a.artistMs.values()].map((v) => v / a.ms).filter((p) => p > 0);
    const entropy = -shares.reduce((s, p) => s + p * Math.log(p), 0);
    const top10 = [...a.artistMs.values()].sort((x, y) => y - x).slice(0, 10).reduce((s, v) => s + v, 0);
    let newArtists = 0;
    for (const ar of a.artistMs.keys()) if (yearOf(firstPlay[ar]) === year) newArtists++;
    return {
      year, ms: a.ms, plays: a.plays, artists: a.artistMs.size, newArtists,
      topArtist: ta ? { id: ta.k, name: store.artistNames[ta.k], ms: ta.v } : null,
      topAlbum: tal ? { id: tal.k, name: store.albumNames[tal.k], sub: store.artistNames[store.albumArtist[tal.k]], ms: tal.v } : null,
      topTrack: tt ? { id: tt.k, name: store.trackNames[tt.k], sub: store.artistNames[store.trackArtist[tt.k]], ms: tt.v[0], plays: tt.v[1] } : null,
      topGenre: tg ? tg.k : null,
      top10Share: a.ms ? top10 / a.ms : 0,
      effectiveArtists: a.ms ? Math.exp(entropy) : 0,
      skipRate: a.skipKnown ? a.skips / a.skipKnown : null,
      shuffleRate: a.shufKnown ? a.shuf / a.shufKnown : null,
      medianMusicAge: median(a.ages),
      newMusicShare: a.agedMs ? a.newMs / a.agedMs : null,
    };
  });

  // Discovery and "stuck" (played again 6+ months after discovery), by discovery year in range.
  const disc = new Map<number, { discovered: number; stuck: number }>();
  for (let ar = 0; ar < firstPlay.length; ar++) {
    const f = firstPlay[ar];
    if (!Number.isFinite(f) || f < o.from || f >= o.to) continue;
    const y = yearOf(f);
    const e = disc.get(y) ?? { discovered: 0, stuck: 0 };
    e.discovered++;
    if (lastPlay[ar] - f >= 182 * DAY) e.stuck++;
    disc.set(y, e);
  }

  // Obsessions.
  let biggestTrackDay: Insights['obsessions']['biggestTrackDay'] = null;
  for (const [k, c] of trackDay) {
    if (!biggestTrackDay || c > biggestTrackDay.plays) {
      const [d, tr] = k.split(':').map(Number);
      biggestTrackDay = { day: d, track: store.trackNames[tr], artist: store.artistNames[store.trackArtist[tr]], plays: c, completed: trackDayDone.get(k) ?? 0 };
    }
  }
  let biggestArtistDay: Insights['obsessions']['biggestArtistDay'] = null;
  for (const [k, ms] of artistDay) {
    if (!biggestArtistDay || ms > biggestArtistDay.ms) {
      const [d, ar] = k.split(':').map(Number);
      biggestArtistDay = { day: d, artist: store.artistNames[ar], ms };
    }
  }
  let longestStreak: Insights['obsessions']['longestStreak'] = null;
  const comebacks: Insights['comebacks'] = [];
  const loyal: Insights['loyal'] = [];
  for (const [ar, ds] of artistDays) {
    const sorted = [...ds].sort((x, y) => x - y);
    let run = 1, runStart = sorted[0];
    for (let k = 1; k <= sorted.length; k++) {
      if (k < sorted.length && sorted[k] === sorted[k - 1] + 1) { run++; continue; }
      if (!longestStreak || run > longestStreak.days) longestStreak = { startDay: runStart, artist: store.artistNames[ar], days: run };
      run = 1; runStart = sorted[k];
    }
    // Biggest gap of a year or more followed by a return.
    let gapBest = 0, returned = 0;
    for (let k = 1; k < sorted.length; k++) {
      const gap = sorted[k] - sorted[k - 1];
      if (gap >= 365 && gap > gapBest) { gapBest = gap; returned = sorted[k]; }
    }
    if (gapBest) {
      comebacks.push({ id: ar, name: store.artistNames[ar], gapDays: gapBest, returnedAt: returned * DAY, msAfter: 0 });
    }
    const ys = new Set(sorted.map((d) => new Date(d * DAY).getUTCFullYear()));
    let ms = 0;
    for (const a of years.values()) ms += a.artistMs.get(ar) ?? 0;
    loyal.push({ id: ar, name: store.artistNames[ar], years: ys.size, ms });
  }
  // Listening after the comeback (time from the return day on).
  if (comebacks.length) {
    const back = new Map(comebacks.map((c) => [c.id, c]));
    for (const [k, ms] of artistDay) {
      const [d, ar] = k.split(':').map(Number);
      const c = back.get(ar);
      if (c && d * DAY >= c.returnedAt) c.msAfter += ms;
    }
  }
  comebacks.sort((a, b) => b.msAfter - a.msAfter || b.gapDays - a.gapDays);
  loyal.sort((a, b) => b.years - a.years || b.ms - a.ms);

  const mostSkipped = [...trackPlaysAll.entries()]
    .filter(([, [p]]) => p >= 10)
    .map(([id, [p, s]]) => ({ id, name: store.trackNames[id], artist: store.artistNames[store.trackArtist[id]], plays: p, skipRate: s / p }))
    .filter((r) => r.skipRate > 0)
    .sort((a, b) => b.skipRate - a.skipRate || b.plays - a.plays)
    .slice(0, 10);

  // Discovery by month, and the most-listened artists discovered each year.
  const monthOf = (t: number) => { const d = new Date(t + o.offset(t)); return d.getUTCFullYear() * 12 + d.getUTCMonth(); };
  const discMonth = new Map<number, number>();
  const discByYear = new Map<number, Array<{ id: number; name: string; ms: number; first: number }>>();
  const msInRange = new Map<number, number>();
  for (const a of years.values()) for (const [ar, ms] of a.artistMs) msInRange.set(ar, (msInRange.get(ar) ?? 0) + ms);
  for (let ar = 0; ar < firstPlay.length; ar++) {
    const f = firstPlay[ar];
    if (!Number.isFinite(f) || f < o.from || f >= o.to) continue;
    const mo = monthOf(f);
    discMonth.set(mo, (discMonth.get(mo) ?? 0) + 1);
    const y = yearOf(f);
    const list = discByYear.get(y) ?? [];
    list.push({ id: ar, name: store.artistNames[ar], ms: msInRange.get(ar) ?? 0, first: f });
    discByYear.set(y, list);
  }
  const notableDiscoveries = [...discByYear.entries()].sort((a, b) => a[0] - b[0])
    .map(([year, list]) => ({ year, artists: list.sort((a, b) => b.ms - a.ms).slice(0, 5) }));

  const sessionLengths = SESSION_BUCKETS.map(([label]) => ({ label, count: 0 }));
  for (const m of sessionMinutes) sessionLengths[SESSION_BUCKETS.findIndex(([, max]) => m < max)].count++;

  const topSongDays = [...trackDay.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8).map(([k, plays]) => {
    const [d, tr] = k.split(':').map(Number);
    return { day: d, track: store.trackNames[tr], artist: store.artistNames[store.trackArtist[tr]], plays, completed: trackDayDone.get(k) ?? 0 };
  });

  const artistSkips = [...artistAllPlays.entries()].sort((a, b) => b[1][0] - a[1][0]).slice(0, 10)
    .map(([id, [p, sk]]) => ({ id, name: store.artistNames[id], plays: p, skipRate: p ? sk / p : 0 }));

  // Monthly and yearly listening for the artists shown in the comeback and loyalty charts.
  const wanted = new Set([...comebacks.slice(0, 10).map((c) => c.id), ...loyal.slice(0, 10).map((l) => l.id)]);
  const am = new Map<number, Map<number, number>>();
  const ay = new Map<number, Map<number, number>>();
  for (const [k, ms] of artistDay) {
    const [d, ar] = k.split(':').map(Number);
    if (!wanted.has(ar)) continue;
    const dt = new Date(d * DAY);
    const mo = dt.getUTCFullYear() * 12 + dt.getUTCMonth();
    if (!am.has(ar)) { am.set(ar, new Map()); ay.set(ar, new Map()); }
    am.get(ar)!.set(mo, (am.get(ar)!.get(mo) ?? 0) + ms);
    ay.get(ar)!.set(dt.getUTCFullYear(), (ay.get(ar)!.get(dt.getUTCFullYear()) ?? 0) + ms);
  }
  const toRec = (m: Map<number, Map<number, number>>) => Object.fromEntries([...m.entries()].map(([id, mm]) => [id, [...mm.entries()].sort((a, b) => a[0] - b[0])]));

  const dayList = [...days.entries()].sort((a, b) => a[0] - b[0]);
  const spanDays = dayList.length ? dayList[dayList.length - 1][0] - dayList[0][0] + 1 : 0;
  return {
    timeZone: o.timeZone,
    years: yearRows,
    days: dayList,
    discovery: [...disc.entries()].sort((a, b) => a[0] - b[0]).map(([year, e]) => ({ year, ...e })),
    sessions: {
      count: sessionsCount,
      perWeek: spanDays ? sessionsCount / (spanDays / 7) : 0,
      medianMinutes: median(sessionMinutes) ?? 0,
      longest,
    },
    obsessions: { biggestTrackDay, biggestArtistDay, longestRepeat, longestStreak },
    mostSkipped,
    comebacks: comebacks.slice(0, 10),
    loyal: loyal.slice(0, 10),
    daysWithMusic: dayList.length,
    totalDays: spanDays,
    discoveryMonthly: [...discMonth.entries()].sort((a, b) => a[0] - b[0]),
    notableDiscoveries,
    sessionLengths,
    sessionStartHours,
    topSongDays,
    artistSkips,
    artistMonths: toRec(am),
    artistYears: toRec(ay),
  };
}
