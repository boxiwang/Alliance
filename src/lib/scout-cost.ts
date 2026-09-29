// Scouting a commander costs Oil (owner rule, 2026-09-28): affordable for everyone, but not
// free to spam. Cost = your Oil production per hour x minutes / 60, where
// minutes = baseMinutes + distance / tilesPerExtraMinute (capped at maxMinutes), and never
// below `minimum`. Numbers live in numbers.json global.march.scoutCost.
import { prodPerHour, type GameState } from "./game";

export type ScoutCostConfig = { baseMinutes: number; tilesPerExtraMinute: number; maxMinutes: number; minimum: number };

export function scoutCostConfig(numbers: any): ScoutCostConfig {
  const c = numbers?.global?.march?.scoutCost ?? {};
  const num = (value: unknown, fallback: number) => (Number.isFinite(Number(value)) && Number(value) >= 0 ? Number(value) : fallback);
  return {
    baseMinutes: num(c.baseMinutes, 4),
    tilesPerExtraMinute: Math.max(1, num(c.tilesPerExtraMinute, 150)),
    maxMinutes: num(c.maxMinutes, 12),
    minimum: num(c.minimum, 30),
  };
}

/** Oil (internal units) to scout a commander `distanceTiles` away. */
export function scoutOilCost(game: GameState, distanceTiles: number, numbers: any): number {
  const config = scoutCostConfig(numbers);
  const minutes = Math.min(config.maxMinutes, config.baseMinutes + Math.max(0, distanceTiles) / config.tilesPerExtraMinute);
  const perHour = prodPerHour(game).oil || 0;
  return Math.max(config.minimum, Math.ceil(perHour * minutes / 60));
}
