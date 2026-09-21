import { describe, expect, it } from "vitest";
import defaults from "../../docs/numbers.json";
import { initGame } from "./gamestore";
import { createLocalWorldSession } from "./world-adapter";
import { applyWorldAuthorityCommand, isWorldAuthoritySession } from "./world-authority";

function setup() {
  const now = 1_800_000_000_000;
  const numbers: any = structuredClone(defaults);
  numbers.world.population.localNpcCities = 2;
  numbers.world.population.minimumResourceFields = 2;
  numbers.world.population.minimumMonsters = 2;
  numbers.world.population.resourceFieldsPerPlayer = 0;
  numbers.world.population.monstersPerPlayer = 0;
  const game = initGame("0xserver-world");
  game.lastTick = now;
  game.troops.army["1"] = 50;
  return { now, numbers, ...createLocalWorldSession(game.address, game, now, numbers) };
}

describe("server World authority", () => {
  it("accepts a matching migrated session and rejects another player", () => {
    const base = setup();
    expect(isWorldAuthoritySession(base.session, base.session.playerId)).toBe(true);
    expect(isWorldAuthoritySession(base.session, "0xother")).toBe(false);
  });

  it("dispatches and advances a march without minting or losing the reserved force", () => {
    const base = setup();
    const target = Object.values(base.session.world.entities).find((entity) => entity.kind === "resource");
    expect(target).toBeTruthy();
    const sent = applyWorldAuthorityCommand(base.session, base.game, {
      type: "world.dispatch",
      args: { targetId: target!.id, action: "gather", force: { army: { "1": 10 } }, dispatchKey: "dispatch:test:1" },
    }, base.now + 1, base.numbers);
    expect(sent.ok).toBe(true);
    expect(sent.game.troops.army["1"]).toBe(40);
    const march = Object.values(sent.session.world.marches)[0];
    const arrived = applyWorldAuthorityCommand(sent.session, sent.game, { type: "world.advance", args: {} }, march.arriveAt, base.numbers);
    const gathering = arrived.session.world.marches[march.id];
    const loaded = applyWorldAuthorityCommand(arrived.session, arrived.game, { type: "world.advance", args: {} }, gathering.workUntil, base.numbers);
    const returning = loaded.session.world.marches[march.id];
    const returned = applyWorldAuthorityCommand(loaded.session, loaded.game, { type: "world.advance", args: {} }, returning.returnAt, base.numbers);
    expect(returned.game.troops.army["1"]).toBe(50);
  });
});
