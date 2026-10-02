/**
 * Detects sparse stray plays at the edges of a history (e.g. a handful of plays years before
 * regular listening starts) so the default chart range can start where listening actually does.
 *
 * Rule (deliberately conservative, and always reported to the user, never silently applied):
 *  - "Regular listening" starts at the first month m where months m..m+2 together hold at least
 *    max(10, 10% of the median non-empty month) plays, and month m alone holds a third of that
 *    (so one stray play just before regular listening is not counted as its start). It ends symmetrically.
 *  - The edge is trimmed only if the plays outside it total at most 2% of all plays.
 *  - Histories with fewer than 100 plays are never trimmed.
 */
export interface ActiveRange {
  /** Month ordinals (year*12+month), inclusive. */
  fromMonth: number;
  toMonth: number;
  leading: number; // plays before fromMonth
  trailing: number; // plays after toMonth
  trimmed: boolean;
}

export function detectActiveRange(monthly: { firstMonth: number; counts: number[] }): ActiveRange {
  const c = monthly.counts;
  const total = c.reduce((a, b) => a + b, 0);
  const none: ActiveRange = { fromMonth: monthly.firstMonth, toMonth: monthly.firstMonth + c.length - 1, leading: 0, trailing: 0, trimmed: false };
  if (total < 100 || c.length < 6) return none;
  const nz = c.filter((x) => x > 0).sort((a, b) => a - b);
  const median = nz[Math.floor(nz.length / 2)];
  const need = Math.max(10, 0.1 * median);
  const win = (i: number, dir: 1 | -1) => c[i] + (c[i + dir] ?? 0) + (c[i + 2 * dir] ?? 0);

  let start = 0;
  const starts = (i: number, dir: 1 | -1) => c[i] >= need / 3 && win(i, dir) >= need;
  while (start < c.length && !starts(start, 1)) start++;
  let end = c.length - 1;
  while (end > start && !starts(end, -1)) end--;
  const leading = c.slice(0, start).reduce((a, b) => a + b, 0);
  const trailing = c.slice(end + 1).reduce((a, b) => a + b, 0);
  const keepLead = leading > 0 && leading <= 0.02 * total;
  const keepTrail = trailing > 0 && trailing <= 0.02 * total;
  if (!keepLead && !keepTrail) return none;
  return {
    fromMonth: monthly.firstMonth + (keepLead ? start : 0),
    toMonth: monthly.firstMonth + (keepTrail ? end : c.length - 1),
    leading: keepLead ? leading : 0,
    trailing: keepTrail ? trailing : 0,
    trimmed: true,
  };
}

export function monthStart(ord: number): number {
  return Date.UTC(Math.floor(ord / 12), ord % 12, 1);
}
