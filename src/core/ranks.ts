/**
 * Per-period rank of selected groups among ALL groups (not just the displayed ones), for the
 * bump chart. Rank 1 = most listened in that period by the chosen metric. Null = no plays.
 */
import { enumeratePeriods } from './period';
import type { AggregateResult, Grouping } from './aggregate';
import type { PlayStore } from './importer';

export interface RankResult {
  /** Same order as `groupIds`. ranks[g][p] */
  ranks: Array<Array<number | null>>;
  /** Number of groups with plays in each period. */
  competitors: number[];
}

export function periodRanks(store: PlayStore, agg: AggregateResult, grouping: Grouping, groupIds: number[], scope: ((artistId: number) => number) | null = null, countOf: ArrayLike<number> | null = null): RankResult {
  const { settings } = agg;
  const P = agg.periods.length;
  if (!P) return { ranks: groupIds.map(() => []), competitors: [] };
  const periods = enumeratePeriods(agg.periods[0].start, agg.periods[P - 1].start, settings.granularity);
  const byPlays = (settings.rankBy ?? (settings.metric === 'plays' ? 'plays' : 'time')) === 'plays';
  const per: Array<Map<number, number>> = periods.map(() => new Map());
  const start = periods[0].start;
  const end = periods[P - 1].end;
  let p = 0;
  // Plays are not sorted; locate each period by binary search over period starts.
  const starts = periods.map((x) => x.start);
  for (let i = 0; i < store.length; i++) {
    const t = store.endedAt[i];
    const ms = store.msPlayed[i];
    if (ms < settings.minMs || t < start || t >= end) continue;
    let lo = 0;
    let hi = P - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (starts[mid] <= t) lo = mid; else hi = mid - 1;
    }
    p = lo;
    const w0 = scope ? scope(store.artist[i]) : 1;
    if (w0 <= 0) continue;
    for (const [g, w] of grouping.ofKey(store[grouping.column][i])) {
      if (g === grouping.pinnedGroup) continue;
      per[p].set(g, (per[p].get(g) ?? 0) + (byPlays ? w * w0 * (countOf ? countOf[i] : 1) : ms * w * w0));
    }
  }
  const competitors = per.map((m) => m.size);
  const ranks = groupIds.map((g) => per.map((m) => {
    const v = m.get(g);
    if (!v) return null;
    let rank = 1;
    for (const [other, ov] of m) if (other !== g && (ov > v || (ov === v && other < g))) rank++;
    return rank;
  }));
  return { ranks, competitors };
}
