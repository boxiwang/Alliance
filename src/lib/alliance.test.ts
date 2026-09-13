import { beforeEach, describe, expect, it } from "vitest";
import type { TokenHolding } from "./blockscout";
import type { Profile } from "./profile";
import {
  DEFAULT_ALLIANCE_ID, HELP_LIMIT, allianceForAddress, allianceGameplayBonuses, availableAlliances, endorseCandidate, gmPrepareAlliance, helpAll,
  castLeadershipVote, foundAllianceFromToken, gmCompleteLeadershipChallenge, gmSeedAlliance, initiateLeadershipChallenge, joinAlliance, leaveAlliance,
  loadAllianceDirectory, relationshipBetween, requestAllianceEntry, requestAllianceHelp,
  resolveLeadershipChallenges, reviewAllianceApplication, reviewAllianceNap, setAllianceDiplomacy, setAllianceMemberRank, updateAllianceStandards,
  upgradeAllianceSkill, verifyAllianceHolding,
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

  it("does not let command token-gate the default chapter", () => {
    const member = profile(1);
    joinAlliance(DEFAULT_ALLIANCE_ID, member, 1000);
    gmPrepareAlliance(DEFAULT_ALLIANCE_ID, member.address);
    expect(updateAllianceStandards(DEFAULT_ALLIANCE_ID, member.address, { minHoldingAmount: "999", joinPolicy: "application" }).ok).toBe(false);
    const accord = allianceForAddress(member.address)!;
    expect(accord.minHoldingAmount).toBe("0");
    expect(accord.joinPolicy).toBe("open");
    expect(requestAllianceEntry(DEFAULT_ALLIANCE_ID, profile(2), [], 2000).ok).toBe(true);
  });

  it("registers each token contract only once", () => {
    expect(foundAllianceFromToken(token, profile(1), 1000).ok).toBe(true);
    const second = foundAllianceFromToken(token, profile(2), 1001);
    expect(second.ok).toBe(false);
    expect(second.reason).toMatch(/already exists/i);
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

  it("lets GM skip the 24-hour alliance switch lock", () => {
    joinAlliance(DEFAULT_ALLIANCE_ID, profile(1), 1000);
    expect(leaveAlliance(profile(1), 2000, true).ok).toBe(true);
    expect(joinAlliance(DEFAULT_ALLIANCE_ID, profile(1), 2001, true).ok).toBe(true);
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

  it("lets command review recruits, set R4 and publish diplomacy", () => {
    const founder = profile(1); const recruit = profile(2);
    const founded = foundAllianceFromToken(token, founder, 1000).alliance!;
    gmPrepareAlliance(founded.id, founder.address);
    const petition = requestAllianceEntry(founded.id, recruit, [token], 2000);
    expect(petition).toMatchObject({ ok: true, applied: true });
    expect(reviewAllianceApplication(founded.id, founder.address, recruit.address, true, 3000).ok).toBe(true);
    expect(allianceForAddress(recruit.address)?.id).toBe(founded.id);
    expect(setAllianceMemberRank(founded.id, founder.address, recruit.address, "R4").ok).toBe(true);
    expect(updateAllianceStandards(founded.id, founder.address, { minHoldingAmount: "100", joinPolicy: "application" }).ok).toBe(true);
    expect(setAllianceDiplomacy(founded.id, founder.address, "sim-orbt", "nap").ok).toBe(true);
    const directory = loadAllianceDirectory();
    const rival = directory.alliances.find((alliance) => alliance.id === "sim-orbt")!;
    const request = directory.alliances.find((alliance) => alliance.id === founded.id)!.diplomacyRequests[0];
    expect(reviewAllianceNap(rival.id, rival.members[0].address, request.id, true).ok).toBe(true);
    const updated = allianceForAddress(founder.address)!;
    expect(updated.members.find((member) => member.address === recruit.address)?.rank).toBe("R4");
    expect(updated.minHoldingDisplay).toBe("Hold 100 ORBT");
    expect(updated.napAllianceIds).toContain("sim-orbt");
  });

  it("enforces the R5 token threshold on discovery and login", () => {
    const founder = profile(1);
    const founded = foundAllianceFromToken(token, founder, 1000).alliance!;
    gmPrepareAlliance(founded.id, founder.address);
    expect(updateAllianceStandards(founded.id, founder.address, { minHoldingAmount: "2" }).ok).toBe(true);
    expect(availableAlliances([token]).some((alliance) => alliance.id === founded.id)).toBe(false);
    expect(verifyAllianceHolding(founder, [token], 2000).status).toBe("suspended");
  });

  it("turns doctrine levels into active gameplay modifiers", () => {
    const member = profile(1);
    joinAlliance(DEFAULT_ALLIANCE_ID, member, 1000);
    gmPrepareAlliance(DEFAULT_ALLIANCE_ID, member.address);
    expect(upgradeAllianceSkill(DEFAULT_ALLIANCE_ID, member.address, "warfare").ok).toBe(true);
    const bonuses = allianceGameplayBonuses(member.address);
    expect(bonuses.constructionSpeedBonus).toBe(.01);
    expect(bonuses.healingSpeedBonus).toBe(.01);
    expect(bonuses.marchSpeedBonus).toBe(.01);
    expect(bonuses.marchCapacityBonus).toBe(.01);
  });

  it("runs a 48-hour leadership ballot with a seven-day challenge lock", () => {
    const initiator = profile(1);
    joinAlliance(DEFAULT_ALLIANCE_ID, initiator, 1000);
    const alliance = gmPrepareAlliance(DEFAULT_ALLIANCE_ID, initiator.address)!;
    const now = Date.now();
    const candidate = alliance.members.find((member) => member.address !== initiator.address)!;
    const opened = initiateLeadershipChallenge(initiator, candidate.address, now);
    expect(opened.ok).toBe(true);
    expect(opened.challenge?.closesAt).toBe(now + 48 * 60 * 60 * 1000);
    expect(initiateLeadershipChallenge(initiator, candidate.address, now + 1).ok).toBe(false);
    const voters = opened.challenge!.eligibleAddresses.slice(0, Math.ceil(opened.challenge!.eligibleAddresses.length * .4));
    voters.forEach((address) => expect(castLeadershipVote(DEFAULT_ALLIANCE_ID, address, candidate.address, now + 1000).ok).toBe(true));
    resolveLeadershipChallenges(opened.challenge!.closesAt + 1);
    expect(allianceForAddress(initiator.address)!.members.find((member) => member.address === candidate.address)?.rank).toBe("R5");
  });

  it("lets GM start and complete a leadership vote without waiting", () => {
    const initiator = profile(1);
    joinAlliance(DEFAULT_ALLIANCE_ID, initiator, Date.now());
    const alliance = gmPrepareAlliance(DEFAULT_ALLIANCE_ID, initiator.address)!;
    const candidate = alliance.members.find((member) => member.address !== initiator.address)!;
    const opened = initiateLeadershipChallenge(initiator, candidate.address, Date.now(), true);
    expect(opened.ok).toBe(true);
    expect(gmCompleteLeadershipChallenge(DEFAULT_ALLIANCE_ID).ok).toBe(true);
    expect(allianceForAddress(initiator.address)!.members.find((member) => member.address === candidate.address)?.rank).toBe("R5");
  });
});
