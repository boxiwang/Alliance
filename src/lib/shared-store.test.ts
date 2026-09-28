import { describe, expect, it } from "vitest";
import defaults from "../../docs/numbers.json";
import { initGame } from "./gamestore";
import { applySharedCommand, createSharedWorld, joinSharedWorld } from "./shared-world";
import { assembleShared, chunkDelta, sharedChunks } from "./shared-store";

const now = 1_800_000_000_000;

function world() {
  const n: any = structuredClone(defaults);
  let state = createSharedWorld(now, n);
  for (const id of ["0xaaa", "0xbbb", "0xccc"]) {
    const g = initGame(id); g.lastTick = now; g.troops.army["1"] = 60;
    state = joinSharedWorld(state, { playerId: id, coord: { x: 40, y: 256 }, game: g, now, numbers: n });
  }
  return { n, state };
}

describe("shared world chunked store", () => {
  it("round-trips the shared world exactly", () => {
    const { state } = world();
    const rebuilt = assembleShared(sharedChunks(state))!;
    expect(JSON.parse(JSON.stringify(rebuilt))).toEqual(JSON.parse(JSON.stringify(state)));
  });

  it("writes only the chunks a command changed", () => {
    const { n, state } = world();
    const saved = sharedChunks(state);
    const g = initGame("0xaaa"); g.lastTick = now; g.troops.army["1"] = 60;
    const target = Object.values(state.world.entities).find((entity) => entity.kind === "resource")!;
    const result = applySharedCommand(state, "0xaaa", g, { type: "world.dispatch", args: { targetId: target.id, action: "gather", force: { army: { "1": 20 } }, dispatchKey: "k" } }, now + 1, n);
    expect(result.ok).toBe(true);
    const next = sharedChunks(result.state);
    const delta = chunkDelta(saved, next);
    expect(delta.put.size).toBeGreaterThan(0);
    expect(delta.put.size).toBeLessThan(next.size / 2);
    // Applying the delta to the saved copy reproduces the new world.
    const merged = new Map(saved);
    delta.put.forEach((value, key) => merged.set(key, value));
    delta.remove.forEach((key) => merged.delete(key));
    expect(JSON.parse(JSON.stringify(assembleShared(merged)))).toEqual(JSON.parse(JSON.stringify(result.state)));
  });

  it("has no save without meta", () => {
    expect(assembleShared(new Map())).toBeNull();
  });
});
