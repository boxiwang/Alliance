// Server-side command dispatch (Step 2 of docs/ECONOMY-SERVER.md). Each command
// runs the SAME pure reducer the client uses, so the server is authoritative
// without forking game logic. Reducers self-validate (cost, prereqs, slots) and
// return { state, ok, reason }. More command types are added one at a time
// (Step 3): training, research, healing, collect, faction…

import {
  BUILDING_ORDER, TROOP_ORDER, startHealing, startPromote, startResearch, startTrain, startUpgrade,
  type BKey, type GameState, type TroopKey,
} from "../src/lib/game";

export type CommandResult = { state: GameState; ok: boolean; reason?: string };

export function applyCommand(state: GameState, type: string, args: Record<string, unknown>): CommandResult {
  switch (type) {
    case "session.activity":
      // player-api projected the state to this command's timestamp; committing
      // it checkpoints active production without granting any other effect.
      return { state, ok: true };
    case "build.start": {
      const building = String(args?.building || "");
      if (!BUILDING_ORDER.includes(building as BKey)) return { state, ok: false, reason: "Unknown building" };
      return startUpgrade(state, building as BKey);
    }
    case "training.start": {
      const troop = String(args?.troop || "");
      if (!TROOP_ORDER.includes(troop as TroopKey)) return { state, ok: false, reason: "Unknown troop type" };
      return startTrain(state, troop as TroopKey, Math.floor(Number(args?.tier)), Math.floor(Number(args?.quantity)));
    }
    case "promotion.start": {
      const troop = String(args?.troop || "");
      if (!TROOP_ORDER.includes(troop as TroopKey)) return { state, ok: false, reason: "Unknown troop type" };
      return startPromote(
        state,
        troop as TroopKey,
        Math.floor(Number(args?.sourceTier)),
        Math.floor(Number(args?.targetTier)),
        Math.floor(Number(args?.quantity)),
      );
    }
    case "research.start":
      return startResearch(state, String(args?.tech || ""));
    case "healing.start":
      return startHealing(state, Math.floor(Number(args?.quantity)));
    default:
      return { state, ok: false, reason: "Unknown command" };
  }
}
