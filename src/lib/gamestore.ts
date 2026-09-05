import N from "../../docs/numbers.json";
import type { GameState, BKey, ResKey, TroopKey } from "./game";
import { BUILDING_ORDER, RES_ORDER, TROOP_ORDER } from "./game";

const KEY = (a: string) => `ruglands:game:${a.toLowerCase()}`;

export function loadGame(address: string): GameState | null {
  try {
    const s = localStorage.getItem(KEY(address));
    return s ? (JSON.parse(s) as GameState) : null;
  } catch {
    return null;
  }
}
export function saveGame(s: GameState) {
  try {
    localStorage.setItem(KEY(s.address), JSON.stringify(s));
  } catch {}
}

export function initGame(address: string): GameState {
  const sl = (N as any).startingLayout;
  const prebuilt: string[] = sl.prebuilt || [];
  const has = (k: BKey) => k === "keep" || prebuilt.includes("building." + k);
  const mk = (k: BKey) => ({ lvl: has(k) ? 1 : 0, finishAt: 0 });

  const buildings = {} as Record<BKey, { lvl: number; finishAt: number }>;
  BUILDING_ORDER.forEach((k) => { buildings[k] = mk(k); });

  const res = {} as Record<ResKey, number>;
  RES_ORDER.forEach((r) => { res[r] = sl.startingResources?.["res." + r] ?? 0; });

  const troops = {} as Record<TroopKey, number>;
  TROOP_ORDER.forEach((t) => { troops[t] = sl.startingTroops?.["troop." + t] ?? 0; });

  return {
    address,
    buildings,
    res,
    troops,
    wounded: 0,
    train: { type: "army", qty: 0, per: 0, finishAt: 0 },
    lastTick: Date.now(),
  };
}
