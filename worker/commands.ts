// Server-side command dispatch (Step 2 of docs/ECONOMY-SERVER.md). Each command
// runs the SAME pure reducer the client uses, so the server is authoritative
// without forking game logic. Reducers self-validate (cost, prereqs, slots) and
// return { state, ok, reason }. More command types are added one at a time
// (Step 3): training, research, healing, collect, faction…

import { startUpgrade, BUILDING_ORDER, type GameState, type BKey } from "../src/lib/game";

export type CommandResult = { state: GameState; ok: boolean; reason?: string };

export function applyCommand(state: GameState, type: string, args: Record<string, unknown>): CommandResult {
  switch (type) {
    case "build.start": {
      const building = String(args?.building || "");
      if (!BUILDING_ORDER.includes(building as BKey)) return { state, ok: false, reason: "Unknown building" };
      return startUpgrade(state, building as BKey);
    }
    default:
      return { state, ok: false, reason: "Unknown command" };
  }
}
