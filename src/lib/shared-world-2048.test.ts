import { describe, expect, it } from "vitest";
import defaults from "../../docs/numbers.json";
import { initGame } from "./gamestore";
import { createSharedWorld, joinSharedWorld, openArea, openSharedQuadrant, rebuildSharedWorld } from "./shared-world";
import { quadrantOf, warpBlockReason } from "./world-engine";

const now = 1_800_000_000_000;
const numbers = () => structuredClone(defaults) as any;

describe("map 2048 shared world (docs/MAP-2048.md)", () => {
  it("starts with only the NW quadrant open and fills it by area, quickly", () => {
    const started = performance.now();
    const state = createSharedWorld(now, numbers());
    const elapsed = performance.now() - started;
    expect(state.world.config.width).toBe(2048);
    expect(state.world.config.openQuadrants).toEqual([0]);
    const targets = Object.values(state.world.entities).filter((entity) => entity.kind === "resource" || entity.kind === "monster");
    const area = openArea(state.world);
    expect(targets.filter((entity) => entity.kind === "resource").length).toBe(Math.floor(area / 100));
    expect(targets.filter((entity) => entity.kind === "monster").length).toBe(Math.floor(area / 400));
    expect(targets.every((entity) => quadrantOf(entity.position, state.world.config) === 0)).toBe(true);
    expect(elapsed).toBeLessThan(15_000);
  });

  it("opens the next quadrant with its own ecology and keeps sealed land unreachable", () => {
    const n = numbers();
    let state = createSharedWorld(now, n);
    const g = initGame("0xaaa"); g.lastTick = now;
    state = joinSharedWorld(state, { playerId: "0xaaa", coord: { x: 300, y: 900 }, game: g, now, numbers: n });
    const sealed = { x: 1700, y: 400 }; // NE
    expect(warpBlockReason(state.world, "0xaaa", sealed)).toBe("sector_sealed");
    const before = Object.keys(state.world.entities).length;
    state = openSharedQuadrant(state, 1, now, n);
    expect(state.world.config.openQuadrants).toEqual([0, 1]);
    expect(Object.values(state.world.entities).some((entity) => entity.kind !== "city" && quadrantOf(entity.position, state.world.config) === 1)).toBe(true);
    expect(Object.keys(state.world.entities).length).toBeGreaterThan(before * 1.8);
    expect(warpBlockReason(state.world, "0xaaa", sealed)).not.toBe("sector_sealed");
  });

  it("rebuilds an old world at the new size keeping each player's troops, resources and progress", () => {
    const n = numbers();
    const old512: any = structuredClone(defaults);
    old512.world.state.width = 512; old512.world.state.height = 512; old512.world.state.circleReserveRadius = 38;
    old512.world.population.resourceTilesPer = 0; // old per-player rule
    let old = createSharedWorld(now, old512);
    const g = initGame("0xaaa"); g.lastTick = now; g.troops.army["1"] = 77;
    old = joinSharedWorld(old, { playerId: "0xaaa", coord: { x: 30, y: 256 }, game: g, carry: { highestMonsterDefeated: 5 }, now, numbers: old512 });
    const rebuilt = rebuildSharedWorld(old, { "0xaaa": { x: 200, y: 700 } }, now + 1, n);
    const player = rebuilt.world.players["0xaaa"];
    expect(rebuilt.world.config.width).toBe(2048);
    expect(player.troops.army["1"]).toBe(77);
    expect(player.highestMonsterDefeated).toBe(5);
    expect(rebuilt.world.entities[player.cityId].position).toEqual({ x: 200, y: 700 });
    expect(rebuilt.synced["0xaaa"]).toEqual(old.synced["0xaaa"]);
    expect(Object.keys(rebuilt.world.marches)).toEqual([]);
  });
});
