import { describe, expect, it } from "vitest";
import defaults from "../../docs/numbers.json";
import { initGame } from "./gamestore";
import {
  advanceSharedWorld, applySharedCommand, createSharedWorld, joinSharedWorld, nextSharedEventAt, playerSlice,
  retirePrivateWorld, searchShared, sharedView, type SharedWorldState,
} from "./shared-world";
import { createLocalWorldSession } from "./world-adapter";
import { applyWorldAuthorityCommand } from "./world-authority";
import type { ResourceEntity } from "./world-engine";

const now = 1_800_000_000_000;

function numbers() {
  const n: any = structuredClone(defaults);
  n.world.population.minimumResourceFields = 30;
  n.world.population.minimumMonsters = 10;
  return n;
}

function game(address: string, army = 60) {
  const g = initGame(address);
  g.lastTick = now;
  g.troops.army["1"] = army;
  return g;
}

function twoPlayers() {
  const n = numbers();
  let state = createSharedWorld(now, n);
  const a = game("0xaaa"), b = game("0xbbb");
  state = joinSharedWorld(state, { playerId: "0xaaa", coord: { x: 30, y: 256 }, game: a, now, numbers: n });
  state = joinSharedWorld(state, { playerId: "0xbbb", coord: { x: 482, y: 256 }, game: b, now, numbers: n });
  return { n, state, a, b };
}

function resourceNear(state: SharedWorldState, x: number): ResourceEntity {
  return Object.values(state.world.entities)
    .filter((entity): entity is ResourceEntity => entity.kind === "resource" && entity.state === "available")
    .sort((p, q) => Math.abs(p.position.x - x) - Math.abs(q.position.x - x))[0];
}

describe("shared world (P0-1)", () => {
  it("seeds one public ecology and places players at their shared coordinates", () => {
    const { state } = twoPlayers();
    const entities = Object.values(state.world.entities);
    expect(entities.filter((entity) => entity.kind === "resource").length).toBeGreaterThanOrEqual(30);
    expect(entities.filter((entity) => entity.kind === "monster").length).toBeGreaterThanOrEqual(10);
    expect(state.world.entities[state.world.players["0xaaa"].cityId].position).toEqual({ x: 30, y: 256 });
  });

  it("lets two players compete for the same planet: the occupier holds, the other side sees it occupied", () => {
    const { n, state, a, b } = twoPlayers();
    const node = resourceNear(state, 256);
    node.amount = node.capacity = 50_000;
    const sentA = applySharedCommand(state, "0xaaa", a, { type: "world.dispatch", args: { targetId: node.id, action: "gather", force: { army: { "1": 20 } }, dispatchKey: "a1" } }, now + 1, n);
    expect(sentA.ok).toBe(true);
    expect(sentA.game.troops.army["1"]).toBe(40);
    const marchA = Object.values(sentA.state.world.marches).find((march) => march.playerId === "0xaaa")!;
    // The DO alarm resolves the arrival even though A never sends another command.
    expect(nextSharedEventAt(sentA.state)).toBe(marchA.arriveAt);
    const arrived = advanceSharedWorld(sentA.state, marchA.arriveAt, n);
    const view = sharedView(arrived, { x0: node.position.x - 1, y0: node.position.y - 1, x1: node.position.x + 1, y1: node.position.y + 1 });
    const seen = view.targets.find((entity) => entity.id === node.id) as ResourceEntity;
    expect(seen.state).toBe("occupied");
    expect(view.occupiers[seen.occupiedByMarchId!]).toBe("0xaaa");
    // B's search skips the occupied planet.
    const found = searchShared(arrived, "0xbbb", node.resource, node.level);
    expect(found.target?.id).not.toBe(node.id);
    // B cannot read A's marches or city from its own slice.
    const sliceB = playerSlice(arrived, "0xbbb")!;
    expect(Object.keys(sliceB.players)).toEqual(["0xbbb"]);
    expect(Object.values(sliceB.marches).every((march) => march.playerId === "0xbbb")).toBe(true);
    expect(sliceB.entities[arrived.world.players["0xaaa"].cityId]).toBeUndefined();
    void b;
  });

  it("delivers troops and cargo back into the game on the next sync", () => {
    const { n, state, a } = twoPlayers();
    const node = resourceNear(state, 30);
    const sent = applySharedCommand(state, "0xaaa", a, { type: "world.dispatch", args: { targetId: node.id, action: "gather", force: { army: { "1": 20 } }, dispatchKey: "a1" } }, now + 1, n);
    const march = Object.values(sent.state.world.marches).find((m) => m.playerId === "0xaaa")!;
    let world = advanceSharedWorld(sent.state, march.arriveAt, n);
    world = advanceSharedWorld(world, world.world.marches[march.id].workUntil, n);
    world = advanceSharedWorld(world, world.world.marches[march.id].returnAt, n);
    const synced = applySharedCommand(world, "0xaaa", sent.game, { type: "world.advance", args: {} }, world.world.marches[march.id].returnAt + 1, n);
    expect(synced.game.troops.army["1"]).toBe(60);
    expect(synced.game.res[node.resource]).toBeGreaterThan(sent.game.res[node.resource]);
  });

  it("retires a private world without losing a fleet in flight, keeping Rogue progress", () => {
    const n: any = numbers();
    n.world.population.localNpcCities = 0;
    const g = game("0xccc");
    const local = createLocalWorldSession(g.address, g, now, n);
    const session = { ...local.session, playerId: local.session.playerId };
    const target = Object.values(session.world.entities).find((entity) => entity.kind === "resource")!;
    const sent = applyWorldAuthorityCommand(session, local.game, { type: "world.dispatch", args: { targetId: target.id, action: "gather", force: { army: { "1": 20 } }, dispatchKey: "p1" } }, now + 5, n);
    expect(sent.ok).toBe(true);
    sent.session.world.players[session.playerId].highestMonsterDefeated = 4;
    const retired = retirePrivateWorld(sent.session, sent.game, now + 10, n);
    expect(retired.game.troops.army["1"]).toBe(60);
    expect(retired.carry.highestMonsterDefeated).toBe(4);
    let state = createSharedWorld(now, n);
    state = joinSharedWorld(state, { playerId: session.playerId, coord: { x: 100, y: 30 }, game: retired.game, carry: retired.carry, now: now + 10, numbers: n });
    expect(state.world.players[session.playerId].highestMonsterDefeated).toBe(4);
  });
});
