import type { TokenHolding } from "./blockscout";
import type { Profile } from "./profile";
import { loadGame, saveGame } from "./gamestore";

export const DEFAULT_ALLIANCE_ID = "gaco-001";
export const ALLIANCE_SWITCH_COOLDOWN_MS = 24 * 60 * 60 * 1000;
export const ALLIANCE_HOLDING_GRACE_MS = 48 * 60 * 60 * 1000;
export const LEADERSHIP_CHALLENGE_COOLDOWN_MS = 7 * 24 * 60 * 60 * 1000;
export const LEADERSHIP_BALLOT_MS = 48 * 60 * 60 * 1000;
export const HELP_REDUCTION_MS = 5 * 60 * 1000;
export const HELP_LIMIT = 25;
export const HELP_REWARD_DAILY_LIMIT = 50;

export type AllianceRank = "R1" | "R2" | "R3" | "R4" | "R5";
export type AllianceStatus = "forming" | "active";
export type HoldingStatus = "verified" | "suspended";
export type AllianceRelation = "self" | "ally" | "nap" | "war" | "neutral";

export interface AllianceMember {
  address: string;
  name: string;
  rank: AllianceRank;
  joinedAt: number;
  holdingStatus: HoldingStatus;
  holdingFailedAt?: number;
  contribution: number;
  credits: number;
  lastActiveAt: number;
}

export interface AllianceDecree {
  id: string;
  title: string;
  body: string;
  createdAt: number;
  author: string;
}

export interface AllianceApplication {
  address: string;
  name: string;
  appliedAt: number;
  holdingDisplay: string;
  status: "pending" | "approved" | "rejected";
  reviewedBy?: string;
  reviewedAt?: number;
}

export interface AllianceDiplomacyRequest {
  id: string;
  fromAllianceId: string;
  toAllianceId: string;
  createdAt: number;
  createdBy: string;
  status: "pending" | "accepted" | "rejected" | "withdrawn";
  reviewedAt?: number;
  reviewedBy?: string;
}

export interface AllianceHelpRequest {
  id: string;
  allianceId: string;
  ownerAddress: string;
  ownerName: string;
  kind: "building" | "healing";
  targetKey: string;
  label: string;
  createdAt: number;
  helpers: string[];
  closedAt?: number;
}

export interface LeadershipChallenge {
  id: string;
  initiatorAddress: string;
  initiatorName: string;
  candidateAddress: string;
  candidateName: string;
  createdAt: number;
  closesAt: number;
  eligibleAddresses: string[];
  votes: Record<string, string>;
  resolvedAt?: number;
  winnerAddress?: string;
}

export interface AllianceRecord {
  id: string;
  kind: "default" | "token";
  status: AllianceStatus;
  name: string;
  symbol: string;
  chapter: number;
  color: string;
  iconUrl?: string | null;
  contractAddress?: string | null;
  tokenDecimals: number;
  minHoldingAmount: string;
  minHoldingDisplay: string;
  activeStandard: string;
  joinPolicy: "open" | "application";
  applications: AllianceApplication[];
  maxMembers: number;
  rules: string[];
  napAllianceIds: string[];
  warAllianceIds: string[];
  diplomacyRequests: AllianceDiplomacyRequest[];
  members: AllianceMember[];
  endorsements: Record<string, string[]>;
  decrees: AllianceDecree[];
  helps: AllianceHelpRequest[];
  skillLevels: Record<"growth" | "warfare" | "mutualAid", number>;
  skillPoints: number;
  lastChallengeAt?: number;
  challenges: LeadershipChallenge[];
  createdAt: number;
}

interface AllianceDirectory { version: 1; nextChapter: number; alliances: AllianceRecord[]; switchLocks: Record<string, number>; }

const DIRECTORY_KEY = "ruglands:alliances:v1";
export const ALLIANCE_CHANGED_EVENT = "ruglands:alliance-changed";

function seedDirectory(now = Date.now()): AllianceDirectory {
  return {
    version: 1,
    nextChapter: 2,
    switchLocks: {},
    alliances: [{
      id: DEFAULT_ALLIANCE_ID,
      kind: "default",
      status: "active",
      name: "Galactic Accord",
      symbol: "GACO",
      chapter: 1,
      color: "#6ed9ff",
      contractAddress: null,
      tokenDecimals: 0,
      minHoldingAmount: "0",
      minHoldingDisplay: "No token required",
      activeStandard: "Log in at least once every 72 hours",
      joinPolicy: "open",
      applications: [],
      maxMembers: 100,
      rules: ["Do not attack alliance members.", "Do not attack NAP alliances.", "Join alliance rallies when available."],
      napAllianceIds: [],
      warAllianceIds: [],
      diplomacyRequests: [],
      members: accordStewards(now),
      endorsements: {},
      decrees: [{ id: "gaco-first-light", title: "WELCOME TO GACO", body: "GACO is open to every player. No token is required to join.", createdAt: now - 86400000, author: "GACO" }],
      helps: [],
      skillLevels: { growth: 1, warfare: 0, mutualAid: 1 },
      skillPoints: 2,
      challenges: [],
      createdAt: now - 7 * 86400000,
    }],
  };
}

function accordStewards(now: number): AllianceMember[] {
  return [
    ["0x00000000000000000000000000000000gaco0001", "Aster Relay", "R5"],
    ["0x00000000000000000000000000000000gaco0002", "Nyx Cartographer", "R4"],
    ["0x00000000000000000000000000000000gaco0003", "Kepler Ward", "R4"],
    ["0x00000000000000000000000000000000gaco0004", "Iona Signal", "R3"],
    ["0x00000000000000000000000000000000gaco0005", "Vale-7", "R2"],
  ].map(([address, name, rank], index) => ({ address, name, rank: rank as AllianceRank, joinedAt: now - (20 - index) * 86400000, holdingStatus: "verified", contribution: 5200 - index * 610, credits: 880 - index * 75, lastActiveAt: now - index * 420000 }));
}

function safeStorage(): Storage | null { try { return typeof localStorage === "undefined" ? null : localStorage; } catch { return null; } }
function normalizeAddress(address: string): string { return address.toLowerCase(); }
function emitChanged() { try { window.dispatchEvent(new CustomEvent(ALLIANCE_CHANGED_EVENT)); } catch {} }

export function loadAllianceDirectory(): AllianceDirectory {
  const storage = safeStorage();
  if (!storage) return seedDirectory();
  try {
    const raw = storage.getItem(DIRECTORY_KEY);
    if (!raw) { const seeded = seedDirectory(); storage.setItem(DIRECTORY_KEY, JSON.stringify(seeded)); return seeded; }
    const parsed = JSON.parse(raw) as AllianceDirectory;
    if (!(parsed?.version === 1 && Array.isArray(parsed.alliances))) return seedDirectory();
    parsed.alliances.forEach((alliance) => {
      alliance.joinPolicy ??= alliance.kind === "default" ? "open" : "application";
      alliance.applications ??= [];
      alliance.maxMembers ??= 100;
      alliance.tokenDecimals ??= 18;
      alliance.minHoldingAmount ??= alliance.kind === "default" ? "0" : "1";
      alliance.diplomacyRequests ??= [];
      alliance.warAllianceIds ??= [];
      alliance.napAllianceIds ??= [];
      if (alliance.activeStandard === "Signal once every 72 hours") alliance.activeStandard = "Log in at least once every 72 hours";
      if (alliance.activeStandard === "Signal once every 48 hours") alliance.activeStandard = "Log in at least once every 48 hours";
    });
    const accord = parsed.alliances.find((alliance) => alliance.id === DEFAULT_ALLIANCE_ID);
    if (accord) {
      accord.minHoldingDisplay = "No token required";
      accord.rules = ["Do not attack alliance members.", "Do not attack NAP alliances.", "Join alliance rallies when available."];
      const welcome = accord.decrees.find((decree) => decree.id === "gaco-first-light");
      if (welcome) Object.assign(welcome, { title: "WELCOME TO GACO", body: "GACO is open to every player. No token is required to join.", author: "GACO" });
    }
    if (accord && !accord.members.some((member) => member.rank === "R5")) {
      const existing = new Set(accord.members.map((member) => normalizeAddress(member.address)));
      accord.members.unshift(...accordStewards(Date.now()).filter((member) => !existing.has(normalizeAddress(member.address))));
    }
    storage.setItem(DIRECTORY_KEY, JSON.stringify(parsed));
    return parsed;
  } catch { return seedDirectory(); }
}

export function saveAllianceDirectory(directory: AllianceDirectory) {
  try { safeStorage()?.setItem(DIRECTORY_KEY, JSON.stringify(directory)); emitChanged(); } catch {}
}

export function allianceForAddress(address: string, directory = loadAllianceDirectory()): AllianceRecord | null {
  const normalized = normalizeAddress(address);
  return directory.alliances.find((alliance) => alliance.members.some((member) => normalizeAddress(member.address) === normalized)) ?? null;
}

export function allianceById(id: string | null | undefined, directory = loadAllianceDirectory()): AllianceRecord | null {
  return id ? directory.alliances.find((alliance) => alliance.id === id) ?? null : null;
}

export function availableAlliances(holdings: TokenHolding[], directory = loadAllianceDirectory(), gm = false): AllianceRecord[] {
  return directory.alliances.filter((alliance) => gm || alliance.kind === "default" || holdingMeetsAllianceThreshold(alliance, holdings));
}

function decimalAmountToRaw(value: string, decimals: number): bigint {
  const safe = value.trim();
  if (!/^\d+(\.\d+)?$/.test(safe)) return 0n;
  const [whole, fraction = ""] = safe.split(".");
  const padded = fraction.slice(0, decimals).padEnd(decimals, "0");
  try { return BigInt(whole) * 10n ** BigInt(decimals) + BigInt(padded || "0"); } catch { return 0n; }
}

export function holdingMeetsAllianceThreshold(alliance: AllianceRecord, holdings: TokenHolding[]): boolean {
  if (alliance.kind === "default") return true;
  const holding = holdings.find((token) => alliance.contractAddress && normalizeAddress(token.address) === normalizeAddress(alliance.contractAddress));
  if (!holding) return false;
  try { return BigInt(holding.raw || "0") >= decimalAmountToRaw(alliance.minHoldingAmount || "1", alliance.tokenDecimals ?? holding.decimals); } catch { return false; }
}

export function tokenAllianceForHolding(token: TokenHolding, directory = loadAllianceDirectory()): AllianceRecord | null {
  return directory.alliances.find((alliance) => alliance.contractAddress && normalizeAddress(alliance.contractAddress) === normalizeAddress(token.address)) ?? null;
}

function memberFrom(profile: Profile, now: number): AllianceMember {
  return { address: profile.address, name: profile.name, rank: "R1", joinedAt: now, holdingStatus: "verified", contribution: 0, credits: 0, lastActiveAt: now };
}

export function joinAlliance(allianceId: string, profile: Profile, now = Date.now(), gm = false): { ok: boolean; reason?: string; alliance?: AllianceRecord } {
  const directory = loadAllianceDirectory();
  const address = normalizeAddress(profile.address);
  const current = allianceForAddress(address, directory);
  if (current?.id === allianceId) return { ok: true, alliance: current };
  if (current) return { ok: false, reason: "Leave your current alliance first." };
  if (!gm && (directory.switchLocks[address] ?? 0) > now) return { ok: false, reason: "You must wait 24 hours before joining another alliance." };
  const alliance = directory.alliances.find((candidate) => candidate.id === allianceId);
  if (!alliance) return { ok: false, reason: "Alliance not found." };
  if (alliance.members.length >= alliance.maxMembers) return { ok: false, reason: "This alliance is full." };
  alliance.members.push(memberFrom(profile, now));
  saveAllianceDirectory(directory);
  return { ok: true, alliance };
}

export function requestAllianceEntry(allianceId: string, profile: Profile, holdings: TokenHolding[] = [], now = Date.now(), gm = false): { ok: boolean; applied?: boolean; reason?: string; alliance?: AllianceRecord } {
  const directory = loadAllianceDirectory(); const alliance = allianceById(allianceId, directory);
  if (!alliance) return { ok: false, reason: "Alliance not found." };
  if (!gm && !holdingMeetsAllianceThreshold(alliance, holdings)) return { ok: false, reason: `You need at least ${alliance.minHoldingAmount} ${alliance.symbol} to apply.` };
  if (gm || alliance.kind === "default" || alliance.status === "forming" || alliance.joinPolicy === "open") return joinAlliance(allianceId, profile, now, gm);
  if (allianceForAddress(profile.address, directory)) return { ok: false, reason: "Leave your current alliance first." };
  const address = normalizeAddress(profile.address);
  if (!gm && (directory.switchLocks[address] ?? 0) > now) return { ok: false, reason: "You must wait 24 hours before joining another alliance." };
  const prior = alliance.applications.find((application) => normalizeAddress(application.address) === address && application.status === "pending");
  if (prior) return { ok: true, applied: true, alliance };
  const holding = holdings.find((token) => alliance.contractAddress && normalizeAddress(token.address) === normalizeAddress(alliance.contractAddress));
  alliance.applications.unshift({ address: profile.address, name: profile.name, appliedAt: now, holdingDisplay: holding ? `${alliance.minHoldingAmount}+ ${alliance.symbol} verified` : "No token required", status: "pending" });
  saveAllianceDirectory(directory); return { ok: true, applied: true, alliance };
}

function commandMember(alliance: AllianceRecord, address: string): AllianceMember | null {
  const member = alliance.members.find((candidate) => normalizeAddress(candidate.address) === normalizeAddress(address));
  return member && (member.rank === "R4" || member.rank === "R5") ? member : null;
}

export function reviewAllianceApplication(allianceId: string, actorAddress: string, applicantAddress: string, approve: boolean, now = Date.now()): { ok: boolean; reason?: string } {
  const directory = loadAllianceDirectory(); const alliance = allianceById(allianceId, directory);
  if (!alliance || !commandMember(alliance, actorAddress)) return { ok: false, reason: "Only R4 and R5 members can review applications." };
  const application = alliance.applications.find((candidate) => normalizeAddress(candidate.address) === normalizeAddress(applicantAddress) && candidate.status === "pending");
  if (!application) return { ok: false, reason: "This application is no longer pending." };
  if (approve && alliance.members.length >= alliance.maxMembers) return { ok: false, reason: "This alliance is full." };
  application.status = approve ? "approved" : "rejected"; application.reviewedBy = actorAddress; application.reviewedAt = now;
  if (approve && !allianceForAddress(application.address, directory)) alliance.members.push({ address: application.address, name: application.name, rank: "R1", joinedAt: now, holdingStatus: "verified", contribution: 0, credits: 0, lastActiveAt: now });
  saveAllianceDirectory(directory); return { ok: true };
}

export function setAllianceMemberRank(allianceId: string, actorAddress: string, targetAddress: string, rank: Exclude<AllianceRank, "R5">): { ok: boolean; reason?: string } {
  const directory = loadAllianceDirectory(); const alliance = allianceById(allianceId, directory);
  const actor = alliance?.members.find((member) => normalizeAddress(member.address) === normalizeAddress(actorAddress));
  const target = alliance?.members.find((member) => normalizeAddress(member.address) === normalizeAddress(targetAddress));
  if (!alliance || actor?.rank !== "R5") return { ok: false, reason: "Only the R5 can change member ranks." };
  if (!target || target.rank === "R5") return { ok: false, reason: "You cannot change this member's rank." };
  target.rank = rank; saveAllianceDirectory(directory); return { ok: true };
}

export function removeAllianceMember(allianceId: string, actorAddress: string, targetAddress: string, now = Date.now()): { ok: boolean; reason?: string } {
  const directory = loadAllianceDirectory(); const alliance = allianceById(allianceId, directory);
  const actor = alliance?.members.find((member) => normalizeAddress(member.address) === normalizeAddress(actorAddress));
  const target = alliance?.members.find((member) => normalizeAddress(member.address) === normalizeAddress(targetAddress));
  if (!alliance || !actor || !target) return { ok: false, reason: "Member not found." };
  if (target.rank === "R5" || normalizeAddress(target.address) === normalizeAddress(actor.address)) return { ok: false, reason: "You cannot remove this member." };
  if (actor.rank !== "R5" && !(actor.rank === "R4" && Number(target.rank.slice(1)) < 4)) return { ok: false, reason: "You do not have permission to remove this member." };
  alliance.members = alliance.members.filter((member) => normalizeAddress(member.address) !== normalizeAddress(targetAddress));
  directory.switchLocks[normalizeAddress(targetAddress)] = now + ALLIANCE_SWITCH_COOLDOWN_MS;
  saveAllianceDirectory(directory); return { ok: true };
}

export function updateAllianceStandards(allianceId: string, actorAddress: string, input: { minHoldingAmount?: string; activeStandard?: string; joinPolicy?: AllianceRecord["joinPolicy"] }): { ok: boolean; reason?: string } {
  const directory = loadAllianceDirectory(); const alliance = allianceById(allianceId, directory);
  const actor = alliance?.members.find((member) => normalizeAddress(member.address) === normalizeAddress(actorAddress));
  if (!alliance || actor?.rank !== "R5") return { ok: false, reason: "Only the R5 can change alliance requirements." };
  if (input.minHoldingAmount != null) {
    if (alliance.kind === "default" && input.minHoldingAmount.trim() !== "0") return { ok: false, reason: "GACO cannot require a token." };
    if (!/^\d+(\.\d+)?$/.test(input.minHoldingAmount.trim())) return { ok: false, reason: "Enter a non-negative token threshold." };
    alliance.minHoldingAmount = input.minHoldingAmount.trim();
    alliance.minHoldingDisplay = alliance.kind === "default" && alliance.minHoldingAmount === "0" ? "No token required" : `Hold ${alliance.minHoldingAmount} ${alliance.symbol}`;
  }
  if (input.activeStandard) alliance.activeStandard = input.activeStandard.slice(0, 80);
  if (input.joinPolicy) alliance.joinPolicy = alliance.kind === "default" ? "open" : input.joinPolicy;
  saveAllianceDirectory(directory); return { ok: true };
}

export function setAllianceDiplomacy(allianceId: string, actorAddress: string, targetAllianceId: string, stance: "neutral" | "nap" | "war"): { ok: boolean; reason?: string } {
  const directory = loadAllianceDirectory(); const alliance = allianceById(allianceId, directory);
  const actor = alliance?.members.find((member) => normalizeAddress(member.address) === normalizeAddress(actorAddress));
  const target = allianceById(targetAllianceId, directory);
  if (!alliance || actor?.rank !== "R5") return { ok: false, reason: "Only the R5 can manage diplomacy." };
  if (!target || target.id === alliance.id) return { ok: false, reason: "Select another active alliance." };
  if (stance === "nap") {
    if (alliance.napAllianceIds.includes(targetAllianceId)) return { ok: true };
    const pending = alliance.diplomacyRequests.some((request) => request.toAllianceId === targetAllianceId && request.status === "pending");
    if (!pending) alliance.diplomacyRequests.unshift({ id: `nap-${alliance.id}-${targetAllianceId}-${Date.now()}`, fromAllianceId: alliance.id, toAllianceId: targetAllianceId, createdAt: Date.now(), createdBy: actorAddress, status: "pending" });
    saveAllianceDirectory(directory); return { ok: true, reason: pending ? "A NAP request is already pending." : "NAP request sent. The other R5 must accept it." };
  }
  alliance.napAllianceIds = alliance.napAllianceIds.filter((id) => id !== targetAllianceId);
  alliance.warAllianceIds = alliance.warAllianceIds.filter((id) => id !== targetAllianceId);
  target.napAllianceIds = target.napAllianceIds.filter((id) => id !== alliance.id);
  target.warAllianceIds = target.warAllianceIds.filter((id) => id !== alliance.id);
  if (stance === "war") { alliance.warAllianceIds.push(targetAllianceId); target.warAllianceIds.push(alliance.id); }
  saveAllianceDirectory(directory); return { ok: true };
}

export function reviewAllianceNap(targetAllianceId: string, actorAddress: string, requestId: string, accept: boolean, now = Date.now()): { ok: boolean; reason?: string } {
  const directory = loadAllianceDirectory(); const target = allianceById(targetAllianceId, directory);
  const actor = target?.members.find((member) => normalizeAddress(member.address) === normalizeAddress(actorAddress));
  if (!target || actor?.rank !== "R5") return { ok: false, reason: "Only the receiving alliance's R5 can accept this NAP." };
  let request: AllianceDiplomacyRequest | undefined; let source: AllianceRecord | undefined;
  for (const alliance of directory.alliances) {
    const found = alliance.diplomacyRequests.find((candidate) => candidate.id === requestId && candidate.toAllianceId === targetAllianceId && candidate.status === "pending");
    if (found) { request = found; source = alliance; break; }
  }
  if (!request || !source) return { ok: false, reason: "This NAP request is no longer pending." };
  request.status = accept ? "accepted" : "rejected"; request.reviewedAt = now; request.reviewedBy = actorAddress;
  if (accept) {
    source.warAllianceIds = source.warAllianceIds.filter((id) => id !== target.id); target.warAllianceIds = target.warAllianceIds.filter((id) => id !== source!.id);
    if (!source.napAllianceIds.includes(target.id)) source.napAllianceIds.push(target.id);
    if (!target.napAllianceIds.includes(source.id)) target.napAllianceIds.push(source.id);
  }
  saveAllianceDirectory(directory); return { ok: true };
}

export function leaveAlliance(profile: Profile, now = Date.now(), gm = false): { ok: boolean; reason?: string } {
  const directory = loadAllianceDirectory();
  const alliance = allianceForAddress(profile.address, directory);
  if (!alliance) return { ok: false, reason: "You are not in an alliance." };
  const address = normalizeAddress(profile.address);
  alliance.members = alliance.members.filter((member) => normalizeAddress(member.address) !== address);
  Object.values(alliance.endorsements).forEach((addresses) => addresses.splice(0, addresses.length, ...addresses.filter((item) => normalizeAddress(item) !== address)));
  if (gm) delete directory.switchLocks[address];
  else directory.switchLocks[address] = now + ALLIANCE_SWITCH_COOLDOWN_MS;
  saveAllianceDirectory(directory);
  return { ok: true };
}

function deterministicColor(value: string): string {
  let hash = 2166136261;
  for (const char of value.toLowerCase()) { hash ^= char.charCodeAt(0); hash = Math.imul(hash, 16777619); }
  const hue = Math.abs(hash) % 360;
  return `hsl(${hue} 72% 64%)`;
}

export function foundAllianceFromToken(token: TokenHolding, profile: Profile, now = Date.now()): { ok: boolean; reason?: string; alliance?: AllianceRecord } {
  const directory = loadAllianceDirectory();
  if (allianceForAddress(profile.address, directory)) return { ok: false, reason: "Leave your current alliance first." };
  if (tokenAllianceForHolding(token, directory)) return { ok: false, reason: "An alliance already exists for this token." };
  const chapter = directory.nextChapter++;
  const symbol = (token.symbol || "TOKEN").trim().toUpperCase().slice(0, 12);
  const alliance: AllianceRecord = {
    id: `token-${normalizeAddress(token.address)}-${chapter}`,
    kind: "token", status: "forming", name: token.name?.trim() || symbol, symbol, chapter,
    color: deterministicColor(token.address), iconUrl: token.iconUrl, contractAddress: token.address, tokenDecimals: token.decimals, minHoldingAmount: "1",
    minHoldingDisplay: `Hold 1 ${symbol}`, activeStandard: "Log in at least once every 72 hours",
    rules: ["The token contract cannot be changed.", "Founding members are public.", "Five members must support the same R5."],
    joinPolicy: "application", applications: [], maxMembers: 100,
    napAllianceIds: [], warAllianceIds: [], diplomacyRequests: [], members: [memberFrom(profile, now)], endorsements: {},
    decrees: [{ id: `founding-${chapter}`, title: "ALLIANCE CREATED", body: `${symbol} Alliance #${String(chapter).padStart(3, "0")} needs six members and five votes for an R5.`, createdAt: now, author: profile.name }],
    helps: [], skillLevels: { growth: 0, warfare: 0, mutualAid: 0 }, skillPoints: 0, challenges: [], createdAt: now,
  };
  directory.alliances.push(alliance);
  saveAllianceDirectory(directory);
  return { ok: true, alliance };
}

export function endorseCandidate(allianceId: string, voterAddress: string, candidateAddress: string): { ok: boolean; reason?: string; activated?: boolean } {
  const directory = loadAllianceDirectory();
  const alliance = allianceById(allianceId, directory);
  if (!alliance || alliance.status !== "forming") return { ok: false, reason: "This alliance is already active." };
  const voter = alliance.members.find((member) => normalizeAddress(member.address) === normalizeAddress(voterAddress));
  const candidate = alliance.members.find((member) => normalizeAddress(member.address) === normalizeAddress(candidateAddress));
  if (!voter || !candidate || normalizeAddress(voter.address) === normalizeAddress(candidate.address)) return { ok: false, reason: "Choose another founding member for R5." };
  Object.keys(alliance.endorsements).forEach((key) => { alliance.endorsements[key] = alliance.endorsements[key].filter((address) => normalizeAddress(address) !== normalizeAddress(voterAddress)); });
  const endorsements = alliance.endorsements[candidate.address] ?? [];
  endorsements.push(voter.address); alliance.endorsements[candidate.address] = endorsements;
  let activated = false;
  if (alliance.members.length >= 6 && new Set(endorsements.map(normalizeAddress)).size >= 5) {
    alliance.status = "active"; candidate.rank = "R5"; activated = true;
    alliance.decrees.unshift({ id: `activated-${Date.now()}`, title: "ALLIANCE ACTIVATED", body: `${candidate.name} is now the R5.`, createdAt: Date.now(), author: "Alliance System" });
  }
  saveAllianceDirectory(directory);
  return { ok: true, activated };
}

export function requestAllianceHelp(profile: Profile, kind: AllianceHelpRequest["kind"], targetKey: string, label: string, now = Date.now()): { ok: boolean; reason?: string; request?: AllianceHelpRequest } {
  const directory = loadAllianceDirectory();
  const alliance = allianceForAddress(profile.address, directory);
  if (!alliance || alliance.status !== "active") return { ok: false, reason: "Alliance Help unlocks when the alliance becomes active." };
  const open = alliance.helps.find((help) => !help.closedAt && normalizeAddress(help.ownerAddress) === normalizeAddress(profile.address) && help.kind === kind && help.targetKey === targetKey);
  if (open) return { ok: true, request: open };
  const request: AllianceHelpRequest = { id: `${kind}-${normalizeAddress(profile.address)}-${targetKey}-${now}`, allianceId: alliance.id, ownerAddress: profile.address, ownerName: profile.name, kind, targetKey, label, createdAt: now, helpers: [] };
  alliance.helps.push(request); saveAllianceDirectory(directory); return { ok: true, request };
}

export function openHelpFor(profile: Profile, kind: AllianceHelpRequest["kind"], targetKey: string): AllianceHelpRequest | null {
  const alliance = allianceForAddress(profile.address);
  return alliance?.helps.find((help) => !help.closedAt && normalizeAddress(help.ownerAddress) === normalizeAddress(profile.address) && help.kind === kind && help.targetKey === targetKey) ?? null;
}

function rewardDateKey(now: number): string { return new Date(now).toISOString().slice(0, 10); }

export function helpAll(profile: Profile, now = Date.now()): { helped: number; rewarded: number; secondsRemoved: number; reason?: string } {
  const directory = loadAllianceDirectory();
  const alliance = allianceForAddress(profile.address, directory);
  if (!alliance || alliance.status !== "active") return { helped: 0, rewarded: 0, secondsRemoved: 0, reason: "You need an active alliance to help members." };
  const helperAddress = normalizeAddress(profile.address);
  const helper = alliance.members.find((member) => normalizeAddress(member.address) === helperAddress);
  if (!helper || helper.holdingStatus !== "verified") return { helped: 0, rewarded: 0, secondsRemoved: 0, reason: "Your alliance membership is suspended." };
  const eligible = alliance.helps.filter((request) => !request.closedAt && normalizeAddress(request.ownerAddress) !== helperAddress && request.helpers.length < HELP_LIMIT && !request.helpers.some((address) => normalizeAddress(address) === helperAddress));
  const date = rewardDateKey(now);
  const rewardKey = `ruglands:alliance-help-rewards:${helperAddress}:${date}`;
  const storage = safeStorage();
  const prior = Math.max(0, Number(storage?.getItem(rewardKey)) || 0);
  let rewarded = 0;
  let helped = 0;
  eligible.forEach((request) => {
    const game = loadGame(request.ownerAddress);
    let applied = false;
    if (game) {
      if (request.kind === "building" && game.buildings[request.targetKey as keyof typeof game.buildings]?.finishAt > now) {
        game.buildings[request.targetKey as keyof typeof game.buildings].finishAt = Math.max(now, game.buildings[request.targetKey as keyof typeof game.buildings].finishAt - HELP_REDUCTION_MS);
        applied = true;
      } else if (request.kind === "healing" && game.healing.finishAt > now) { game.healing.finishAt = Math.max(now, game.healing.finishAt - HELP_REDUCTION_MS); applied = true; }
      saveGame(game);
    }
    if (!applied) { request.closedAt = now; return; }
    request.helpers.push(profile.address); helped += 1;
    const queueDone = request.kind === "building"
      ? (game?.buildings[request.targetKey as keyof typeof game.buildings]?.finishAt ?? 0) <= now
      : (game?.healing.finishAt ?? 0) <= now;
    if (request.helpers.length >= HELP_LIMIT || queueDone) request.closedAt = now;
    if (prior + rewarded < HELP_REWARD_DAILY_LIMIT) rewarded += 1;
  });
  helper.contribution += rewarded;
  helper.credits += rewarded * 2;
  if (storage) storage.setItem(rewardKey, String(prior + rewarded));
  saveAllianceDirectory(directory);
  return { helped, rewarded, secondsRemoved: helped * HELP_REDUCTION_MS / 1000 };
}

export function relationshipBetween(viewerAllianceId: string | null, targetAllianceId: string | null, own = false, directory = loadAllianceDirectory()): AllianceRelation {
  if (own) return "self";
  if (viewerAllianceId && targetAllianceId && viewerAllianceId === targetAllianceId) return "ally";
  const viewer = allianceById(viewerAllianceId, directory);
  if (viewer && targetAllianceId && viewer.warAllianceIds.includes(targetAllianceId)) return "war";
  if (viewer && targetAllianceId && viewer.napAllianceIds.includes(targetAllianceId)) return "nap";
  return "neutral";
}

export function verifyAllianceHolding(profile: Profile, holdings: TokenHolding[], now = Date.now()): { status: "none" | "verified" | "suspended" | "removed"; alliance?: AllianceRecord } {
  const directory = loadAllianceDirectory();
  const alliance = allianceForAddress(profile.address, directory);
  if (!alliance) return { status: "none" };
  const member = alliance.members.find((candidate) => normalizeAddress(candidate.address) === normalizeAddress(profile.address))!;
  if (holdingMeetsAllianceThreshold(alliance, holdings)) {
    member.holdingStatus = "verified"; delete member.holdingFailedAt; member.lastActiveAt = now; saveAllianceDirectory(directory); return { status: "verified", alliance };
  }
  if (!member.holdingFailedAt) { member.holdingFailedAt = now; member.holdingStatus = "suspended"; saveAllianceDirectory(directory); return { status: "suspended", alliance }; }
  if (now - member.holdingFailedAt < ALLIANCE_HOLDING_GRACE_MS) return { status: "suspended", alliance };
  alliance.members = alliance.members.filter((candidate) => normalizeAddress(candidate.address) !== normalizeAddress(profile.address));
  directory.switchLocks[normalizeAddress(profile.address)] = now + ALLIANCE_SWITCH_COOLDOWN_MS;
  saveAllianceDirectory(directory); return { status: "removed", alliance };
}

export function gmSeedAlliance(allianceId: string, count = 6): AllianceRecord | null {
  const directory = loadAllianceDirectory(); const alliance = allianceById(allianceId, directory); if (!alliance) return null;
  while (alliance.members.length < count) {
    const index = alliance.members.length + 1;
    alliance.members.push({ address: `0x00000000000000000000000000000000a11y${String(index).padStart(4, "0")}`, name: `Relay-${String(index).padStart(2, "0")}`, rank: index <= 2 ? "R4" : "R2", joinedAt: Date.now() - index * 86400000, holdingStatus: "verified", contribution: 1300 - index * 73, credits: 240 + index * 11, lastActiveAt: Date.now() - index * 600000 });
  }
  saveAllianceDirectory(directory); return alliance;
}

export function gmPrepareAlliance(allianceId: string, address: string): AllianceRecord | null {
  const directory = loadAllianceDirectory(); const alliance = allianceById(allianceId, directory); if (!alliance) return null;
  gmSeedAlliance(allianceId, 8);
  const refreshed = loadAllianceDirectory(); const ready = allianceById(allianceId, refreshed); if (!ready) return null;
  ready.members.forEach((member) => { if (member.rank === "R5") member.rank = "R4"; });
  const actor = ready.members.find((member) => normalizeAddress(member.address) === normalizeAddress(address));
  if (actor) { actor.rank = "R5"; actor.joinedAt = Date.now() - 8 * 86400000; actor.credits = Math.max(actor.credits, 1200); actor.contribution = Math.max(actor.contribution, 5000); }
  ready.status = "active"; ready.skillPoints = Math.max(ready.skillPoints, 12); ready.lastChallengeAt = undefined;
  if (!refreshed.alliances.some((entry) => entry.id === "sim-orbt")) refreshed.alliances.push(gmRivalAlliance("sim-orbt", "ORBT", "ORBT", 101, "#a98cff", Date.now()));
  if (!refreshed.alliances.some((entry) => entry.id === "sim-mog")) refreshed.alliances.push(gmRivalAlliance("sim-mog", "MOG", "MOG", 102, "#ff9a67", Date.now()));
  saveAllianceDirectory(refreshed); return ready;
}

function gmRivalAlliance(id: string, name: string, symbol: string, chapter: number, color: string, now: number): AllianceRecord {
  return { id, kind: "token", status: "active", name, symbol, chapter, color, contractAddress: `0x${id.replace(/[^a-f0-9]/g, "a").padEnd(40, "0").slice(0, 40)}`, tokenDecimals: 18, minHoldingAmount: "1", minHoldingDisplay: `Hold 1 ${symbol}`, activeStandard: "Log in at least once every 48 hours", joinPolicy: "application", applications: [], maxMembers: 100, rules: ["Do not attack alliance members."], napAllianceIds: [], warAllianceIds: [], diplomacyRequests: [], members: [{ address: `0x${id.padEnd(40, "0").slice(0, 40)}`, name: `${symbol} Prime`, rank: "R5", joinedAt: now - 20 * 86400000, holdingStatus: "verified", contribution: 9000, credits: 1200, lastActiveAt: now }], endorsements: {}, decrees: [], helps: [], skillLevels: { growth: 2, warfare: 2, mutualAid: 1 }, skillPoints: 0, challenges: [], createdAt: now - 30 * 86400000 };
}

export function initiateLeadershipChallenge(profile: Profile, candidateAddress: string, now = Date.now(), gm = false): { ok: boolean; reason?: string; challenge?: LeadershipChallenge } {
  const directory = loadAllianceDirectory(); const alliance = allianceForAddress(profile.address, directory);
  if (!alliance || alliance.status !== "active") return { ok: false, reason: "Governance unlocks when the alliance becomes active." };
  const initiator = alliance.members.find((member) => normalizeAddress(member.address) === normalizeAddress(profile.address));
  const candidate = alliance.members.find((member) => normalizeAddress(member.address) === normalizeAddress(candidateAddress));
  if (!initiator || !candidate || initiator.holdingStatus !== "verified") return { ok: false, reason: "You need an active alliance membership to start a challenge." };
  if (!gm && now - initiator.joinedAt < 7 * 86400000) return { ok: false, reason: "You must be in this alliance for 7 days before starting a challenge." };
  if (alliance.challenges.some((challenge) => !challenge.resolvedAt && challenge.closesAt > now)) return { ok: false, reason: "A leadership vote is already open." };
  if (!gm && alliance.lastChallengeAt && now - alliance.lastChallengeAt < LEADERSHIP_CHALLENGE_COOLDOWN_MS) return { ok: false, reason: "Another challenge can begin after the 7-day cooldown." };
  const eligibleAddresses = alliance.members.filter((member) => member.holdingStatus === "verified" && now - member.joinedAt >= 7 * 86400000).map((member) => member.address);
  const challenge: LeadershipChallenge = { id: `command-${now}`, initiatorAddress: initiator.address, initiatorName: initiator.name, candidateAddress: candidate.address, candidateName: candidate.name, createdAt: now, closesAt: now + LEADERSHIP_BALLOT_MS, eligibleAddresses, votes: {} };
  alliance.challenges.unshift(challenge); alliance.lastChallengeAt = now; saveAllianceDirectory(directory); return { ok: true, challenge };
}

export function castLeadershipVote(allianceId: string, voterAddress: string, candidateAddress: string, now = Date.now()): { ok: boolean; reason?: string } {
  const directory = loadAllianceDirectory(); const alliance = allianceById(allianceId, directory);
  const challenge = alliance?.challenges.find((item) => !item.resolvedAt && item.closesAt > now);
  if (!alliance || !challenge) return { ok: false, reason: "There is no active leadership vote." };
  const voterKey = normalizeAddress(voterAddress);
  if (!challenge.eligibleAddresses.some((address) => normalizeAddress(address) === voterKey)) return { ok: false, reason: "You are not eligible to vote in this challenge." };
  if (!alliance.members.some((member) => normalizeAddress(member.address) === normalizeAddress(candidateAddress))) return { ok: false, reason: "This candidate is no longer in the alliance." };
  challenge.votes[voterKey] = candidateAddress; saveAllianceDirectory(directory); return { ok: true };
}

export function resolveLeadershipChallenges(now = Date.now()): void {
  const directory = loadAllianceDirectory(); let changed = false;
  directory.alliances.forEach((alliance) => alliance.challenges.forEach((challenge) => {
    if (challenge.resolvedAt || challenge.closesAt > now) return;
    challenge.resolvedAt = now; changed = true;
    const tally = new Map<string, number>(); Object.values(challenge.votes).forEach((address) => tally.set(normalizeAddress(address), (tally.get(normalizeAddress(address)) ?? 0) + 1));
    const quorum = Math.ceil(challenge.eligibleAddresses.length * .4);
    const incumbent = alliance.members.find((member) => member.rank === "R5");
    let winner = incumbent;
    if (Object.keys(challenge.votes).length >= quorum) {
      const ranked = alliance.members.map((member) => ({ member, votes: tally.get(normalizeAddress(member.address)) ?? 0 })).sort((a, b) => b.votes - a.votes);
      if (ranked[0] && (!incumbent || ranked[0].votes > (tally.get(normalizeAddress(incumbent.address)) ?? 0))) winner = ranked[0].member;
    }
    if (winner) { alliance.members.forEach((member) => { if (member.rank === "R5") member.rank = "R4"; }); winner.rank = "R5"; challenge.winnerAddress = winner.address; }
  }));
  if (changed) saveAllianceDirectory(directory);
}

export function gmCompleteLeadershipChallenge(allianceId: string, now = Date.now()): { ok: boolean; reason?: string } {
  const directory = loadAllianceDirectory();
  const alliance = allianceById(allianceId, directory);
  const challenge = alliance?.challenges.find((item) => !item.resolvedAt);
  if (!alliance || !challenge) return { ok: false, reason: "There is no active leadership vote." };
  const winner = alliance.members.find((member) => normalizeAddress(member.address) === normalizeAddress(challenge.candidateAddress));
  if (!winner) return { ok: false, reason: "The selected candidate is no longer in the alliance." };
  alliance.members.forEach((member) => { if (member.rank === "R5") member.rank = "R4"; });
  winner.rank = "R5";
  challenge.resolvedAt = now;
  challenge.winnerAddress = winner.address;
  saveAllianceDirectory(directory);
  return { ok: true };
}

export function upgradeAllianceSkill(allianceId: string, actorAddress: string, branch: keyof AllianceRecord["skillLevels"]): { ok: boolean; reason?: string } {
  const directory = loadAllianceDirectory(); const alliance = allianceById(allianceId, directory);
  const actor = alliance?.members.find((member) => normalizeAddress(member.address) === normalizeAddress(actorAddress));
  if (!alliance || !actor || !(["R4", "R5"] as AllianceRank[]).includes(actor.rank)) return { ok: false, reason: "Only R4 and R5 members can upgrade alliance skills." };
  if (alliance.skillPoints < 1) return { ok: false, reason: "No skill points available." };
  if (alliance.skillLevels[branch] >= 5) return { ok: false, reason: "This skill is already at max level." };
  alliance.skillPoints -= 1; alliance.skillLevels[branch] += 1; saveAllianceDirectory(directory); return { ok: true };
}

export interface AllianceGameplayBonuses {
  constructionSpeedBonus: number;
  gatherSpeedBonus: number;
  marchSpeedBonus: number;
  marchCapacityBonus: number;
  healingSpeedBonus: number;
}

export function allianceGameplayBonuses(address: string): AllianceGameplayBonuses {
  const none = { constructionSpeedBonus: 0, gatherSpeedBonus: 0, marchSpeedBonus: 0, marchCapacityBonus: 0, healingSpeedBonus: 0 };
  const alliance = allianceForAddress(address); if (!alliance || alliance.status !== "active") return none;
  const member = alliance.members.find((candidate) => normalizeAddress(candidate.address) === normalizeAddress(address));
  if (!member || member.holdingStatus !== "verified") return none;
  return {
    constructionSpeedBonus: alliance.skillLevels.growth * .01,
    gatherSpeedBonus: alliance.skillLevels.growth * .01,
    marchSpeedBonus: alliance.skillLevels.warfare * .01,
    marchCapacityBonus: alliance.skillLevels.warfare * .01,
    healingSpeedBonus: alliance.skillLevels.mutualAid * .01,
  };
}
