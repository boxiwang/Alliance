import type { BKey, GameState } from "./game";
import { BUILDING_ORDER, RES_ORDER, TROOP_ORDER, capacity, highestUnlockedTroopTier, isUpgradable, maxLevel, maxTroopsForType, project } from "./game";
import { initGame } from "./gamestore";

const KEY = (address: string) => `ruglands:gm:${address.toLowerCase()}`;

export function localGmAvailable(): boolean {
  if (!import.meta.env.DEV || typeof window === "undefined") return false;
  return window.location.hostname === "localhost" || window.location.hostname === "127.0.0.1";
}

export function localGmRequested(): boolean {
  return localGmAvailable() && new URLSearchParams(window.location.search).has("gm");
}

export function hasLocalGm(address: string): boolean {
  if (!localGmAvailable() || !address) return false;
  try {
    return localStorage.getItem(KEY(address)) === "1";
  } catch {
    return false;
  }
}

export function grantLocalGm(address: string): boolean {
  if (!localGmAvailable() || !address) return false;
  try {
    localStorage.setItem(KEY(address), "1");
    return true;
  } catch {
    return false;
  }
}

export function revokeLocalGm(address: string): void {
  if (!localGmAvailable() || !address) return;
  try {
    localStorage.removeItem(KEY(address));
  } catch {}
}

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

export function gmRaiseTownhall(state: GameState, now = Date.now()): GameState {
  const next = project(state, now);
  next.buildings.keep.finishAt = 0;
  next.buildings.keep.lvl = Math.min(30, next.buildings.keep.lvl + 1);
  return next;
}

export function gmRaiseBuilding(state: GameState, building: BKey, now = Date.now()): GameState {
  const next = project(state, now);
  if (!isUpgradable(building)) return next;
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
    next.training[type] = { tier: 1, qty: 0, per: 0, finishAt: 0 };
  });
  next.wounded = 0;
  next.lastTick = now;
  return next;
}
