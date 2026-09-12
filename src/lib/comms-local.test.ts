import { beforeEach, describe, expect, it } from "vitest";
import { appendLocalCommsMessage, loadLocalComms, refreshLocalCommsIntel, saveLocalComms } from "./comms-local";

beforeEach(() => {
  const storage = new Map<string, string>();
  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    value: {
      getItem: (key: string) => storage.get(key) ?? null,
      setItem: (key: string, value: string) => storage.set(key, value),
    },
  });
});

describe("local comms adapter", () => {
  it("shares quick replies with the full comms store", () => {
    appendLocalCommsMessage("0xPilot", "general", { id: "quick.1", b: "Holding the east arc.", own: true });
    expect(loadLocalComms("0xpilot").general).toEqual([{ id: "quick.1", b: "Holding the east arc.", own: true }]);
  });

  it("repairs a relayed recon card from its migrated world report", () => {
    saveLocalComms("0xPilot", { general: [{
      b: "Recon relayed.",
      intel: {
        kind: "scout-intel", id: "share.1", reportId: "report.1", targetId: "city.npc.0001",
        targetName: "CHAIN GHOST · 34", targetLevel: 9, targetKind: "city", position: { x: 97, y: 339 },
        createdAt: 1, expiresAt: 3_600_001, snapshot: { might: 6720 },
      },
    }] });
    const world = { reports: { "report.1": { payload: { snapshot: { might: 6_720_000 } } } } } as any;
    const repaired = refreshLocalCommsIntel("0xPilot", world);
    expect(repaired.general[0].intel?.kind === "scout-intel" ? repaired.general[0].intel.snapshot.might : 0).toBe(6_720_000);
  });
});
