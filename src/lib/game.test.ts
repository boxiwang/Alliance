import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  BUILDING_ORDER,
  GameState,
  missingTownhallPrerequisites,
  might,
  mightBreakdown,
  maxTroopsForType,
  project,
  startTrain,
  startUpgrade,
  totalTroops,
  troopStats,
} from "./game";
import { initGame, migrateGame } from "./gamestore";

describe("solo game progression", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-09-05T12:00:00Z"));
  });

  it("enforces Townhall prerequisites in game logic", () => {
    const game = richGame();
    game.buildings.keep.lvl = 2;

    const blocked = startUpgrade(game, "keep");
    expect(blocked.ok).toBe(false);
    expect(blocked.reason).toBe("Warehouse Lv.2 required");
    expect(missingTownhallPrerequisites(game, 3).map((item) => item.key)).toEqual(["storage", "bank"]);

    game.buildings.storage.lvl = 2;
    game.buildings.bank.lvl = 2;
    expect(startUpgrade(game, "keep").ok).toBe(true);
  });

  it("unlocks troop tiers from the matching training building, not Townhall", () => {
    const game = richGame();
    game.buildings.keep.lvl = 30;
    const locked = startTrain(game, "army", 2, 10);
    expect(locked.ok).toBe(false);
    expect(locked.reason).toBe("T2 requires Army Camp Lv.3");

    game.buildings.armyCamp.lvl = 3;
    const training = startTrain(game, "army", 2, 10);
    expect(training.ok).toBe(true);
    expect(training.state.training.army.tier).toBe(2);

    const finished = project(training.state, training.state.training.army.finishAt);
    expect(finished.troops.army["2"]).toBe(10);
    expect(totalTroops(finished)).toBe(10);
    expect(might(finished)).toBeGreaterThan(might(game));
  });

  it("migrates old numeric troop saves to T1 without losing progress", () => {
    const old = initGame("0xold") as any;
    old.troops = { army: 17, navy: 4, air: 2 };
    delete old.buildings.armyCamp;
    delete old.buildings.navalBase;
    delete old.buildings.airfield;
    delete old.training;
    old.buildings.barracks = { lvl: 7, finishAt: 0 };
    old.train = { type: "navy", qty: 3, per: 9, finishAt: 12345 };

    const migrated = migrateGame(old, "0xold");
    expect(migrated.troops.army["1"]).toBe(17);
    expect(migrated.troops.navy["1"]).toBe(4);
    expect(migrated.troops.air["1"]).toBe(2);
    expect(migrated.buildings.armyCamp.lvl).toBe(7);
    expect(migrated.buildings.navalBase.lvl).toBe(7);
    expect(migrated.buildings.airfield.lvl).toBe(7);
    expect(migrated.training.navy.tier).toBe(1);
    expect(migrated.training.navy.qty).toBe(3);
    expect(totalTroops(migrated)).toBe(23);
  });

  it("runs Army and Navy training in independent queues", () => {
    const game = richGame();
    game.buildings.navalBase.lvl = 1;

    const army = startTrain(game, "army", 1, 5);
    expect(army.ok).toBe(true);
    const navy = startTrain(army.state, "navy", 1, 5);
    expect(navy.ok).toBe(true);
    expect(navy.state.training.army.finishAt).toBeGreaterThan(Date.now());
    expect(navy.state.training.navy.finishAt).toBeGreaterThan(Date.now());
  });

  it("exposes all ten configured troop tiers", () => {
    for (let tier = 1; tier <= 10; tier += 1) {
      expect(troopStats("army", tier)?.tier).toBe(tier);
    }
  });

  it("targets a troop-heavy Might mix for a mature city", () => {
    const game = richGame();
    BUILDING_ORDER.forEach((key) => {
      if (key !== "milestone") game.buildings[key].lvl = 30;
    });
    for (const type of ["army", "navy", "air"] as const) {
      game.troops[type]["10"] = Math.round(maxTroopsForType(game, type) * 0.6);
    }

    const breakdown = mightBreakdown(game);
    const infrastructureShare = breakdown.infrastructure / breakdown.total;
    expect(infrastructureShare).toBeGreaterThanOrEqual(0.2);
    expect(infrastructureShare).toBeLessThanOrEqual(0.3);
  });
});

function richGame(): GameState {
  const game = initGame("0xtest");
  game.lastTick = Date.now();
  game.res = { cash: 5000, oil: 5000, power: 5000 };
  BUILDING_ORDER.forEach((key) => { game.buildings[key].finishAt = 0; });
  return game;
}
