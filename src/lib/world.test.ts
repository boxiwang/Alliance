import { describe, expect, it } from "vitest";
import defaults from "../../docs/numbers.json";
import { initGame } from "./gamestore";
import { Force } from "./expedition";
import {
  WORLD_CENTER, WORLD_RADIUS, dispatchMarch, initWorld, levelForPoint, projectWorld,
} from "./world";

const N: any = defaults;
const force = (qty: number): Force => ({ troops: { army: { "1": qty }, navy: {}, air: {} } });

describe("personal world", () => {
  it("creates a deterministic wallet-bound city away from the fixed Circle", () => {
    const first = initWorld("0xabc", N);
    const again = initWorld("0xabc", N);
    const other = initWorld("0xdef", N);
    expect(first.player).toEqual(again.player);
    expect(first.player).not.toEqual(other.player);
    expect(Math.hypot(first.player.x - WORLD_CENTER.x, first.player.y - WORLD_CENTER.y)).toBeGreaterThan(WORLD_RADIUS * .8);
    expect(levelForPoint(WORLD_CENTER, N)).toBe(10);
    expect(levelForPoint(first.player, N)).toBeLessThanOrEqual(2);
  });

  it("reserves real troops for gathering and returns them with resources", () => {
    const now = 1_800_000_000_000;
    const world = initWorld("0xgather", N);
    const node = world.targets.find((item) => item.target.kind === "node")!;
    const game = initGame("0xgather");
    game.lastTick = now;
    game.buildings.armyCamp.lvl = 1;
    game.troops.army["1"] = 10;
    game.res = { cash: 0, oil: 0, power: 0 };
    const result = dispatchMarch(world, game, node.id, "gather", force(5), now, N);
    expect(result.ok).toBe(true);
    expect(result.game.troops.army["1"]).toBe(5);
    const march = result.world.marches[0];
    const projected = projectWorld(result.world, result.game, march.returnAt + 1);
    expect(projected.changed).toBe(true);
    expect(projected.game.troops.army["1"]).toBe(10);
    if (node.target.kind === "node") expect(projected.game.res[node.target.resource]).toBeGreaterThan(0);
  });

  it("uses two march slots and blocks a third dispatch", () => {
    const now = 1_800_000_000_000;
    const world = initWorld("0xqueues", N);
    const target = world.targets.find((item) => item.target.kind === "monster")!;
    const game = initGame("0xqueues");
    game.lastTick = now;
    const first = dispatchMarch(world, game, target.id, "scout", force(0), now, N);
    const second = dispatchMarch(first.world, first.game, target.id, "scout", force(0), now + 1, N);
    const third = dispatchMarch(second.world, second.game, target.id, "scout", force(0), now + 2, N);
    expect(first.ok).toBe(true);
    expect(second.ok).toBe(true);
    expect(third.ok).toBe(false);
    expect(third.reason).toMatch(/queues/i);
  });

  it("never offers scouting as an action against a resource field", () => {
    const world = initWorld("0xnode", N);
    const node = world.targets.find((item) => item.target.kind === "node")!;
    const result = dispatchMarch(world, initGame("0xnode"), node.id, "scout", force(0), Date.now(), N);
    expect(result.ok).toBe(false);
    expect(result.reason).toMatch(/never need scouting/i);
  });
});
