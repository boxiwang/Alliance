// Shared-economy boundary for the worker (Step 0 of docs/ECONOMY-SERVER.md).
// The worker imports the SAME pure engine the client uses — never a fork — so
// server-authoritative economy (later steps) and combat resolution run the exact
// same rules. The engine is DOM-free: getN() falls back to the bundled
// docs/numbers.json when there's no localStorage.

import { project, type GameState } from "../src/lib/game";

export function gameStateBelongsToPlayer(game: Pick<GameState, "address"> | null, playerId: string): boolean {
  return typeof game?.address === "string" && game.address.toLowerCase() === playerId.toLowerCase();
}

/** Advance a mirrored game_json string to `now` with the shared engine. */
export function projectGameJson(gameJson: string | null | undefined, now = Date.now()): GameState | null {
  if (!gameJson) return null;
  try {
    const state = JSON.parse(gameJson) as GameState;
    if (!state || typeof state !== "object") return null;
    return project(state, now);
  } catch {
    return null;
  }
}
