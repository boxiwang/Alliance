import { beforeEach, describe, expect, it } from "vitest";
import { clearQueuedCommsShare, createCoordinateShare, createScoutIntelShare, loadQueuedCommsShare, queueCommsShare, queueWorldFocus, sharedIntelIsActive, takeWorldFocus } from "./shared-intel";
import type { WorldReport } from "./world-engine";

describe("shared world intelligence", () => {
  beforeEach(() => {
    const values = new Map<string, string>();
    Object.defineProperty(globalThis, "localStorage", {
      configurable: true,
      value: {
        getItem: (key: string) => values.get(key) ?? null,
        setItem: (key: string, value: string) => values.set(key, value),
        removeItem: (key: string) => values.delete(key),
      },
    });
  });

  it("keeps coordinates durable while scout payloads decay at their original deadline", () => {
    const target = { id: "city-7", name: "MOONCAT · 07", level: 12, kind: "city" as const, position: { x: 249, y: 21 } };
    const coordinate = createCoordinateShare(target, 1000);
    const report: WorldReport = {
      id: "report-1", playerId: "me", marchId: "march-1", targetId: target.id,
      action: "scout", stage: "arrival", outcome: "scouted", createdAt: 2000,
      payload: { snapshot: { might: 99 }, intelExpiresAt: 5000 },
    };
    const intel = createScoutIntelShare(target, report);
    expect(sharedIntelIsActive(coordinate, Number.MAX_SAFE_INTEGER)).toBe(true);
    expect(sharedIntelIsActive(intel, 4999)).toBe(true);
    expect(sharedIntelIsActive(intel, 5000)).toBe(false);
    expect(intel.snapshot.might).toBe(99);
    expect(intel.targetKind).toBe("city");
  });

  it("labels resource and Rogue coordinate relays without giving them expiring recon", () => {
    const resource = createCoordinateShare({ id: "resource-2", name: "OIL PLANET · L2", level: 2, kind: "resource", position: { x: 12, y: 13 } }, 1000);
    const rogue = createCoordinateShare({ id: "rogue-8", name: "ROGUE · L8", level: 8, kind: "monster", position: { x: 21, y: 34 } }, 1000);
    expect(resource.targetKind).toBe("resource");
    expect(rogue.targetKind).toBe("monster");
    expect(sharedIntelIsActive(resource, Number.MAX_SAFE_INTEGER)).toBe(true);
    expect(sharedIntelIsActive(rogue, Number.MAX_SAFE_INTEGER)).toBe(true);
  });

  it("moves a pending attachment into Comms and a target focus back into the Star Map", () => {
    const share = createCoordinateShare({ id: "city-9", name: "VOIDRUNNER", level: 9, position: { x: 7, y: 8 } }, 1000);
    queueCommsShare("0xABC", share);
    expect(loadQueuedCommsShare("0xabc")).toEqual(share);
    clearQueuedCommsShare("0xabc");
    expect(loadQueuedCommsShare("0xabc")).toBeNull();

    queueWorldFocus("0xABC", share.targetId, share.position, 2000);
    expect(takeWorldFocus("0xabc")).toEqual({ targetId: "city-9", position: { x: 7, y: 8 }, requestedAt: 2000 });
    expect(takeWorldFocus("0xabc")).toBeNull();
  });
});
