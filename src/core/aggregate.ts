/**
 * Aggregation: play store -> compact per-period series for the charts.
 *
 * Rules:
 *  - Periods are UTC months/quarters/years, contiguous, and include empty periods.
 *  - Top N is chosen once over the whole displayed range (not per period).
 *  - Everything outside the top N is summed into "Other", so period totals reconcile.
 *  - A "pinned" group (e.g. "Unclassified" in the genre view) is always shown on its own.
 *  - Plays shorter than the minimum duration are excluded and reported.
 */
import { enumeratePeriods, type Granularity, type Period } from './period';
import type { CountMs, PlayStore } from './importer';

export type Metric = 'hours' | 'share' | 'plays';
/** Colour-coded charts: 8 hues x 3 lightness tiers allow up to 24; the UI offers up to 20. */
export const MAX_TOP_N = 20;

export interface AggregateSettings {
  granularity: Granularity;
  metric: Metric;
  topN: number;
  minMs: number;
  /** Inclusive epoch-ms bounds; periods containing them are included. Null = full history. */
  range: { from: number; to: number } | null;
  /** How the top N are chosen. Defaults to the measure (plays -> times played, else time). */
  rankBy?: 'time' | 'plays';
}

export interface SeriesData {
  key: string;
  label: string;
  kind: 'item' | 'other' | 'unclassified';
  id: number | null;
  colorSlot: number | null;
  ms: number[];
  plays: number[];
  totalMs: number;
  totalPlays: number;
  /** Number of distinct artists/genres folded into this series (Other only). */
  memberCount: number;
  /** Reference for navigation: genre-tree node id for branch series. */
  ref?: string;
}

export interface PeriodTotals extends Period {
  ms: number;
  plays: number;
}

export interface AggregateResult {
  settings: AggregateSettings;
  periods: PeriodTotals[];
  series: SeriesData[];
  /** First and last included play (after filters). Null when nothing is included. */
  coverage: { first: number; last: number } | null;
  included: CountMs;
  belowThreshold: CountMs;
  outsideRange: CountMs;
  /** Distinct groups with included listening in the range. */
  groupCount: number;
  /** Group ids in the top N, in rank order. */
  topIds: number[];
}

export type GroupKind = 'artist' | 'album' | 'track' | 'genre' | 'branch';
export type KeyColumn = 'artist' | 'album' | 'track';

/**
 * How plays map to display groups. Each play is looked up by one key column (its artist, album
 * or track id); `ofKey` returns [groupId, weight] pairs whose weights sum to 1 (or to 0 for a
 * play that belongs to no group in this grouping).
 */
export interface Grouping {
  kind: GroupKind;
  column: KeyColumn;
  labels: string[];
  /** Secondary label per group (e.g. the artist of an album or track). */
  sublabels?: string[];
  ofKey: (keyId: number) => ReadonlyArray<readonly [number, number]>;
  /** Group always shown separately and never counted in top N (e.g. Unclassified). */
  pinnedGroup: number | null;
}

function identity(n: number) {
  const cache = Array.from({ length: n }, (_, i) => [[i, 1]] as const);
  return (k: number) => cache[k];
}

export function artistGrouping(store: PlayStore): Grouping {
  return { kind: 'artist', column: 'artist', labels: store.artistNames, ofKey: identity(store.artistNames.length), pinnedGroup: null };
}

export function albumGrouping(store: PlayStore): Grouping {
  return {
    kind: 'album', column: 'album', labels: store.albumNames,
    sublabels: Array.from(store.albumArtist, (a) => store.artistNames[a]),
    ofKey: identity(store.albumNames.length), pinnedGroup: null,
  };
}

export function trackGrouping(store: PlayStore): Grouping {
  return {
    kind: 'track', column: 'track', labels: store.trackNames,
    sublabels: Array.from(store.trackArtist, (a) => store.artistNames[a]),
    ofKey: identity(store.trackNames.length), pinnedGroup: null,
  };
}

/** Optional per-artist weight in [0, 1] restricting an aggregate to part of the library (e.g. one genre branch). */
export type ArtistScope = ((artistId: number) => number) | null;

function storeBounds(store: PlayStore): { first: number; last: number } | null {
  if (store.length === 0) return null;
  let first = Infinity;
  let last = -Infinity;
  for (let i = 0; i < store.length; i++) {
    const t = store.endedAt[i];
    if (t < first) first = t;
    if (t > last) last = t;
  }
  return { first, last };
}

const OTHER_LABEL: Record<GroupKind, string> = {
  artist: 'Other artists', album: 'Other albums', track: 'Other tracks', genre: 'Other genres', branch: 'Other in this branch',
};

export function aggregate(
  store: PlayStore,
  settings: AggregateSettings,
  grouping: Grouping = artistGrouping(store),
  colorFor: (groupIdsInRankOrder: number[]) => Map<number, number> = defaultColors,
  /** Upper bound on top N. Charts with colour-coded series use 8; labelled lanes allow more. */
  maxTop: number = MAX_TOP_N,
  scope: ArtistScope = null,
  /** Per-play count used for "plays" (e.g. album-listen marks); default 1 per play. */
  countOf: ArrayLike<number> | null = null,
): AggregateResult {
  const topN = Math.max(1, Math.min(maxTop, Math.floor(settings.topN)));
  const bounds = storeBounds(store);
  const included: CountMs = { count: 0, ms: 0 };
  const belowThreshold: CountMs = { count: 0, ms: 0 };
  const outsideRange: CountMs = { count: 0, ms: 0 };

  if (!bounds) {
    return { settings, periods: [], series: [], coverage: null, included, belowThreshold, outsideRange, groupCount: 0, topIds: [] };
  }
  const from = settings.range ? Math.max(settings.range.from, bounds.first) : bounds.first;
  const to = settings.range ? Math.min(settings.range.to, bounds.last) : bounds.last;
  const periods = from <= to ? enumeratePeriods(from, to, settings.granularity) : [];
  const axisStart = periods.length ? periods[0].start : 0;
  const axisEnd = periods.length ? periods[periods.length - 1].end : 0;

  const groupCountAll = grouping.labels.length;
  const gMs = new Float64Array(groupCountAll);
  const gPlays = new Float64Array(groupCountAll);
  const { endedAt, msPlayed, artist } = store;
  const keys = store[grouping.column];
  const sw = new Float64Array(store.length);
  let first = Infinity;
  let last = -Infinity;

  // Pass 1: filter + per-group totals.
  const keep = new Uint8Array(store.length);
  for (let i = 0; i < store.length; i++) {
    const ms = msPlayed[i];
    // Scope first, so exclusion counts describe only the listening this view is about.
    const w0 = scope ? scope(artist[i]) : 1;
    if (w0 <= 0) continue;
    if (ms < settings.minMs) {
      belowThreshold.count += w0;
      belowThreshold.ms += ms * w0;
      continue;
    }
    const t = endedAt[i];
    if (t < axisStart || t >= axisEnd) {
      outsideRange.count += w0;
      outsideRange.ms += ms * w0;
      continue;
    }
    sw[i] = w0;
    keep[i] = 1;
    included.count += w0;
    included.ms += ms * w0;
    if (t < first) first = t;
    if (t > last) last = t;
    const c = countOf ? countOf[i] : 1;
    for (const [g, w] of grouping.ofKey(keys[i])) {
      gMs[g] += ms * w * w0;
      gPlays[g] += w * w0 * c;
    }
  }

  // Rank groups over the whole displayed range.
  const byPlays = (settings.rankBy ?? (settings.metric === 'plays' ? 'plays' : 'time')) === 'plays';
  const candidates: number[] = [];
  let groupCount = 0;
  for (let g = 0; g < groupCountAll; g++) {
    if (gMs[g] > 0) {
      groupCount++;
      if (g !== grouping.pinnedGroup) candidates.push(g);
    }
  }
  candidates.sort((a, b) => {
    const d = byPlays ? gPlays[b] - gPlays[a] || gMs[b] - gMs[a] : gMs[b] - gMs[a] || gPlays[b] - gPlays[a];
    return d || grouping.labels[a].localeCompare(grouping.labels[b]) || a - b;
  });
  const topIds = candidates.slice(0, topN);
  const otherMembers = candidates.length - topIds.length;
  const colors = colorFor(topIds);

  const P = periods.length;
  const series: SeriesData[] = topIds.map((g) => ({
    key: `${grouping.kind}:${g}`, label: grouping.labels[g], kind: 'item', id: g, colorSlot: colors.get(g) ?? null,
    ms: new Array(P).fill(0), plays: new Array(P).fill(0), totalMs: 0, totalPlays: 0, memberCount: 1,
  }));
  const otherIdx = series.length;
  series.push({
    key: 'other', label: OTHER_LABEL[grouping.kind], kind: 'other', id: null, colorSlot: null,
    ms: new Array(P).fill(0), plays: new Array(P).fill(0), totalMs: 0, totalPlays: 0, memberCount: otherMembers,
  });
  let pinnedIdx = -1;
  if (grouping.pinnedGroup !== null) {
    pinnedIdx = series.length;
    series.push({
      key: 'unclassified', label: grouping.labels[grouping.pinnedGroup], kind: 'unclassified', id: grouping.pinnedGroup, colorSlot: null,
      ms: new Array(P).fill(0), plays: new Array(P).fill(0), totalMs: 0, totalPlays: 0, memberCount: 1,
    });
  }
  const seriesOf = new Int32Array(groupCountAll).fill(otherIdx);
  topIds.forEach((g, i) => (seriesOf[g] = i));
  if (grouping.pinnedGroup !== null) seriesOf[grouping.pinnedGroup] = pinnedIdx;

  // Pass 2: per-period accumulation.
  const g0 = settings.granularity;
  const firstOrd = periods.length ? ordinalOf(periods[0].start, g0) : 0;
  const pMs = new Float64Array(P);
  const pPlays = new Float64Array(P);
  for (let i = 0; i < store.length; i++) {
    if (!keep[i]) continue;
    const p = ordinalOf(endedAt[i], g0) - firstOrd;
    const ms = msPlayed[i];
    const w0 = sw[i];
    const c = countOf ? countOf[i] : 1;
    pMs[p] += ms * w0;
    pPlays[p] += w0 * c;
    for (const [g, w] of grouping.ofKey(keys[i])) {
      const s = series[seriesOf[g]];
      s.ms[p] += ms * w * w0;
      s.plays[p] += w * w0 * c;
    }
  }
  for (const s of series) {
    s.totalMs = s.ms.reduce((a, b) => a + b, 0);
    s.totalPlays = s.plays.reduce((a, b) => a + b, 0);
  }
  const outSeries = series.filter((s) => s.kind === 'item' || s.totalMs > 0 || (s.kind === 'unclassified'));

  return {
    settings: { ...settings, topN },
    periods: periods.map((p, i) => ({ ...p, ms: pMs[i], plays: pPlays[i] })),
    series: outSeries,
    coverage: included.count ? { first, last } : null,
    included, belowThreshold, outsideRange, groupCount, topIds,
  };
}

function ordinalOf(ms: number, g: Granularity): number {
  const d = new Date(ms);
  const y = d.getUTCFullYear();
  if (g === 'year') return y;
  const m = d.getUTCMonth();
  return g === 'quarter' ? y * 4 + ((m / 3) | 0) : y * 12 + m;
}

function defaultColors(ids: number[]): Map<number, number> {
  return new Map(ids.map((g, i) => [g, i]));
}

/** Value of a series in a period for the chosen metric. Share is null for empty periods. */
export function valueAt(s: SeriesData, p: PeriodTotals, i: number, metric: Metric): number | null {
  if (metric === 'hours') return s.ms[i] / 3_600_000;
  if (metric === 'plays') return s.plays[i];
  return p.ms > 0 ? (s.ms[i] / p.ms) * 100 : null;
}

export function periodTotal(p: PeriodTotals, metric: Metric): number | null {
  if (metric === 'hours') return p.ms / 3_600_000;
  if (metric === 'plays') return p.plays;
  return p.ms > 0 ? 100 : null;
}

export const METRIC_LABEL: Record<Metric, string> = {
  hours: 'Listening hours',
  share: 'Share of listening time (%)',
  plays: 'Play count',
};
