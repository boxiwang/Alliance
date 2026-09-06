import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { initGame } from "./gamestore";
import { capacity, totalTroops } from "./game";
import {
  gmFillResources, gmFillTroops, gmFinishQueues, gmRaiseBuilding, gmRaiseTownhall, gmResetProgress,
  grantLocalGm, hasLocalGm, localGmAvailable, localGmRequested, revokeLocalGm,
} from "./gm";

describe("local GM tools", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-09-05T12:00:00Z"));
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("is unavailable without a local browser environment", () => {
    expect(localGmAvailable()).toBe(false);
  });

  it("grants and revokes the flag for one local wallet only", () => {
    const values = new Map<string, string>();
    vi.stubGlobal("window", { location: { hostname: "localhost", search: "?gm" } });
    vi.stubGlobal("localStorage", {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => values.set(key, value),
      removeItem: (key: string) => values.delete(key),
    });

    expect(localGmAvailable()).toBe(true);
    expect(localGmRequested()).toBe(true);
    expect(grantLocalGm("0xowner")).toBe(true);
    expect(hasLocalGm("0xowner")).toBe(true);
    expect(hasLocalGm("0xsomeoneelse")).toBe(false);
    revokeLocalGm("0xowner");
    expect(hasLocalGm("0xowner")).toBe(false);

  });

  it("fills all resources to the current Warehouse capacity", () => {
    const game = initGame("0xgm");
    game.res = { cash: 0, oil: 1, power: 2 };

    const filled = gmFillResources(game);
    expect(filled.res).toEqual({ cash: capacity(filled), oil: capacity(filled), power: capacity(filled) });
  });

  it("finishes active construction and training queues", () => {
    const game = initGame("0xgm");
    game.buildings.bank.finishAt = Date.now() + 60_000;
    game.training.army = { tier: 2, qty: 12, per: 5, finishAt: Date.now() + 60_000 };

    const finished = gmFinishQueues(game);
    expect(finished.buildings.bank.lvl).toBe(2);
    expect(finished.buildings.bank.finishAt).toBe(0);
    expect(finished.troops.army["2"]).toBe(12);
    expect(finished.training.army.finishAt).toBe(0);
  });

  it("fills each unlocked troop arm to its own capacity", () => {
    const game = initGame("0xgm");
    game.buildings.armyCamp.lvl = 3;
    game.buildings.navalBase.lvl = 2;
    game.buildings.airfield.lvl = 1;
    const filled = gmFillTroops(game);
    expect(totalTroops(filled)).toBeGreaterThan(0);
    expect(Object.values(filled.troops.army).reduce((sum, qty) => sum + qty, 0)).toBeGreaterThan(0);
    expect(Object.values(filled.troops.navy).reduce((sum, qty) => sum + qty, 0)).toBeGreaterThan(0);
    expect(Object.values(filled.troops.air).reduce((sum, qty) => sum + qty, 0)).toBeGreaterThan(0);
  });

  it("raises Townhall instantly but never beyond level 30", () => {
    const game = initGame("0xgm");
    expect(gmRaiseTownhall(game).buildings.keep.lvl).toBe(2);
    game.buildings.keep.lvl = 30;
    expect(gmRaiseTownhall(game).buildings.keep.lvl).toBe(30);
  });

  it("raises whichever building the GM selects", () => {
    const game = initGame("0xgm");
    expect(gmRaiseBuilding(game, "bank").buildings.bank.lvl).toBe(2);
    expect(gmRaiseBuilding(game, "airfield").buildings.airfield.lvl).toBe(1);
  });

  it("resets a city to a blank but playable Townhall level 1", () => {
    const game = initGame("0xgm");
    game.buildings.bank.lvl = 8;
    game.res.cash = 999;
    game.troops.army["1"] = 42;

    const reset = gmResetProgress(game.address);
    expect(reset.buildings.keep.lvl).toBe(1);
    expect(reset.buildings.bank.lvl).toBe(0);
    expect(reset.buildings.milestone.lvl).toBe(0);
    expect(reset.res).toEqual({ cash: 0, oil: 0, power: 0 });
    expect(totalTroops(reset)).toBe(0);
  });
});
