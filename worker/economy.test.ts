import { describe, expect, it } from "vitest";
import { initGame } from "../src/lib/gamestore";
import { project } from "../src/lib/game";
import { gameStateBelongsToPlayer, projectGameJson } from "./economy";

// Step 0: prove the shared economy engine runs in a DOM-free (worker/node)
// environment — getN() must fall back to the bundled docs/numbers.json with no
// localStorage — and that projecting is deterministic and never regresses.
describe("shared economy engine runs headless", () => {
  it("initGame + project produce a sane state without a DOM", () => {
    const g = initGame("0x0000000000000000000000000000000000000abc");
    g.lastTick = 1_700_000_000_000;
    const later = project(g, g.lastTick + 3_600_000); // +1h
    expect(Number.isFinite(later.res.cash)).toBe(true);
    expect(Number.isFinite(later.res.oil)).toBe(true);
    expect(Number.isFinite(later.res.power)).toBe(true);
    // Production is never negative; the core level is unchanged by a plain tick.
    expect(later.res.cash).toBeGreaterThanOrEqual(g.res.cash);
    expect(later.buildings.keep.lvl).toBe(g.buildings.keep.lvl);
  });

  it("is deterministic at a fixed `now`", () => {
    const g = initGame("0x0000000000000000000000000000000000000abc");
    g.lastTick = 1_700_000_000_000;
    const now = g.lastTick + 1_800_000;
    expect(project(g, now).res.cash).toBe(project(g, now).res.cash);
  });

  it("projectGameJson round-trips a mirrored game_json string", () => {
    const g = initGame("0x0000000000000000000000000000000000000abc");
    g.lastTick = 1_700_000_000_000;
    const projected = projectGameJson(JSON.stringify(g), g.lastTick + 3_600_000);
    expect(projected).not.toBeNull();
    expect(Number.isFinite(projected!.res.cash)).toBe(true);
    expect(projectGameJson(null)).toBeNull();
    expect(projectGameJson("not json")).toBeNull();
  });

  it("binds a one-time authority seed to the authenticated player", () => {
    const game = initGame("0x0000000000000000000000000000000000000abc");
    expect(gameStateBelongsToPlayer(game, game.address.toUpperCase())).toBe(true);
    expect(gameStateBelongsToPlayer(game, "0x0000000000000000000000000000000000000def")).toBe(false);
    expect(gameStateBelongsToPlayer(null, game.address)).toBe(false);
  });
});
