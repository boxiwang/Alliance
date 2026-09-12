import { describe, expect, it } from "vitest";
import type { HeadlessWorld, WorldReport } from "./lib/world-engine";
import { resolveStrikeArrival, strikeVisibleAtZoom } from "./WorldStrikeLayer";

function fixture(signature: "whalefall-protocol" | null = "whalefall-protocol") {
  const report = {
    id: "report.arrival", playerId: "attacker", marchId: "march.1", targetId: "target.1",
    action: "attack_city", stage: "arrival", outcome: "victory", createdAt: 1000, payload: {},
  } as WorldReport;
  const world = {
    reports: { [report.id]: report },
    marches: { "march.1": { id: "march.1", playerId: "attacker" } },
    entities: { "target.1": { id: "target.1", kind: "city", position: { x: 97, y: 339 } } },
    players: { attacker: { cosmetics: { strikeSignature: signature } } },
  } as unknown as HeadlessWorld;
  return { world, report };
}

describe("World strike arrivals", () => {
  it("resolves an attack arrival from the attacker's equipped public imprint", () => {
    const { world, report } = fixture();
    expect(resolveStrikeArrival(world, report)).toEqual({
      signature: "whalefall-protocol", position: { x: 97, y: 339 }, targetKind: "city",
    });
  });

  it("does not invent an effect for unbound commanders or non-combat reports", () => {
    const unbound = fixture(null);
    expect(resolveStrikeArrival(unbound.world, unbound.report)).toBeNull();
    const scout = { ...fixture().report, action: "scout" } as WorldReport;
    expect(resolveStrikeArrival(fixture().world, scout)).toBeNull();
  });

  it("keeps player-city impacts hidden until Tactical view without hiding Rogue impacts", () => {
    expect(strikeVisibleAtZoom("city", 2.99)).toBe(false);
    expect(strikeVisibleAtZoom("city", 3)).toBe(true);
    expect(strikeVisibleAtZoom("monster", 1.8)).toBe(true);
    expect(strikeVisibleAtZoom("demo", 1.8)).toBe(true);
  });
});
