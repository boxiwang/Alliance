import { describe, expect, it } from "vitest";
import {
  advanceHeadlessWorld, dispatchMarch, initHeadlessWorld, removeSimulatedCities, simulatedCityCount, spawnPlayers,
} from "./world-engine";

const raidForce = { army: {}, navy: {}, air: { "3": 500 } };

function world() {
  return spawnPlayers(initHeadlessWorld("sim-strip", 1000), [
    { id: "real", townhallLevel: 10, troops: raidForce },
    { id: "npc.0001", townhallLevel: 12, shieldDurationSec: 0 },
    { id: "npc.0002", townhallLevel: 8 },
    { id: "rival", townhallLevel: 9 },
  ], 1000);
}

describe("simulated rival cities (beta: real players only)", () => {
  it("removes npc.* players and cities but keeps real ones", () => {
    const source = world();
    const cleaned = removeSimulatedCities(source, 2000);
    expect(Object.keys(cleaned.players).sort()).toEqual(["real", "rival"]);
    expect(cleaned.entities[source.players["npc.0001"].cityId]).toBeUndefined();
    expect(cleaned.entities[source.players.rival.cityId]).toBeDefined();
    expect(source.players["npc.0001"]).toBeDefined(); // pure
    expect(removeSimulatedCities(cleaned, 3000)).toBe(cleaned); // no-op when clean
  });

  it("recalls a fleet flying at a removed city so no troops are lost", () => {
    const source = world();
    const sent = dispatchMarch(source, {
      playerId: "real", targetId: source.players["npc.0001"].cityId, action: "attack_city", force: raidForce, idempotencyKey: "raid",
    }, 2000);
    expect(sent.ok).toBe(true);
    if (!sent.ok) return;
    const cleaned = removeSimulatedCities(sent.world, 3000);
    const march = cleaned.marches[sent.march.id];
    expect(march.state).toBe("returning");
    const home = advanceHeadlessWorld(cleaned, march.returnAt + 1);
    expect(home.marches[sent.march.id].state).toBe("completed");
    expect(home.players.real.troops.air["3"]).toBe(500);
  });

  it("reads the configured count, defaulting to none", () => {
    expect(simulatedCityCount({})).toBe(0);
    expect(simulatedCityCount({ world: { population: { localNpcCities: 2.7 } } })).toBe(2);
  });
});
