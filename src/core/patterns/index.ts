/**
 * Pattern models over your listening: eras, taste components, the co-listening map and artist
 * lifecycles. Everything is computed locally from qualifying plays in the selected range; every
 * model is deterministic (fixed seeds), so the same data always gives the same result.
 */
import type { AggregateSettings } from '../aggregate';
import { monthlyMatrix, qualifyingPlays, type PatternInput } from './monthly';
import { listeningEras, type ErasResult } from './eras';
import { tasteComponents, TASTE_ARTISTS, type TastesResult } from './tastes';
import { colistenMap, MAP_ARTISTS, type ColistenResult, type Neighbour } from './colisten';
import { lifecycles, type LifeKind, type LifecycleResult } from './lifecycle';

export type { Era, ErasResult } from './eras';
export type { Taste, TastesResult } from './tastes';
export type { MapNode, Neighbour } from './colisten';
export type { LifeKind, LifeArtist, SurvivalPoint } from './lifecycle';
export { LIFE_KINDS } from './lifecycle';
export { MAP_ARTISTS, nodeRadius } from './colisten';

export const DEFAULT_TASTES = 6;

/** What the UI and the share report receive (plain data, no Maps). */
export interface Patterns {
  eras: ErasResult;
  tastes: TastesResult | null;
  map: Omit<ColistenResult, 'neighbours'>;
  life: Omit<LifecycleResult, 'kindOf'>;
}

export interface PatternState {
  view: Omit<Patterns, 'tastes'>;
  neighbours: Map<number, Neighbour[]>;
  kindOf: Map<number, LifeKind>;
}

/** Eras, the co-listening map and lifecycles (independent of chart granularity). */
export function computeCorePatterns(input: PatternInput, mapSize = MAP_ARTISTS): PatternState {
  const plays = qualifyingPlays(input);
  const eras = listeningEras(input, plays);
  const { neighbours, ...map } = colistenMap(input, plays, mapSize);
  const { kindOf, ...life } = lifecycles(input, plays);
  for (const nd of map.nodes) nd.kind = kindOf.get(nd.id) ?? null;
  return { view: { eras, map, life }, neighbours, kindOf };
}

/** Taste components with k tastes, attributed to the chart periods in `settings`. */
export function computeTastes(input: PatternInput, settings: AggregateSettings, k = DEFAULT_TASTES): TastesResult | null {
  const plays = qualifyingPlays(input);
  return tasteComponents(input, settings, k, plays, monthlyMatrix(input, plays, TASTE_ARTISTS));
}

export function computePatterns(input: PatternInput, settings: AggregateSettings, k = DEFAULT_TASTES, mapSize = MAP_ARTISTS): PatternState & { tastes: TastesResult | null } {
  return { ...computeCorePatterns(input, mapSize), tastes: computeTastes(input, settings, k) };
}
