/**
 * Stable color assignment: colors follow the artist (or genre), never its current rank.
 *
 * There are 24 slots: the 8 validated hues in three lightness tiers (base, light, dark). Slots
 * 0-7 are the base hues, so the top artists get the strongest, most distinct colours. The registry is seeded with the all-time top groups, so the
 * most-played artists always get the same slot. When a displayed group has no slot, or shares
 * one with another displayed group, it takes the lowest free slot and keeps it for the rest of
 * the session. Two groups shown together never share a slot.
 */
export const SLOT_COUNT = 24;

export class ColorRegistry {
  private slots = new Map<number, number>();

  constructor(seedOrder: number[] = []) {
    seedOrder.slice(0, SLOT_COUNT).forEach((g, i) => this.slots.set(g, i));
  }

  assign(displayed: number[]): Map<number, number> {
    const out = new Map<number, number>();
    const used = new Set<number>();
    const pending: number[] = [];
    for (const g of displayed) {
      const s = this.slots.get(g);
      if (s !== undefined && !used.has(s)) {
        out.set(g, s);
        used.add(s);
      } else pending.push(g);
    }
    for (const g of pending) {
      let s = 0;
      while (used.has(s) && s < SLOT_COUNT) s++;
      if (s >= SLOT_COUNT) continue; // more than 24 displayed: callers cap top N below that
      out.set(g, s);
      used.add(s);
      this.slots.set(g, s);
    }
    return out;
  }
}

/** Rank group ids by total listening time across the whole store. */
export function rankByTotal(groupCount: number, total: (g: number) => number): number[] {
  const ids = Array.from({ length: groupCount }, (_, i) => i).filter((g) => total(g) > 0);
  return ids.sort((a, b) => total(b) - total(a) || a - b);
}
