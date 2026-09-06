import { getN } from "./numbers";
const N: any = getN();
import type { GameState, BKey, ResKey, TroopKey } from "./game";
import { BUILDING_ORDER, RES_ORDER, TROOP_ORDER } from "./game";

const KEY = (a: string) => `ruglands:game:${a.toLowerCase()}`;

export function loadGame(address: string): GameState | null {
  try {
    const s = localStorage.getItem(KEY(address));
    return s ? migrateGame(JSON.parse(s), address) : null;
  } catch {
    return null;
  }
}
export function saveGame(s: GameState) {
  try {
    localStorage.setItem(KEY(s.address), JSON.stringify(s));
  } catch {}
}

// v0.4 migration: old saves stored one number per troop arm. Preserve those
// units as T1 and fill new fields instead of resetting player progress.
export function migrateGame(raw: any, address: string): GameState {
  const fresh = initGame(address);
  const buildings = { ...fresh.buildings };
  BUILDING_ORDER.forEach((key) => {
    if (raw?.buildings?.[key]) buildings[key] = { ...fresh.buildings[key], ...raw.buildings[key] };
  });
  // v0.5: the old all-arms Barracks becomes three specialized buildings.
  // Preserve its completed level for every arm because it previously unlocked all three.
  const legacyBarracks = raw?.buildings?.barracks;
  if (legacyBarracks) {
    (["armyCamp", "navalBase", "airfield"] as BKey[]).forEach((key) => {
      if (!raw?.buildings?.[key]) {
        buildings[key] = {
          lvl: Math.max(0, Number(legacyBarracks.lvl) || 0),
          finishAt: key === "armyCamp" ? Math.max(0, Number(legacyBarracks.finishAt) || 0) : 0,
        };
      }
    });
  }

  const res = { ...fresh.res };
  RES_ORDER.forEach((key) => {
    const value = raw?.res?.[key];
    if (Number.isFinite(value)) res[key] = value;
  });

  const troops = { ...fresh.troops };
  TROOP_ORDER.forEach((key) => {
    const saved = raw?.troops?.[key];
    if (typeof saved === "number") troops[key] = { "1": Math.max(0, saved) };
    else if (saved && typeof saved === "object") {
      troops[key] = {};
      for (let tier = 1; tier <= 10; tier += 1) {
        const qty = saved[String(tier)];
        troops[key][String(tier)] = Number.isFinite(qty) ? Math.max(0, qty) : 0;
      }
    }
  });

  const training = { ...fresh.training };
  TROOP_ORDER.forEach((type) => {
    const saved = raw?.training?.[type];
    if (saved && typeof saved === "object") {
      training[type] = {
        tier: Number.isFinite(saved.tier) ? Math.max(1, saved.tier) : 1,
        qty: Number.isFinite(saved.qty) ? Math.max(0, saved.qty) : 0,
        per: Number.isFinite(saved.per) ? Math.max(0, saved.per) : 0,
        finishAt: Number.isFinite(saved.finishAt) ? Math.max(0, saved.finishAt) : 0,
      };
    }
  });
  // v0.4 and older had one shared queue.
  if (!raw?.training && raw?.train && TROOP_ORDER.includes(raw.train.type)) {
    const type = raw.train.type as TroopKey;
    training[type] = {
      tier: Number.isFinite(raw.train.tier) ? Math.max(1, raw.train.tier) : 1,
      qty: Number.isFinite(raw.train.qty) ? Math.max(0, raw.train.qty) : 0,
      per: Number.isFinite(raw.train.per) ? Math.max(0, raw.train.per) : 0,
      finishAt: Number.isFinite(raw.train.finishAt) ? Math.max(0, raw.train.finishAt) : 0,
    };
  }

  return {
    ...fresh,
    ...raw,
    address,
    buildings,
    res,
    troops,
    wounded: Number.isFinite(raw?.wounded) ? Math.max(0, raw.wounded) : 0,
    training,
    lastTick: Number.isFinite(raw?.lastTick) ? raw.lastTick : Date.now(),
  };
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

  const troops = {} as Record<TroopKey, Record<string, number>>;
  TROOP_ORDER.forEach((t) => {
    troops[t] = {};
    for (let tier = 1; tier <= 10; tier += 1) troops[t][String(tier)] = 0;
    troops[t]["1"] = sl.startingTroops?.["troop." + t] ?? 0;
  });

  return {
    address,
    buildings,
    res,
    troops,
    wounded: 0,
    training: {
      army: { tier: 1, qty: 0, per: 0, finishAt: 0 },
      navy: { tier: 1, qty: 0, per: 0, finishAt: 0 },
      air: { tier: 1, qty: 0, per: 0, finishAt: 0 },
    },
    lastTick: Date.now(),
  };
}
