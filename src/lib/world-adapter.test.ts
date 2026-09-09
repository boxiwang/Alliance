import { beforeEach, describe, expect, it } from "vitest";
import defaults from "../../docs/numbers.json";
import { initGame } from "./gamestore";
import { gmFillTroops } from "./gm";
import { distance, worldCenter, worldPlayableRadius } from "./world-engine";
import {
  advanceLocalWorldSession, createLocalWorldSession, dispatchLocalWorldMarch,
  finishLocalWorldMarches, loadLocalWorldSession, openLocalWorldSession, recallLocalWorldMarch, saveLocalWorldSession,
} from "./world-adapter";
import { dispatchMarch as dispatchLegacy, initWorld as initLegacyWorld, saveWorld as saveLegacyWorld } from "./world";

function numbers(): any {
  const value: any = structuredClone(defaults);
  value.world.population.localNpcCities = 2;
  value.world.population.minimumResourceFields = 3;
  value.world.population.minimumMonsters = 2;
  value.world.population.resourceFieldsPerPlayer = 0;
  value.world.population.monstersPerPlayer = 0;
  return value;
}

function game(address: string, now: number, troops = 10) {
  const value = initGame(address);
  value.lastTick = now;
  value.buildings.armyCamp.lvl = 1;
  value.troops.army["1"] = troops;
  value.res = { cash: 0, oil: 0, power: 0 };
  return value;
}

beforeEach(() => {
  const storage = new Map<string, string>();
  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    value: {
      getItem: (key: string) => storage.get(key) ?? null,
      setItem: (key: string, value: string) => storage.set(key, value),
      removeItem: (key: string) => storage.delete(key),
    },
  });
});

describe("local GameState ↔ headless World adapter", () => {
  it("creates the player at an outer spawn and keeps NPC cities sparse", () => {
    const now = 1_800_000_000_000;
    const result = createLocalWorldSession("0xouter", game("0xouter", now), now, numbers());
    const city = result.session.world.entities[result.session.world.players[result.session.playerId].cityId];
    expect(city.kind).toBe("city");
    expect(distance(city.position, worldCenter(result.session.world.config)))
      .toBeGreaterThan(worldPlayableRadius(result.session.world.config) * .9);
    expect(Object.keys(result.session.world.players)).toHaveLength(3);
  });

  it("does not create a next-level Rogue merely because personal progression changes", () => {
    const now = 1_800_000_000_000;
    const base = createLocalWorldSession("0xecology", game("0xecology", now), now, numbers());
    const before = Object.values(base.session.world.entities).filter((entity) => entity.kind === "monster").length;
    base.session.world.players[base.session.playerId].highestMonsterDefeated = 3;
    const advanced = advanceLocalWorldSession(base.session, base.game, now + 1000, numbers());
    const after = Object.values(advanced.session.world.entities).filter((entity) => entity.kind === "monster").length;
    expect(after).toBe(before);
  });

  it("reserves GameState troops, resolves gathering, and delivers the same engine result back", () => {
    const now = 1_800_000_000_000;
    const base = createLocalWorldSession("0xgather2", game("0xgather2", now), now, numbers());
    const node = Object.values(base.session.world.entities).find((entity) => entity.kind === "resource")!;
    let sent = dispatchLocalWorldMarch(base.session, base.game, {
      targetId: node.id, action: "gather", force: { army: { "1": 5 }, navy: {}, air: {} },
      idempotencyKey: "gather-1",
    }, now + 1000, numbers());
    expect(sent.error).toBeUndefined();
    expect(sent.game.troops.army["1"]).toBe(5);
    const marchId = Object.keys(sent.session.world.marches)[0];
    sent = advanceLocalWorldSession(sent.session, sent.game, sent.session.world.marches[marchId].arriveAt, numbers());
    const working = sent.session.world.marches[marchId];
    sent = advanceLocalWorldSession(sent.session, sent.game, working.workUntil, numbers());
    sent = advanceLocalWorldSession(sent.session, sent.game, sent.session.world.marches[marchId].returnAt, numbers());
    expect(sent.session.world.marches[marchId].state).toBe("completed");
    expect(sent.game.troops.army["1"]).toBe(10);
    expect(Object.values(sent.game.res).some((amount) => amount > 0)).toBe(true);
  });

  it("merges troops trained in Town while a World march is away", () => {
    const now = 1_800_000_000_000;
    const base = createLocalWorldSession("0xmerge", game("0xmerge", now), now, numbers());
    const node = Object.values(base.session.world.entities).find((entity) => entity.kind === "resource")!;
    let sent = dispatchLocalWorldMarch(base.session, base.game, {
      targetId: node.id, action: "gather", force: { army: { "1": 5 }, navy: {}, air: {} },
      idempotencyKey: "merge-1",
    }, now + 1000, numbers());
    sent.game.troops.army["1"] += 3; // simulated Town training after dispatch
    const marchId = Object.keys(sent.session.world.marches)[0];
    sent = advanceLocalWorldSession(sent.session, sent.game, sent.session.world.marches[marchId].arriveAt, numbers());
    expect(sent.game.troops.army["1"]).toBe(8);
    sent = advanceLocalWorldSession(sent.session, sent.game, sent.session.world.marches[marchId].workUntil, numbers());
    sent = advanceLocalWorldSession(sent.session, sent.game, sent.session.world.marches[marchId].returnAt, numbers());
    expect(sent.game.troops.army["1"]).toBe(13);
  });

  it("recalls an outbound local march and returns its reserved troops", () => {
    const now = 1_800_000_000_000;
    const base = createLocalWorldSession("0xrecall-local", game("0xrecall-local", now), now, numbers());
    const node = Object.values(base.session.world.entities).find((entity) => entity.kind === "resource")!;
    let sent = dispatchLocalWorldMarch(base.session, base.game, {
      targetId: node.id, action: "gather", force: { army: { "1": 5 }, navy: {}, air: {} },
      idempotencyKey: "recall-local-1",
    }, now + 1000, numbers());
    const marchId = Object.keys(sent.session.world.marches)[0];
    // A UI click may still hold the pre-dispatch GameState for one frame.
    sent = recallLocalWorldMarch(sent.session, base.game, marchId, now + 2000, numbers());
    expect(sent.error).toBeUndefined();
    expect(sent.session.world.marches[marchId].state).toBe("returning");
    sent = advanceLocalWorldSession(sent.session, sent.game, sent.session.world.marches[marchId].returnAt, numbers());
    expect(sent.game.troops.army["1"]).toBe(10);
  });

  it("conserves troops through the GM-fill, dispatch and immediate-recall UI sequence", () => {
    const now = 1_800_000_000_000;
    const base = createLocalWorldSession("0xrecall-gm", game("0xrecall-gm", now, 0), now, numbers());
    let state = advanceLocalWorldSession(base.session, gmFillTroops(base.game, now + 100), now + 100, numbers());
    const initial = state.game.troops.army["1"];
    const node = Object.values(state.session.world.entities).find((entity) => entity.kind === "resource")!;
    state = dispatchLocalWorldMarch(state.session, state.game, {
      targetId: node.id, action: "gather", force: { army: { "1": initial }, navy: {}, air: {} },
      idempotencyKey: "recall-gm-1",
    }, now + 200, numbers());
    const marchId = Object.keys(state.session.world.marches)[0];
    state = recallLocalWorldMarch(state.session, state.game, marchId, now + 300, numbers());
    state = advanceLocalWorldSession(state.session, state.game, state.session.world.marches[marchId].returnAt, numbers());
    expect(state.game.troops.army["1"]).toBe(initial);
  });

  it("conserves a full-default GM fleet when recall is resolved by the GM finisher", () => {
    const now = 1_800_000_000_000;
    const source = initGame("0xrecall-defaults");
    source.lastTick = now;
    const base = createLocalWorldSession(source.address, source, now, defaults);
    let state = advanceLocalWorldSession(base.session, gmFillTroops(base.game, now + 100), now + 100, defaults);
    const initial = state.game.troops.army["1"];
    const node = Object.values(state.session.world.entities).find((entity) => entity.kind === "resource")!;
    state = dispatchLocalWorldMarch(state.session, state.game, {
      targetId: node.id, action: "gather", force: { army: { "1": initial }, navy: {}, air: {} },
      idempotencyKey: "recall-defaults-1",
    }, now + 200, defaults);
    const marchId = Object.keys(state.session.world.marches)[0];
    state = recallLocalWorldMarch(state.session, state.game, marchId, now + 300, defaults);
    state = finishLocalWorldMarches(state.session, state.game, now + 400, defaults);
    expect(state.game.troops.army["1"]).toBe(initial);
  });

  it("round-trips the new local save format", () => {
    const now = 1_800_000_000_000;
    const created = createLocalWorldSession("0xpersist", game("0xpersist", now), now, numbers());
    saveLocalWorldSession(created.session);
    expect(loadLocalWorldSession("0xpersist")).toEqual(created.session);
  });

  it("safely settles reserved troops from a legacy World before migrating", () => {
    const now = 1_800_000_000_000;
    const oldWorld = initLegacyWorld("0xlegacy", numbers());
    const oldGame = game("0xlegacy", now);
    const node = oldWorld.targets.find((target) => target.target.kind === "node")!;
    const dispatched = dispatchLegacy(oldWorld, oldGame, node.id, "gather", {
      troops: { army: { "1": 5 }, navy: {}, air: {} },
    }, now, numbers());
    expect(dispatched.game.troops.army["1"]).toBe(5);
    saveLegacyWorld(dispatched.world);
    const opened = openLocalWorldSession("0xlegacy", dispatched.game, now + 1, numbers());
    expect(opened.session.migratedLegacyAt).toBe(now + 1);
    expect(opened.game.troops.army["1"]).toBe(10);
    expect(loadLocalWorldSession("0xlegacy")).not.toBeNull();
  });
});
