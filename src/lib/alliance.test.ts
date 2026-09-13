import { beforeEach, describe, expect, it } from "vitest";
import type { TokenHolding } from "./blockscout";
import type { Profile } from "./profile";
import {
  DEFAULT_ALLIANCE_ID, HELP_LIMIT, allianceForAddress, endorseCandidate, helpAll,
  foundAllianceFromToken, gmSeedAlliance, joinAlliance, leaveAlliance,
  loadAllianceDirectory, relationshipBetween, requestAllianceHelp,
} from "./alliance";
import { initGame, loadGame, saveGame } from "./gamestore";

class MemoryStorage {
  private values = new Map<string, string>();
  getItem(key: string) { return this.values.get(key) ?? null; }
  setItem(key: string, value: string) { this.values.set(key, value); }
  removeItem(key: string) { this.values.delete(key); }
  clear() { this.values.clear(); }
  key(index: number) { return [...this.values.keys()][index] ?? null; }
  get length() { return this.values.size; }
}

function profile(index: number): Profile {
  return { address: `0x${String(index).padStart(40, "0")}`, name: `Signal-${index}`, faction: null, factionSymbol: null, keepLevel: 1, createdAt: new Date(0).toISOString(), renamedOnce: false };
}

const token: TokenHolding = { address: "0x1111111111111111111111111111111111111111", name: "Orbit Test", symbol: "ORBT", decimals: 18, raw: "1000000000000000000", type: "ERC-20", exchangeRate: null, marketCap: null, iconUrl: null, reputation: null };

beforeEach(() => { Object.assign(globalThis, { localStorage: new MemoryStorage() }); });

describe("alliance core rules", () => {
  it("keeps the default chapter open without a wallet token", () => {
    const result = joinAlliance(DEFAULT_ALLIANCE_ID, profile(1), 1000);
    expect(result.ok).toBe(true);
    expect(allianceForAddress(profile(1).address)?.symbol).toBe("GACO");
    expect(result.alliance?.members.some((member) => member.rank === "R5")).toBe(true);
  });

  it("registers each token contract only once", () => {
    expect(foundAllianceFromToken(token, profile(1), 1000).ok).toBe(true);
    const second = foundAllianceFromToken(token, profile(2), 1001);
    expect(second.ok).toBe(false);
    expect(second.reason).toMatch(/registered chapter/i);
  });

  it("requires six founders and five distinct endorsements to activate", () => {
    const founded = foundAllianceFromToken(token, profile(1), 1000).alliance!;
    gmSeedAlliance(founded.id, 6);
    for (let index = 2; index <= 6; index += 1) {
      const alliance = loadAllianceDirectory().alliances.find((candidate) => candidate.id === founded.id)!;
      endorseCandidate(founded.id, alliance.members[index - 1].address, profile(1).address);
    }
    const active = loadAllianceDirectory().alliances.find((candidate) => candidate.id === founded.id)!;
    expect(active.members.length).toBeGreaterThanOrEqual(6);
    expect(new Set(active.endorsements[profile(1).address]).size).toBe(5);
    expect(active.status).toBe("active");
    expect(active.members.find((member) => member.address === profile(1).address)?.rank).toBe("R5");
  });

  it("applies a 24-hour jump lock after withdrawal", () => {
    joinAlliance(DEFAULT_ALLIANCE_ID, profile(1), 1000);
    expect(leaveAlliance(profile(1), 2000).ok).toBe(true);
    expect(joinAlliance(DEFAULT_ALLIANCE_ID, profile(1), 2001).ok).toBe(false);
  });

  it("uses the stated diplomacy priority", () => {
    const directory = loadAllianceDirectory();
    const gaco = directory.alliances.find((alliance) => alliance.id === DEFAULT_ALLIANCE_ID)!;
    gaco.napAllianceIds.push("green"); gaco.warAllianceIds.push("red");
    expect(relationshipBetween(gaco.id, gaco.id, false, directory)).toBe("ally");
    expect(relationshipBetween(gaco.id, "red", false, directory)).toBe("war");
    expect(relationshipBetween(gaco.id, "green", false, directory)).toBe("nap");
    expect(relationshipBetween(gaco.id, null, false, directory)).toBe("neutral");
    expect(HELP_LIMIT).toBe(25);
  });

  it("connects one-tap help to a real city timer and rewards the helper once", () => {
    const owner = profile(1); const helper = profile(2); const now = 200_000_000;
    joinAlliance(DEFAULT_ALLIANCE_ID, owner, now - 86400000);
    joinAlliance(DEFAULT_ALLIANCE_ID, helper, now - 86400000);
    const game = initGame(owner.address); game.buildings.bank.finishAt = now + 30 * 60 * 1000; game.buildings.bank.durationSec = 1800; saveGame(game);
    const request = requestAllianceHelp(owner, "building", "bank", "Bank LV.2", now);
    expect(request.ok, request.reason).toBe(true);
    const result = helpAll(helper, now);
    expect(result).toMatchObject({ helped: 1, rewarded: 1, secondsRemoved: 300 });
    expect(loadGame(owner.address)!.buildings.bank.finishAt).toBe(now + 25 * 60 * 1000);
    expect(helpAll(helper, now + 1).helped).toBe(0);
    const member = allianceForAddress(helper.address)!.members.find((candidate) => candidate.address === helper.address)!;
    expect(member.contribution).toBe(1);
    expect(member.credits).toBe(2);
  });
});
