import type { BKey, GameState } from "./game";
import { BUILDING_ORDER, RES_ORDER, TROOP_ORDER, buildingOperationBlockReason, capacity, highestUnlockedTroopTier, isUpgradable, maxLevel, maxTroopsForType, project } from "./game";
import { initGame } from "./gamestore";
import { researchTechs } from "./research";

export const GM_WALLET_ADDRESSES = ["0xbb1d63c5af5d97963671c8bd8a5f73a7ebad1d1c"] as const;

// Owner accounts (Google sign-in). When one of these emails signs in we stamp
// its synthetic session address into localStorage so GM works on production too
// — GM is otherwise locked to DEV/localhost. Keyed by the exact session address
// so only that owner's own device+account is elevated.
export const GM_OWNER_EMAILS = ["boxiwang1992@gmail.com"] as const;
const GM_OWNER_KEY = "alliance:gm-owner";

export function isGmOwnerEmail(email: string | null | undefined): boolean {
  return !!email && GM_OWNER_EMAILS.includes(email.trim().toLowerCase() as typeof GM_OWNER_EMAILS[number]);
}

/** Remember an owner's session address so hasLocalGm() elevates it on any env. */
export function registerOwnerGm(address: string): void {
  if (!address) return;
  try { localStorage.setItem(GM_OWNER_KEY, address.trim().toLowerCase()); } catch {}
}

export function ownerGmAddress(): string | null {
  try { return localStorage.getItem(GM_OWNER_KEY); } catch { return null; }
}

export function isGmWallet(address: string): boolean {
  return GM_WALLET_ADDRESSES.includes(address.trim().toLowerCase() as typeof GM_WALLET_ADDRESSES[number]);
}

export function localGmAvailable(): boolean {
  if (!import.meta.env.DEV || typeof window === "undefined") return false;
  return window.location.hostname === "localhost" || window.location.hostname === "127.0.0.1";
}

export function localGmRequested(): boolean {
  return localGmAvailable() && new URLSearchParams(window.location.search).has("gm");
}

function isSyntheticDevAddress(address: string): boolean {
  return /^0x0{30,}[a-z0-9-]*dev[a-z0-9-]*$/i.test(address.trim());
}

export function hasLocalGm(address: string): boolean {
  if (!address) return false;
  const a = address.trim().toLowerCase();
  // Owner wallet or a registered owner session (Google) get GM on any env.
  if (isGmWallet(a)) return true;
  if (ownerGmAddress() === a) return true;
  // Otherwise GM is limited to a `?gm` dev synthetic on localhost.
  return localGmAvailable() && localGmRequested() && isSyntheticDevAddress(a);
}

export function grantLocalGm(address: string): boolean {
  return hasLocalGm(address);
}

export function revokeLocalGm(_address: string): void {}

export function gmFillResources(state: GameState, now = Date.now()): GameState {
  const next = project(state, now);
  const cap = capacity(next);
  RES_ORDER.forEach((resource) => { next.res[resource] = cap; });
  return next;
}

export function gmFinishQueues(state: GameState, now = Date.now()): GameState {
  const next: GameState = JSON.parse(JSON.stringify(state));
  BUILDING_ORDER.forEach((building) => {
    if (next.buildings[building].finishAt > 0) next.buildings[building].finishAt = now;
  });
  TROOP_ORDER.forEach((type) => {
    if (next.training[type].finishAt > 0) next.training[type].finishAt = now;
  });
  if (next.researchQueue.finishAt > 0) next.researchQueue.finishAt = now;
  if (next.healing.finishAt > 0) next.healing.finishAt = now;
  return project(next, now);
}

export function gmFillTroops(state: GameState, now = Date.now()): GameState {
  const next = project(state, now);
  TROOP_ORDER.forEach((type) => {
    Object.keys(next.troops[type]).forEach((tier) => { next.troops[type][tier] = 0; });
    const capacityForArm = maxTroopsForType(next, type);
    if (capacityForArm > 0) next.troops[type][String(highestUnlockedTroopTier(next, type))] = capacityForArm;
  });
  return next;
}

export function gmMaxResearch(state: GameState, now = Date.now()): GameState {
  const next = project(state, now);
  next.researchQueue = { tech: "", targetLevel: 0, durationSec: 0, finishAt: 0 };
  researchTechs().forEach((tech) => { next.research[tech.key] = tech.maxLevel; });
  return next;
}

export function gmRaiseTownhall(state: GameState, now = Date.now()): GameState {
  const next = project(state, now);
  next.buildings.keep.finishAt = 0;
  next.buildings.keep.lvl = Math.min(30, next.buildings.keep.lvl + 1);
  return next;
}

export function gmRaiseBuilding(state: GameState, building: BKey, now = Date.now()): GameState {
  const next = project(state, now);
  if (!isUpgradable(building)) return next;
  // GM can skip costs/timers, but it cannot violate the same operating-building
  // invariant as a player upgrade.
  if (buildingOperationBlockReason(next, building)) return next;
  next.buildings[building].finishAt = 0;
  next.buildings[building].lvl = Math.min(maxLevel(building), next.buildings[building].lvl + 1);
  return next;
}

export function gmResetProgress(address: string, now = Date.now()): GameState {
  const next = initGame(address);
  BUILDING_ORDER.forEach((building) => {
    next.buildings[building] = { lvl: 0, finishAt: 0 };
  });
  // Townhall Lv.1 is the minimum viable city; Lv.0 cannot unlock/build itself.
  next.buildings.keep.lvl = 1;
  RES_ORDER.forEach((resource) => { next.res[resource] = 0; });
  TROOP_ORDER.forEach((type) => {
    Object.keys(next.troops[type]).forEach((tier) => { next.troops[type][tier] = 0; });
    next.training[type] = { mode: "train", sourceTier: 0, tier: 1, qty: 0, per: 0, finishAt: 0 };
  });
  next.wounded = 0;
  next.research = {};
  next.researchQueue = { tech: "", targetLevel: 0, durationSec: 0, finishAt: 0 };
  next.lastTick = now;
  return next;
}
