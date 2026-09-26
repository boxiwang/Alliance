import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  GameState, BKey, TroopKey, ResKey, BUILDINGS, BUILDING_ORDER, RES, RES_ORDER, TROOPS_META, TROOP_ORDER,
  project, startUpgrade, startTrain, upgradeCost, upgradeTimeSec,
  buildingOperationBlockReason,
  isUnlocked, isUpgradable, unlockAtKeep, maxLevel, capForLevel, capacity, prodPerHour, totalTroops,
  mightBreakdown, troopStats, troopBatchCost, troopCountByType, maxTroopsForType, trainQueueSize, TRAINING_BUILDING,
  activeUpgrades, buildQueueSlots,
  trainSpeedMult, unlockedTroopTiers,
  promotionBatchCost, promotionQueueSize, promotionTimePerTroop, promotionUnlocked, promotionUnlockLevel, startPromote,
  healingBatchCost, healingDurationSec, healingSpeedMult, hospitalCapacity, startHealing,
  displayResource, displayTroops,
  missingTownhallPrerequisites,
  accountMarchCapacity, accountResearchModifiers, startResearch, worldMarchSlots,
} from "./lib/game";
import {
  ResearchBranch, effectLabel, researchBlockReason,
  RESEARCH_EFFECT_BRANCH, researchConfig, researchCost, researchLevel, researchLevelRow, researchTech, researchTechs,
  researchTreeLayers,
} from "./lib/research";
import { loadGame, saveGame, initGame } from "./lib/gamestore";
import {
  gmFillResources, gmFillTroops, gmFinishQueues, gmMaxResearch, gmRaiseTownhall,
  gmRaiseBuilding, gmResetProgress, hasLocalGm,
} from "./lib/gm";
import { Profile } from "./lib/profile";
import { compact } from "./lib/format";
import { clearLocalWorldSession, loadLocalWorldSession, openLocalWorldSession } from "./lib/world-adapter";
import { energyAt } from "./lib/world-engine";
import { getN } from "./lib/numbers";
import GameNav from "./GameNav";
import BuildingGlyph from "./BuildingGlyph";
import CosmicBackdrop from "./CosmicBackdrop";
import MiniComms from "./MiniComms";
import CityStarGrid from "./CityStarGrid";
import { ALLIANCE_CHANGED_EVENT, allianceGameplayBonuses, openHelpFor, requestAllianceHelp } from "./lib/alliance";
import { loadPlayerAccount } from "./lib/player-account";
import { playSfx, SFX_BUILDING_SELECT, SFX_BUILDING_SELECT_VOLUME } from "./lib/sfx";
import {
  consumeInventoryItem, enableGameAuthority, ensureGameAuthority, fetchServerGame, grantGmInventory, loadInventory,
  sendGameCommand, type GameCommandResponse, type InventoryBalance,
} from "./lib/backend";
import { MVP_ITEM_BY_ID, MVP_ITEMS, SPEEDUP_QUEUES, speedupIconPath } from "./lib/mvp-items";
import { activeSpeedupTargets, applySpeedup, speedupCompatible, speedupTargetId, type SpeedupTarget } from "./lib/speedups";
import type { ServerReport, LiveMarch } from "./lib/realtime";
import { incomingCityMarches, recentCityScan } from "./lib/city-alerts";
import { useGraphicsQuality } from "./useGraphicsQuality";

const ECONOMY_BUILDINGS: BKey[] = ["bank", "oilwell", "powerplant"];
const COMMAND_BUILDINGS: BKey[] = ["storage", "wall"];
const MILITARY_BUILDINGS: BKey[] = ["armyCamp", "navalBase", "airfield"];
const INFRASTRUCTURE_BUILDINGS: BKey[] = ["academy", "hospital", "watchtower", "embassy", "milestone"];

function fmtMs(ms: number): string {
  const s = Math.max(0, Math.ceil(ms / 1000));
  if (s < 60) return s + "s";
  if (s < 3600) return Math.floor(s / 60) + "m " + (s % 60) + "s";
  return Math.floor(s / 3600) + "h " + Math.floor((s % 3600) / 60) + "m";
}
function fmtSec(s: number): string { return fmtMs(s * 1000); }
function researchEffectName(key: string): string {
  return key.replace(/Bonus$/, "").replace(/([a-z])([A-Z])/g, "$1 $2").replace(/^./, (value) => value.toUpperCase());
}

const RESEARCH_EFFECT_TARGET: Record<string, string> = {
  constructionSpeedBonus: "All building upgrade timers",
  researchSpeedBonus: "All Research Institute timers",
  trainingCapacityBonus: "Army, Navy and Air training batch size",
  trainingSpeedBonus: "Army, Navy and Air training and promotion timers",
  healingSpeedBonus: "Hospital healing timers",
  hospitalCapacityBonus: "Hospital wounded capacity",
  marchQueueBonus: "Simultaneous Star Map fleet slots",
  cashProductionBonus: "Bank Cash production",
  cashGatherSpeedBonus: "Cash planet gathering speed",
  oilProductionBonus: "Oil Well production",
  oilGatherSpeedBonus: "Oil planet gathering speed",
  powerProductionBonus: "Power Plant production",
  powerGatherSpeedBonus: "Power planet gathering speed",
  troopAttackBonus: "All Army, Navy and Air attack",
  troopDefenseBonus: "All Army, Navy and Air defense",
  troopHealthBonus: "All Army, Navy and Air health",
  troopLethalityBonus: "All Army, Navy and Air lethality",
  armyAttackBonus: "Army attack in every battle",
  armyDefenseBonus: "Army defense in every battle",
  armyHealthBonus: "Army health in every battle",
  armyLethalityBonus: "Army lethality in every battle",
  navyAttackBonus: "Navy attack in every battle",
  navyDefenseBonus: "Navy defense in every battle",
  navyHealthBonus: "Navy health in every battle",
  navyLethalityBonus: "Navy lethality in every battle",
  airAttackBonus: "Air attack in every battle",
  airDefenseBonus: "Air defense in every battle",
  airHealthBonus: "Air health in every battle",
  airLethalityBonus: "Air lethality in every battle",
  marchCapacityBonus: "Maximum troops carried by each Star Map fleet",
};

function researchEffectTarget(key: string): string {
  return RESEARCH_EFFECT_TARGET[key] ?? researchEffectName(key);
}

function speedupTargetLabel(target: SpeedupTarget): string {
  if (target.kind === "construction") return `Build · ${BUILDINGS[target.key].label}`;
  if (target.kind === "training") return `Train · ${TROOPS_META[target.key].label}`;
  if (target.kind === "research") return "Research";
  return "Medical";
}

function queuePct(durationSec: number, finishAt: number, now: number): number {
  const total = Math.max(0, durationSec) * 1000;
  if (total <= 0 || finishAt <= 0) return 0;
  return Math.min(100, Math.max(0, ((total - (finishAt - now)) / total) * 100));
}

export default function Town({ address, profile, onAlliance = () => {}, onWorld, onMessages = () => {}, onShop = () => {}, onProfile = () => {} }: { address: string; profile: Profile; onAlliance?: () => void; onWorld: () => void; onMessages?: () => void; onShop?: () => void; onProfile?: () => void }) {
  const [game, setGame] = useState<GameState>(() => loadGame(address) || initGame(address));
  const [now, setNow] = useState(Date.now());
  const [msg, setMsg] = useState<string>("");
  const [away, setAway] = useState<{ cash: number; oil: number; power: number } | null>(null);
  const [trainQty, setTrainQty] = useState<Record<TroopKey, number>>({ army: 10, navy: 10, air: 10 });
  const [trainTier, setTrainTier] = useState<Record<TroopKey, number>>({ army: 1, navy: 1, air: 1 });
  const [trainingMode, setTrainingMode] = useState<Record<TroopKey, "train" | "promote">>({ army: "train", navy: "train", air: "train" });
  const [promoteFrom, setPromoteFrom] = useState<Record<TroopKey, number>>({ army: 1, navy: 1, air: 1 });
  const [healQty, setHealQty] = useState(10);
  const [researchBranch, setResearchBranch] = useState<ResearchBranch>("development");
  const [facilityOpen, setFacilityOpen] = useState<BKey | null>(null);
  const [facilityInterior, setFacilityInterior] = useState(false);
  const [facilityPanelTab, setFacilityPanelTab] = useState<"operate" | "upgrade">("operate");
  // Select a building's facility, with a click cue (read the account fresh so a
  // Profile change to sound / SFX volume applies without remounting).
  function openFacility(building: BKey) {
    const acc = loadPlayerAccount(address);
    if (acc.soundEnabled) playSfx(SFX_BUILDING_SELECT, SFX_BUILDING_SELECT_VOLUME * acc.sfxVolume);
    setFacilityOpen(building);
    setFacilityInterior(false);
    setFacilityPanelTab(game.buildings[building].lvl >= 1 ? "operate" : "upgrade");
  }
  const [commandTab, setCommandTab] = useState<"today" | "signals">("today");
  const [selectedResearchKey, setSelectedResearchKey] = useState("");
  const [gm, setGm] = useState(() => hasLocalGm(address));
  const [gmBuilding, setGmBuilding] = useState<BKey>("keep");
  const savedOnce = useRef(false);
  const [allianceRevision, setAllianceRevision] = useState(0);
  useEffect(() => {
    const syncActivity = (event: Event) => {
      const detail = (event as CustomEvent<{ address: string; game: GameState }>).detail;
      if (detail?.address === address.toLowerCase()) setGame(detail.game);
    };
    window.addEventListener("alliance:game-activity", syncActivity);
    return () => window.removeEventListener("alliance:game-activity", syncActivity);
  }, [address]);
  const [inventory, setInventory] = useState<InventoryBalance[]>([]);
  const [speedupTarget, setSpeedupTarget] = useState("");
  const [warehouseItemId, setWarehouseItemId] = useState("speedup.universal.1m");
  const [pendingSpeedup, setPendingSpeedup] = useState<{ itemId: string; target: SpeedupTarget } | null>(null);
  const [inventoryBusy, setInventoryBusy] = useState(false);
  const [authorityVersion, setAuthorityVersion] = useState(0);
  const [authorityBusy, setAuthorityBusy] = useState(false);
  const [commandBuilding, setCommandBuilding] = useState<BKey | null>(null);
  const [commandBusy, setCommandBusy] = useState(false);
  const [cityMarches, setCityMarches] = useState<LiveMarch[]>([]);
  const cityMarchesRef = useRef<LiveMarch[]>([]);
  const cityPlayerId = useRef(address);
  const [cityScouted, setCityScouted] = useState<ServerReport | null>(null);
  const [cityArrivedUntil, setCityArrivedUntil] = useState(0);
  const seenReports = useRef(new Set<string>());
  const quality = useGraphicsQuality(address);
  const replaceMarches = useCallback((marches: LiveMarch[]) => {
    cityMarchesRef.current = marches;
    setCityMarches(marches);
  }, []);
  useEffect(() => {
    cityPlayerId.current = address;
    replaceMarches([]);
    setCityScouted(null);
    setCityArrivedUntil(0);
    seenReports.current.clear();
  }, [address, replaceMarches]);
  const handleCityReport = useCallback((report: ServerReport) => {
    if (seenReports.current.has(report.id)) return;
    seenReports.current.add(report.id);
    if (seenReports.current.size > 200) seenReports.current.delete(seenReports.current.values().next().value);
    // Historical reports never replay a new alert on every page switch.
    if (recentCityScan(report, Date.now())) setCityScouted(report);
  }, []);
  const handleCityMarch = useCallback((march: LiveMarch) => {
    replaceMarches(incomingCityMarches(cityPlayerId.current, [...cityMarchesRef.current, march], Date.now()));
  }, [replaceMarches]);
  const handleCityMarchDone = useCallback((id: string) => {
    if (!cityMarchesRef.current.some(m => m.id === id)) return;
    replaceMarches(cityMarchesRef.current.filter(m => m.id !== id));
    setCityArrivedUntil(Date.now() + 4500);
  }, [replaceMarches]);
  const handleCityMarchSnapshot = useCallback((you: string, marches: LiveMarch[]) => {
    cityPlayerId.current = you;
    replaceMarches(incomingCityMarches(you, marches, Date.now()));
  }, [replaceMarches]);

  // Offline progress on entry (once).
  useEffect(() => {
    const base = loadGame(address) || initGame(address);
    const projected = project(base, Date.now());
    const gain = {
      cash: projected.res.cash - base.res.cash,
      oil: projected.res.oil - base.res.oil,
      power: projected.res.power - base.res.power,
    };
    if (gain.cash > 0 || gain.oil > 0 || gain.power > 0) setAway(gain);
    setGame(projected);
    saveGame(projected);
    savedOnce.current = true;
  }, [address]);

  useEffect(() => {
    const sync = () => { const latest = loadGame(address); if (latest) setGame(latest); setAllianceRevision((value) => value + 1); };
    window.addEventListener(ALLIANCE_CHANGED_EVENT, sync);
    window.addEventListener("storage", sync);
    return () => { window.removeEventListener(ALLIANCE_CHANGED_EVENT, sync); window.removeEventListener("storage", sync); };
  }, [address]);

  useEffect(() => {
    setGm(hasLocalGm(address));
    void loadInventory(address).then(setInventory).catch(() => {});
    let cancelled = false;
    setAuthorityBusy(true);
    const localGame = project(loadGame(address) || initGame(address), Date.now());
    const opened = openLocalWorldSession(address, localGame, Date.now(), getN());
    void ensureGameAuthority(address, opened.game, opened.session).then((server) => {
      if (!server || cancelled) return;
      setAuthorityVersion(server.authorityVersion);
      if (server.authorityVersion > 0 && server.game) {
        const authoritative = server.game as GameState;
        setGame(authoritative);
        saveGame(authoritative);
      }
    }).catch(() => {
      if (!cancelled) setMsg("Command link unavailable. Progress remains safe on this device; reconnect to continue server play.");
    }).finally(() => { if (!cancelled) setAuthorityBusy(false); });
    return () => { cancelled = true; };
  }, [address]);

  // Heartbeat: re-render every second; commit when something finishes.
  useEffect(() => {
    const id = setInterval(() => {
      const t = Date.now();
      setNow(t);
      setGame((g) => {
        const anyDone =
          BUILDING_ORDER.some((k) => g.buildings[k].finishAt > 0 && t >= g.buildings[k].finishAt) ||
          TROOP_ORDER.some((type) => g.training[type].finishAt > 0 && t >= g.training[type].finishAt) ||
          (g.healing.finishAt > 0 && t >= g.healing.finishAt) ||
          (g.researchQueue.finishAt > 0 && t >= g.researchQueue.finishAt);
        if (anyDone) { const ng = project(g, t); saveGame(ng); return ng; }
        return g;
      });
    }, 1000);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    if (!facilityOpen && !pendingSpeedup) return;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      if (pendingSpeedup) setPendingSpeedup(null);
      else if (facilityInterior) setFacilityInterior(false);
      else setFacilityOpen(null);
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [facilityInterior, facilityOpen, pendingSpeedup]);

  useEffect(() => {
    const first = cityMarches.reduce((time, march) => Math.min(time, march.arriveAt), Infinity);
    if (!Number.isFinite(first)) return;
    const timer = window.setTimeout(() => {
      const expired = cityMarchesRef.current.filter(m => m.arriveAt <= Date.now());
      if (expired.length) {
        replaceMarches(cityMarchesRef.current.filter(m => m.arriveAt > Date.now()));
        setCityArrivedUntil(Date.now() + 4500);
      }
    }, Math.max(0, first - Date.now()) + 10);
    return () => window.clearTimeout(timer);
  }, [cityMarches, replaceMarches]);

  const view = useMemo(() => project(game, now), [game, now]);

  // A failed order can leave a useful blocker message on screen. Retire it as
  // soon as the named prerequisite genuinely completes so the UI never claims
  // a finished building is still below the gate.
  useEffect(() => {
    const match = msg.match(/^(.+) Lv\.(\d+) required$/i);
    if (!match) return;
    const required = Number(match[2]);
    const key = BUILDING_ORDER.find((building) => BUILDINGS[building].label.toLowerCase() === match[1].toLowerCase());
    if (key && view.buildings[key].lvl >= required) setMsg("");
  }, [msg, view]);
  const allianceBonuses = useMemo(() => allianceGameplayBonuses(address), [address, allianceRevision]);
  const rate = prodPerHour(view);
  const troopsTotal = totalTroops(view);
  const mightScore = mightBreakdown(view);
  const buildQueues = BUILDING_ORDER.filter((building) => view.buildings[building].finishAt > 0);
  const activeTrainingQueues = TROOP_ORDER.filter((type) => view.training[type].finishAt > 0).length;
  const activeOperationQueues = buildQueues.length + activeTrainingQueues
    + (view.researchQueue.finishAt > 0 ? 1 : 0) + (view.healing.finishAt > 0 ? 1 : 0);
  const operationQueueSlots = buildQueueSlots + TROOP_ORDER.length + 3;
  const speedupTargets = activeSpeedupTargets(view);
  const selectedSpeedupTarget = speedupTargets.find((target) => speedupTargetId(target) === speedupTarget) || speedupTargets[0];
  const inventoryById = useMemo(() => new Map(inventory.map((entry) => [entry.itemId, entry.quantity])), [inventory]);
  const speedupCatalog = useMemo(() => MVP_ITEMS.filter((item) => item.status === "active" && item.category === "speedup"), []);
  const usableSpeedups = selectedSpeedupTarget ? inventory.filter((entry) => {
    const item = MVP_ITEM_BY_ID.get(entry.itemId);
    return entry.quantity > 0 && item?.status === "active" && item.category === "speedup" && speedupCompatible(item.speedupQueue, selectedSpeedupTarget);
  }) : [];
  const worldStatus = useMemo(() => {
    const stored = loadLocalWorldSession(address);
    if (!stored) {
      const energyCap = Number(getN().world?.energy?.cap) || 100;
      return { location: "RHCHAIN 4663 · HOME NOT YET CHARTED", energy: energyCap, energyCap, activeFleets: 0, fleetCap: worldMarchSlots(view) };
    }
    const player = stored.world.players[stored.playerId];
    const city = player ? stored.world.entities[player.cityId] : null;
    const home = city?.kind === "city" ? `${Math.round(city.position.x).toString().padStart(3, "0")}:${Math.round(city.position.y).toString().padStart(3, "0")}` : "---:---";
    const activeFleets = Object.values(stored.world.marches).filter((march) => march.playerId === stored.playerId && march.state !== "completed").length;
    return {
      location: `SECTOR ${stored.world.stateId.slice(-6).toUpperCase()} · HOME ${home}`,
      energy: player ? energyAt(player, now, stored.world.config) : stored.world.config.energyCap,
      energyCap: stored.world.config.energyCap,
      activeFleets,
      fleetCap: player?.marchSlots ?? worldMarchSlots(view),
    };
  }, [address, now, view]);

  function act(fn: () => { state: GameState; ok: boolean; reason?: string }) {
    if (authorityVersion > 0) {
      setMsg("SERVER TEST MODE · Only building upgrades are enabled in this batch.");
      return;
    }
    const r = fn();
    if (r.ok) { setGame(r.state); saveGame(r.state); setMsg(""); }
    else setMsg(r.reason || "Can't do that");
  }

  async function turnOnServerEconomy() {
    if (authorityBusy || authorityVersion > 0) return;
    if (!window.confirm("Move this GM city's economy to the server test lane? Local-only GM cheats will be locked.")) return;
    setAuthorityBusy(true);
    try {
      let current = await fetchServerGame(address);
      if (!current) throw new Error("server_unavailable");
      if (current.authorityVersion > 0 && current.world) {
        setAuthorityVersion(current.authorityVersion);
        if (current.game) { setGame(current.game as GameState); saveGame(current.game as GameState); }
        setMsg("GM: server economy test lane is already active.");
        return;
      }
      let enabled;
      const worldSeed = loadLocalWorldSession(address) || openLocalWorldSession(address, game, Date.now(), getN()).session;
      try {
        enabled = await enableGameAuthority(address, game, worldSeed, current.revision);
      } catch (error) {
        if (!(error instanceof Error) || error.message !== "revision_conflict") throw error;
        current = await fetchServerGame(address);
        if (!current) throw error;
        enabled = await enableGameAuthority(address, game, worldSeed, current.revision);
      }
      setAuthorityVersion(enabled.authorityVersion);
      if (enabled.game) { setGame(enabled.game as GameState); saveGame(enabled.game as GameState); }
      setMsg("GM: server economy active. Build, training, research, healing and speedups now run on the server.");
    } catch {
      setMsg("Server economy setup failed. Your local city was not changed.");
    } finally {
      setAuthorityBusy(false);
    }
  }

  async function runServerAction(type: string, args: Record<string, unknown>, reduce: () => { state: GameState; ok: boolean; reason?: string }): Promise<GameCommandResponse | undefined> {
    if (commandBusy) return;
    if (authorityVersion <= 0) { act(reduce); return; }
    const before = game;
    const optimistic = reduce();
    if (!optimistic.ok) { setMsg(optimistic.reason || "Can't do that"); return; }
    const idempotencyKey = `${type.replace(/[^a-z0-9_-]/gi, "-")}:${crypto.randomUUID()}`;
    setCommandBusy(true);
    setGame(optimistic.state);
    saveGame(optimistic.state);
    try {
      let result;
      try {
        result = await sendGameCommand(address, type, args, idempotencyKey);
      } catch {
        result = await sendGameCommand(address, type, args, idempotencyKey);
      }
      if (result.game) { setGame(result.game as GameState); saveGame(result.game as GameState); }
      setMsg(result.ok ? "" : result.reason || "Order rejected by server.");
      return result;
    } catch {
      const current = await fetchServerGame(address);
      if (current?.authorityVersion && current.game) {
        setGame(current.game as GameState);
        saveGame(current.game as GameState);
      } else {
        setGame(before);
        saveGame(before);
      }
      setMsg("Server did not confirm that order. City state was reconciled; try again.");
      return undefined;
    } finally {
      setCommandBusy(false);
    }
  }

  async function startServerUpgrade(building: BKey) {
    if (commandBusy) return;
    setCommandBuilding(building);
    try {
      await runServerAction("build.start", { building }, () => authorityVersion > 0 ? startUpgrade(game, building) : startAllianceUpgrade(building));
    } finally {
      setCommandBuilding(null);
    }
  }

  function startAllianceUpgrade(k: BKey) {
    const result = startUpgrade(game, k);
    if (!result.ok || allianceBonuses.constructionSpeedBonus <= 0) return result;
    const queue = result.state.buildings[k];
    queue.durationSec = Math.max(1, Math.ceil((queue.durationSec || 1) / (1 + allianceBonuses.constructionSpeedBonus)));
    queue.finishAt = Date.now() + queue.durationSec * 1000;
    return result;
  }

  function startAllianceHealing(quantity: number) {
    const result = startHealing(game, quantity);
    if (!result.ok || allianceBonuses.healingSpeedBonus <= 0) return result;
    result.state.healing.durationSec = Math.max(1, Math.ceil(result.state.healing.durationSec / (1 + allianceBonuses.healingSpeedBonus)));
    result.state.healing.finishAt = Date.now() + result.state.healing.durationSec * 1000;
    return result;
  }

  function gmAct(fn: (state: GameState) => GameState, message: string) {
    const next = fn(game);
    setGame(next);
    saveGame(next);
    setMsg(message);
  }

  async function useSpeedup(itemId: string, targetOverride?: SpeedupTarget) {
    const target = targetOverride || selectedSpeedupTarget;
    if (!target || inventoryBusy) return;
    const item = MVP_ITEM_BY_ID.get(itemId);
    if (!item?.speedupSeconds || !speedupCompatible(item.speedupQueue, target)) return;
    const result = applySpeedup(game, target, item.speedupSeconds, Date.now());
    if (!result.secondsApplied) { setMsg("That operation has already finished."); return; }
    setInventoryBusy(true);
    if (authorityVersion > 0) {
      try {
        const command = await runServerAction("speedup.use", { itemId, target }, () => ({ state: result.state, ok: true }));
        if (command?.inventory) {
          setInventory((current) => current.map((entry) => entry.itemId === command.inventory!.itemId
            ? { ...entry, quantity: command.inventory!.quantity, updatedAt: Date.now() }
            : entry));
        }
        if (command?.ok) setMsg(`${item.name} used. ${fmtSec(result.secondsApplied)} removed.`);
        if (!command) void loadInventory(address).then(setInventory).catch(() => {});
      } catch {
        setMsg("Speedup failed. Try again.");
      } finally { setInventoryBusy(false); }
      return;
    }
    const referenceId = `speedup:${speedupTargetId(target)}:${crypto.randomUUID()}`;
    if (import.meta.env.DEV && gm) {
      setGame(result.state);
      saveGame(result.state);
      setInventory((current) => current.map((entry) => entry.itemId === itemId
        ? { ...entry, quantity: Math.max(0, entry.quantity - 1), updatedAt: Date.now() }
        : entry));
      setMsg(`${item.name} used. ${fmtSec(result.secondsApplied)} removed.`);
      setInventoryBusy(false);
      return;
    }
    try {
      const consumed = await consumeInventoryItem(address, itemId, referenceId);
      setGame(result.state);
      saveGame(result.state);
      setInventory((current) => current.map((entry) => entry.itemId === itemId ? { ...entry, quantity: consumed.quantity, updatedAt: Date.now() } : entry));
      setMsg(`${item.name} used. ${fmtSec(result.secondsApplied)} removed.`);
    } catch (error) {
      setMsg(error instanceof Error && error.message === "insufficient_inventory" ? "No speedups left." : "Speedup failed. Try again.");
      void loadInventory(address).then(setInventory).catch(() => {});
    } finally { setInventoryBusy(false); }
  }

  function requestSpeedupUse(itemId: string, target: SpeedupTarget) {
    const item = MVP_ITEM_BY_ID.get(itemId);
    if (!item || (inventoryById.get(itemId) || 0) <= 0 || !speedupCompatible(item.speedupQueue, target)) return;
    setPendingSpeedup({ itemId, target });
  }

  function speedupRemainingMs(target: SpeedupTarget): number {
    if (target.kind === "construction") return Math.max(0, view.buildings[target.key].finishAt - now);
    if (target.kind === "training") return Math.max(0, view.training[target.key].finishAt - now);
    if (target.kind === "research") return Math.max(0, view.researchQueue.finishAt - now);
    return Math.max(0, view.healing.finishAt - now);
  }

  function renderSpeedupTray(target: SpeedupTarget, variant: "compact" | "wide" = "compact") {
    const compatible = speedupCatalog.filter((item) => speedupCompatible(item.speedupQueue, target));
    const remainingMs = target.kind === "construction" ? view.buildings[target.key].finishAt - now
      : target.kind === "training" ? view.training[target.key].finishAt - now
        : target.kind === "research" ? view.researchQueue.finishAt - now
          : view.healing.finishAt - now;
    return <section className={`speedup-tray ${variant}`} aria-label={`Speedups for ${speedupTargetLabel(target)}`}>
      <header><span>ACCELERATE</span><b className="mono">{fmtMs(remainingMs)}</b></header>
      <div className="speedup-tray-items">
        {compatible.map((item) => {
          const quantity = inventoryById.get(item.id) || 0;
          return <button key={item.id} type="button" disabled={quantity <= 0 || inventoryBusy || commandBusy} onClick={() => requestSpeedupUse(item.id, target)} aria-label={`Use ${item.name}, ${quantity} owned`} title={item.name}>
            <img src={speedupIconPath(item)} alt="" />
            <span className="mono">×{quantity}</span>
          </button>;
        })}
      </div>
    </section>;
  }

  function renderWarehouse() {
    const selectedItem = MVP_ITEM_BY_ID.get(warehouseItemId);
    const selectedQuantity = selectedItem ? inventoryById.get(selectedItem.id) || 0 : 0;
    const compatible = !!selectedItem && !!selectedSpeedupTarget && speedupCompatible(selectedItem.speedupQueue, selectedSpeedupTarget);
    return <section className="warehouse-inventory">
      <header className="warehouse-inventory-head">
        <div><span>WAREHOUSE</span><b>SPEEDUPS</b></div>
        <button className="city-interior-back" type="button" onClick={() => setFacilityInterior(false)}>← STAR GRID</button>
        <label><span>ACTIVE QUEUE</span><select aria-label="Warehouse speedup target" value={selectedSpeedupTarget ? speedupTargetId(selectedSpeedupTarget) : ""} disabled={!speedupTargets.length} onChange={(event) => setSpeedupTarget(event.target.value)}>
          {!speedupTargets.length && <option value="">NO ACTIVE QUEUES</option>}
          {speedupTargets.map((target) => <option key={speedupTargetId(target)} value={speedupTargetId(target)}>{speedupTargetLabel(target)}</option>)}
        </select></label>
      </header>
      <div className="warehouse-speedup-groups">
        {SPEEDUP_QUEUES.map((queue) => <section className={`warehouse-speedup-group ${queue}`} key={queue}>
          <header><b>{queue.toUpperCase()}</b><span>{speedupCatalog.filter((item) => item.speedupQueue === queue).reduce((sum, item) => sum + (inventoryById.get(item.id) || 0), 0)}</span></header>
          <div>{speedupCatalog.filter((item) => item.speedupQueue === queue).map((item) => {
            const quantity = inventoryById.get(item.id) || 0;
            return <button key={item.id} type="button" className={`${warehouseItemId === item.id ? "selected " : ""}${quantity <= 0 ? "empty" : ""}`} onClick={() => setWarehouseItemId(item.id)} aria-pressed={warehouseItemId === item.id}>
              <img src={speedupIconPath(item)} alt="" />
              <span className="mono">×{quantity}</span>
            </button>;
          })}</div>
        </section>)}
      </div>
      <footer className="warehouse-usebar">
        <span>{selectedItem?.name || "SELECT AN ITEM"}</span>
        <b className="mono">×{selectedQuantity}</b>
        <button type="button" disabled={!selectedItem || selectedQuantity <= 0 || !compatible || inventoryBusy || commandBusy} onClick={() => selectedItem && selectedSpeedupTarget && requestSpeedupUse(selectedItem.id, selectedSpeedupTarget)}>
          {!speedupTargets.length ? "NO ACTIVE QUEUE" : !compatible ? "INCOMPATIBLE" : "USE"}
        </button>
      </footer>
      <details className="warehouse-upgrade"><summary>WAREHOUSE UPGRADE</summary>{renderBuildingUpgrade("storage")}</details>
    </section>;
  }

  return (
    <section className="town">
      <CosmicBackdrop address={address} />
      <GameNav view="city" profile={profile} townhallLevel={view.buildings.keep.lvl} location={worldStatus.location}
        resources={view.res} incomePerHour={rate} resourceCap={capacity(view)} energy={worldStatus.energy} energyCap={worldStatus.energyCap}
        activeFleets={worldStatus.activeFleets} fleetCap={worldStatus.fleetCap} standing={troopsTotal} wounded={view.wounded}
        might={mightScore.total} onAlliance={onAlliance} onCity={() => {}} onWorld={onWorld} onMessages={onMessages} onShop={onShop} onProfile={onProfile} />


      {gm && (
        <div className="gm-panel">
          <div className="gm-panel-copy"><b>{authorityVersion > 0 ? "SERVER GM · BATCH 1" : "LOCAL GM"}</b></div>
          <div className="gm-actions">
            {authorityVersion === 0 && <button disabled={authorityBusy} onClick={() => void turnOnServerEconomy()}>{authorityBusy ? "Connecting…" : "Test server economy"}</button>}
            <button disabled={authorityVersion > 0} onClick={() => gmAct(gmFillResources, "GM: resources filled to Warehouse capacity.")}>Fill resources</button>
            <button disabled={authorityVersion > 0} onClick={() => gmAct(gmFillTroops, "GM: every trained arm filled to capacity at its highest unlocked tier.")}>Fill troops</button>
            <button disabled={authorityVersion > 0} onClick={() => gmAct(gmFinishQueues, "GM: active build, research, training and healing queues completed.")}>Finish queues</button>
            <button disabled={inventoryBusy} onClick={() => {
              setInventoryBusy(true);
              void grantGmInventory(address).then((items) => { setInventory(items); setMsg("GM: active MVP items stocked to 99."); }).catch(() => {
                if (import.meta.env.DEV) {
                  const updatedAt = Date.now();
                  setInventory(MVP_ITEMS.filter((item) => item.status === "active").map((item) => ({ itemId: item.id, quantity: 99, updatedAt })));
                  setMsg("GM: local MVP items stocked to 99.");
                  return;
                }
                setMsg("GM inventory grant failed.");
              }).finally(() => setInventoryBusy(false));
            }}>Stock MVP items</button>
            <button disabled={authorityVersion > 0} onClick={() => gmAct(gmMaxResearch, "GM: all three Research categories maxed. Account bonuses are active.")}>Max research</button>
            <button disabled={authorityVersion > 0} onClick={() => {
              const next = game.buildings.academy.lvl >= 1 ? game : gmRaiseBuilding(game, "academy");
              setGame(next);
              saveGame(next);
              setFacilityOpen("academy");
              setFacilityInterior(false);
              setMsg(game.buildings.academy.lvl >= 1 ? "" : "GM: Research Institute built at Lv.1.");
            }}>Open Research</button>
            <button onClick={() => {
              const start = Date.now();
              handleCityMarch({ id: "gm-raid-" + start, attacker: "gm-hostile", attackerName: "TEST FLEET", defender: cityPlayerId.current, defenderName: profile.name,
                from: {x:0,y:0}, to: {x:0,y:0}, departAt: start, arriveAt: start + 15_000, armyTotal: 4200 });
            }}>Test city attack</button>
            <button onClick={() => handleCityReport({ id: "gm-scan-" + Date.now(), kind: "scouted", ts: Date.now(), byName: "TEST SCOUT" })}>Test city scan</button>
            <span className="gm-building-stepper">
              <select aria-label="GM building" value={gmBuilding} onChange={(event) => setGmBuilding(event.target.value as BKey)}>
                {BUILDING_ORDER.filter(isUpgradable).map((building) => <option value={building} key={building}>{BUILDINGS[building].label} · Lv.{view.buildings[building].lvl}</option>)}
              </select>
              <button disabled={authorityVersion > 0 || view.buildings[gmBuilding].lvl >= 30 || !!buildingOperationBlockReason(view, gmBuilding)} onClick={() => gmAct((state) => gmRaiseBuilding(state, gmBuilding), `GM: ${BUILDINGS[gmBuilding].label} raised by one level.`)}>Selected building +1</button>
            </span>
            <button disabled={authorityVersion > 0 || view.buildings.keep.lvl >= 30} onClick={() => gmAct(gmRaiseTownhall, "GM: Townhall raised by one level.")}>Townhall +1</button>
            <button disabled={authorityVersion > 0} className="gm-reset" onClick={() => {
              if (!window.confirm("Reset this wallet's city? Buildings, resources, troops and queues will be cleared. Townhall returns to Lv.1.")) return;
              const next = gmResetProgress(address);
              clearLocalWorldSession(address);
              setAway(null);
              setGame(next);
              saveGame(next);
              setMsg("GM: city reset to a blank Townhall Lv.1 test state.");
            }}>Reset city</button>
            <span className="gm-off">OWNER WALLET</span>
          </div>
        </div>
      )}

      {away && (away.cash > 0 || away.oil > 0 || away.power > 0) && (
        <div className="awaynote">🌙 While you were away: <b>+{compact(displayResource(away.cash))} Cash</b>, <b>+{compact(displayResource(away.oil))} Oil</b>, <b>+{compact(displayResource(away.power))} Power</b>
          <button className="mini" onClick={() => setAway(null)}>collect</button></div>
      )}
      {msg && <div className={"gmsg" + (msg.startsWith("GM:") ? " gmmsg" : "")}>{msg}</div>}

      <div className={`city-command-layout${facilityInterior && facilityOpen === "academy" ? " research-interior" : facilityInterior && facilityOpen === "storage" ? " warehouse-interior" : ""}`}>
      <section className="operations-queue" aria-label="Operations queue">
        <header><span>OPERATIONS QUEUE</span><b className="mono">{activeOperationQueues}/{operationQueueSlots} ACTIVE</b></header>
        <div className="operation-slots">
          {Array.from({ length: buildQueueSlots }, (_, slot) => {
            const building = buildQueues[slot];
            const state = building ? view.buildings[building] : null;
            return <button className={`operation-slot${building ? " active" : " idle"}`} key={`build-${slot}`} onClick={() => building && openFacility(building)}>
              <small>BUILD {slot + 1}</small><b>{building ? `${BUILDINGS[building].label} → L${state!.lvl + 1}` : "IDLE"}</b>
              <time className="mono">{state ? fmtMs(state.finishAt - now) : "AVAILABLE"}</time>
              {building && <i className="operation-meter" style={{ width: upPct(building, state!, now) + "%" }} />}
            </button>;
          })}
          {TROOP_ORDER.map((type) => {
            const queue = view.training[type];
            const active = queue.finishAt > 0;
            const building = TRAINING_BUILDING[type];
            const detail = active ? queue.mode === "promote"
              ? `${compact(displayTroops(queue.qty))} · T${queue.sourceTier} → T${queue.tier}`
              : `${compact(displayTroops(queue.qty))} · T${queue.tier}` : "IDLE";
            return <button className={`operation-slot${active ? " active training" : " idle"}`} key={`train-${type}`} onClick={() => openFacility(building)}>
              <small>{TROOPS_META[type].label.toUpperCase()} {active && queue.mode === "promote" ? "PROMOTE" : "TRAIN"}</small><b>{detail}</b>
              <time className="mono">{active ? fmtMs(queue.finishAt - now) : "AVAILABLE"}</time>
              {active && <i className="operation-meter" style={{ width: trainPct(view, type, now) + "%" }} />}
            </button>;
          })}
          <button className={`operation-slot${view.researchQueue.finishAt > 0 ? " active research" : " idle"}`} onClick={() => view.buildings.academy.lvl >= 1 && openFacility("academy")}>
            <small>RESEARCH</small><b>{view.researchQueue.finishAt > 0 ? researchTech(view.researchQueue.tech)?.name ?? "Researching" : view.buildings.academy.lvl >= 1 ? "IDLE" : "LOCKED"}</b>
            <time className="mono">{view.researchQueue.finishAt > 0 ? fmtMs(view.researchQueue.finishAt - now) : view.buildings.academy.lvl >= 1 ? "AVAILABLE" : "RI L1"}</time>
            {view.researchQueue.finishAt > 0 && <i className="operation-meter" style={{ width: queuePct(view.researchQueue.durationSec, view.researchQueue.finishAt, now) + "%" }} />}
          </button>
          <button className={`operation-slot${view.healing.finishAt > 0 ? " active medical" : " idle"}`} onClick={() => openFacility("hospital")}>
            <small>MEDICAL</small><b>{view.healing.finishAt > 0 ? `${compact(displayTroops(view.healing.qty))} HEALING` : "IDLE"}</b>
            <time className="mono">{view.healing.finishAt > 0 ? fmtMs(view.healing.finishAt - now) : "AVAILABLE"}</time>
            {view.healing.finishAt > 0 && <i className="operation-meter" style={{ width: queuePct(view.healing.durationSec, view.healing.finishAt, now) + "%" }} />}
          </button>
          <div className="operation-slot idle rally"><small>RALLY</small><b>NO ACTIVE RALLY</b><time className="mono">AVAILABLE</time></div>
        </div>
        <div className="speedup-console">
          <div><small>SPEEDUPS</small><b>{selectedSpeedupTarget ? "Select a queue and item" : "Start an operation to use speedups"}</b></div>
          {selectedSpeedupTarget && <select aria-label="Speedup target" value={speedupTargetId(selectedSpeedupTarget)} onChange={(event) => setSpeedupTarget(event.target.value)}>
            {speedupTargets.map((target) => <option key={speedupTargetId(target)} value={speedupTargetId(target)}>{speedupTargetLabel(target)}</option>)}
          </select>}
          <div className="speedup-items">
            {usableSpeedups.map((entry) => {
              const item = MVP_ITEM_BY_ID.get(entry.itemId)!;
              return <button key={entry.itemId} disabled={inventoryBusy || commandBusy || !selectedSpeedupTarget} onClick={() => selectedSpeedupTarget && requestSpeedupUse(entry.itemId, selectedSpeedupTarget)} title={item.name} aria-label={`Use ${item.name}, ${entry.quantity} owned`}><img src={speedupIconPath(item)} alt="" /><span>×{entry.quantity}</span></button>;
            })}
            {selectedSpeedupTarget && usableSpeedups.length === 0 && <i>NO SPEEDUPS AVAILABLE</i>}
          </div>
        </div>
      </section>

      {facilityInterior && facilityOpen === "academy" && view.buildings.academy.lvl >= 1
        ? renderResearchCenter()
        : facilityInterior && facilityOpen === "storage"
          ? renderWarehouse()
          : <CityStarGrid address={address} name={profile.name} view={view} now={now} selected={facilityOpen} quality={quality} marches={cityMarches} scouted={cityScouted} arrived={cityArrivedUntil > now} onSelect={openFacility} />}

        {facilityOpen ? (() => {
          const trainingType = TROOP_ORDER.find((type) => TRAINING_BUILDING[type] === facilityOpen);
          const research = facilityOpen === "academy" && view.buildings.academy.lvl >= 1;
          const hospital = facilityOpen === "hospital";
          const warehouse = facilityOpen === "storage";
          const hasOperation = !!trainingType || research || hospital || warehouse;
          const operationLabel = trainingType ? "TRAIN" : hospital ? "MEDICAL" : research ? "RESEARCH" : "INVENTORY";
          return (
            <aside className={`facility-inspector city-facility-panel${research ? " research" : ""}${warehouse ? " warehouse" : ""}`} aria-label={BUILDINGS[facilityOpen].label}>
              <header className="facility-inspector-head">
                <div><span className="facility-head-glyph"><BuildingGlyph building={facilityOpen} /></span><b>{BUILDINGS[facilityOpen].label}</b><small>LV.{view.buildings[facilityOpen].lvl}</small></div>
                <button aria-label="Close facility" onClick={() => { setFacilityInterior(false); setFacilityOpen(null); setCommandTab("today"); }}>×</button>
              </header>
              <div className="facility-inspector-body">
                {hasOperation && <div className="facility-panel-tabs" role="tablist" aria-label={`${BUILDINGS[facilityOpen].label} view`}>
                  <button role="tab" aria-selected={facilityPanelTab === "operate"} className={facilityPanelTab === "operate" ? "active" : ""} onClick={() => setFacilityPanelTab("operate")}>{operationLabel}</button>
                  <button role="tab" aria-selected={facilityPanelTab === "upgrade"} className={facilityPanelTab === "upgrade" ? "active" : ""} onClick={() => setFacilityPanelTab("upgrade")}>UPGRADE</button>
                </div>}
                {(!hasOperation || facilityPanelTab === "upgrade") && renderBuildingUpgrade(facilityOpen)}
                {hasOperation && facilityPanelTab === "operate" && <>
                  {(research || warehouse) && !facilityInterior && <button className="city-open-interior" type="button" onClick={() => setFacilityInterior(true)}>{research ? "OPEN RESEARCH INSTITUTE" : "OPEN WAREHOUSE"}</button>}
                  {research && view.researchQueue.finishAt > 0 && renderSpeedupTray({ kind: "research" })}
                  {!research && !warehouse && (trainingType ? renderTrainer(trainingType) : hospital ? <div className="facility-hospital">{renderHospitalControls(view.buildings.hospital.finishAt > 0)}</div> : null)}
                </>}
              </div>
            </aside>
          );
        })() : (
          <aside className="facility-inspector command-feed" aria-label="Command feed">{renderCommandFeed()}</aside>
        )}
      </div>
      <MiniComms address={address} profile={profile} onOpenMessages={onMessages} onReport={handleCityReport} onMarch={handleCityMarch} onMarchDone={handleCityMarchDone} onMarchSnapshot={handleCityMarchSnapshot} />
      {pendingSpeedup && (() => {
        const item = MVP_ITEM_BY_ID.get(pendingSpeedup.itemId);
        if (!item?.speedupSeconds) return null;
        const remainingMs = speedupRemainingMs(pendingSpeedup.target);
        const appliedSeconds = Math.ceil(Math.min(item.speedupSeconds * 1000, remainingMs) / 1000);
        const quantity = inventoryById.get(item.id) || 0;
        return <div className="speedup-confirm-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setPendingSpeedup(null); }}>
          <section className="speedup-confirm" role="dialog" aria-modal="true" aria-labelledby="speedup-confirm-title">
            <header><span>ACCELERATION ORDER</span><button type="button" aria-label="Cancel speedup" onClick={() => setPendingSpeedup(null)}>×</button></header>
            <div className="speedup-confirm-item"><img src={speedupIconPath(item)} alt="" /><div><b id="speedup-confirm-title">{item.name}</b><small>{speedupTargetLabel(pendingSpeedup.target)}</small></div><em className="mono">×{quantity}</em></div>
            <div className="speedup-confirm-impact"><span><small>QUEUE</small><b className="mono">{fmtMs(remainingMs)}</b></span><i>→</i><span><small>AFTER</small><b className="mono">{fmtMs(Math.max(0, remainingMs - item.speedupSeconds * 1000))}</b></span></div>
            <p>Consume 1 item and remove <b>{fmtSec(appliedSeconds)}</b> from this queue?</p>
            <footer><button type="button" onClick={() => setPendingSpeedup(null)}>CANCEL</button><button className="confirm" type="button" disabled={quantity <= 0 || appliedSeconds <= 0 || inventoryBusy || commandBusy} onClick={() => { const pending = pendingSpeedup; setPendingSpeedup(null); void useSpeedup(pending.itemId, pending.target); }}>CONFIRM USE</button></footer>
          </section>
        </div>;
      })()}
    </section>
  );

  function renderCommandFeed() {
    const signals: Array<{ time: string; text: string }> = [];
    buildQueues.forEach((building) => signals.push({ time: fmtMs(view.buildings[building].finishAt - now), text: `${BUILDINGS[building].label} upgrade in progress` }));
    TROOP_ORDER.forEach((type) => {
      const queue = view.training[type];
      if (queue.finishAt > 0) signals.push({ time: fmtMs(queue.finishAt - now), text: `${TROOPS_META[type].label} ${queue.mode === "promote" ? "promotion" : "training"} in progress` });
    });
    if (view.researchQueue.finishAt > 0) signals.push({ time: fmtMs(view.researchQueue.finishAt - now), text: `${researchTech(view.researchQueue.tech || "")?.name ?? "Research"} in progress` });
    if (worldStatus.activeFleets > 0) signals.push({ time: "LIVE", text: `${worldStatus.activeFleets} fleet${worldStatus.activeFleets === 1 ? "" : "s"} active in the Star Map` });
    if (view.wounded > 0) signals.push({ time: "MED", text: `${compact(displayTroops(view.wounded))} wounded troops await recovery` });

    const localWorld = loadLocalWorldSession(address);
    const localPlayer = localWorld?.world.players[localWorld.playerId];
    const reports = localWorld ? Object.values(localWorld.world.reports).filter((report) => report.playerId === localWorld.playerId) : [];
    const priorities = [
      { label: "Raise Townhall to Lv.2", detail: `Lv.${view.buildings.keep.lvl} / 2`, done: view.buildings.keep.lvl >= 2 },
      { label: "Train 100 combat units", detail: `${Math.min(100, troopsTotal).toLocaleString()} / 100`, done: troopsTotal >= 100 },
      { label: "Complete a resource run", detail: reports.some((report) => report.action === "gather" && report.stage === "return") ? "COMPLETED" : "0 / 1", done: reports.some((report) => report.action === "gather" && report.stage === "return") },
      { label: "Defeat a Lv.1 Rogue", detail: `Lv.${localPlayer?.highestMonsterDefeated || 0} / 1`, done: (localPlayer?.highestMonsterDefeated || 0) >= 1 },
    ];
    const priorityDone = priorities.filter((item) => item.done).length;

    return <>
      <div className="command-feed-status"><span><i /> SYSTEMS NOMINAL</span><em>RHCHAIN 4663</em></div>
      <div className="command-feed-tabs"><button className={commandTab === "today" ? "active" : ""} onClick={() => setCommandTab("today")}>TODAY</button><button className={commandTab === "signals" ? "active" : ""} onClick={() => setCommandTab("signals")}>SIGNALS</button></div>
      {commandTab === "today" ? <div className="daily-operations">
        <header><div><small>FIRST ORDERS</small><b>Current priorities</b></div><strong className="mono">{priorityDone} / {priorities.length}</strong></header>
        <div className="daily-progress"><i style={{ width: `${priorityDone / priorities.length * 100}%` }} /></div>
        {priorities.map((item, index) => <div className={`daily-task${item.done ? " done" : ""}`} key={item.label}><span>{item.done ? "✓" : index + 1}</span><div><b>{item.label}</b><small>{item.detail}</small></div><em>{item.done ? "DONE" : "OPEN"}</em></div>)}
      </div> : <div className="command-signals"><header><small>LIVE OPERATIONS</small><b>Signal Log</b></header>{signals.length ? signals.map((signal, index) => <div className="command-signal" key={`${signal.text}-${index}`}><time className="mono">{signal.time}</time><span>{signal.text}</span></div>) : <div className="command-signal-empty"><div className="facility-empty-scan"><i /><i /><i /></div><b>All channels idle</b></div>}</div>}
    </>;
  }

  function trainPct(v: GameState, type: TroopKey, t: number) {
    const queue = v.training[type];
    const total = queue.per * queue.qty * 1000;
    if (total <= 0) return 0;
    return Math.min(100, ((total - (queue.finishAt - t)) / total) * 100);
  }

  function renderTrainer(type: TroopKey) {
    const buildingKey = TRAINING_BUILDING[type];
    const building = view.buildings[buildingKey];
    const queue = view.training[type];
    const mode = trainingMode[type];
    const unlockedTiers = unlockedTroopTiers(view, type);
    const sourceOptions = unlockedTiers.filter((candidate) => candidate < 10 && (view.troops[type][String(candidate)] ?? 0) > 0 && unlockedTiers.some((target) => target > candidate));
    const requestedSource = promoteFrom[type];
    const sourceTier = sourceOptions.includes(requestedSource) ? requestedSource : (sourceOptions[0] ?? 1);
    const requestedTier = trainTier[type];
    const tier = mode === "promote" && requestedTier <= sourceTier ? ([...unlockedTiers].reverse().find((candidate) => candidate > sourceTier) ?? requestedTier) : requestedTier;
    const quantityChoice = trainQty[type];
    const stats = troopStats(type, tier)!;
    const armCount = troopCountByType(view, type);
    const armCapacity = maxTroopsForType(view, type);
    const queueCapacity = trainQueueSize(view, type);
    const newTroopMaximum = Math.max(0, Math.min(armCapacity - armCount, queueCapacity));
    const promotionMaximum = mode === "promote"
      ? Math.max(0, Math.min(view.troops[type][String(sourceTier)] ?? 0, promotionQueueSize(view, type, sourceTier, tier)))
      : 0;
    const maxQuantity = mode === "promote" ? promotionMaximum : newTroopMaximum;
    const quantity = maxQuantity <= 0 ? 0 : Math.max(1, Math.min(quantityChoice, maxQuantity));
    const batchCost = mode === "promote"
      ? promotionBatchCost(type, sourceTier, tier, quantity)
      : troopBatchCost(type, tier, quantity);
    const secondsPerTroop = mode === "promote"
      ? promotionTimePerTroop(view, type, sourceTier, tier)
      : stats.trainTimeSec / trainSpeedMult(view, type);
    const totalSeconds = secondsPerTroop * quantity;
    const promotionAvailable = promotionUnlocked(view, type);
    const setMode = (nextMode: "train" | "promote") => {
      if (nextMode === "promote" && !promotionAvailable) return;
      setTrainingMode((current) => ({ ...current, [type]: nextMode }));
      if (nextMode === "promote") {
        const nextSource = sourceOptions[0] ?? 1;
        const nextTarget = [...unlockedTiers].reverse().find((candidate) => candidate > nextSource) ?? trainTier[type];
        setPromoteFrom((current) => ({ ...current, [type]: nextSource }));
        setTrainTier((current) => ({ ...current, [type]: nextTarget }));
      }
    };

    return (
      <div className="card trainer" key={type}>
        <div className="trainer-head">
          <div className={`trainer-arm trainer-arm-${type}`}><span>{TROOPS_META[type].emoji}</span><div><small>{type.toUpperCase()} COMMAND</small><b>{TROOPS_META[type].label}</b></div></div>
          <div className="trainer-readiness"><span><small>STANDING</small><b className="mono">{compact(displayTroops(armCount))} / {compact(displayTroops(armCapacity))}</b></span><span><small>BATCH</small><b className="mono">{compact(displayTroops(queueCapacity))}</b></span></div>
        </div>
        {queue.finishAt > 0 ? (
          <div className="training">
            <div className="tr-row"><span>{queue.mode === "promote" ? `Promoting ${compact(displayTroops(queue.qty))} T${queue.sourceTier} → T${queue.tier}` : `Training ${compact(displayTroops(queue.qty))} T${queue.tier} ${TROOPS_META[type].label}`}</span><span className="mono">{fmtMs(queue.finishAt - now)}</span></div>
            <div className="rmeter"><i style={{ width: trainPct(view, type, now) + "%" }} /></div>
            {renderSpeedupTray({ kind: "training", key: type })}
          </div>
        ) : building.finishAt > 0 ? (
          <div className="training unavailable"><div className="tr-row"><span>UPGRADING</span><span className="mono">{fmtMs(building.finishAt - now)}</span></div></div>
        ) : (
          <div className="trainctl">
            <div className="train-mode-row" role="tablist" aria-label={`${TROOPS_META[type].label} orders`}>
              <button className={mode === "train" ? "active" : ""} role="tab" aria-selected={mode === "train"} onClick={() => setMode("train")}><span>＋</span><b>TRAIN</b></button>
              <button className={mode === "promote" ? "active" : ""} role="tab" aria-selected={mode === "promote"} disabled={!promotionAvailable} onClick={() => setMode("promote")}><span>↑</span><b>PROMOTE</b>{!promotionAvailable && <small>{BUILDINGS[buildingKey].label.toUpperCase()} LV.{promotionUnlockLevel(type)}</small>}</button>
            </div>
            {mode === "promote" && (
              <div className="promote-source">
                <span className="train-label">FROM</span>
                <div className="promote-source-grid">
                  {sourceOptions.length === 0 && <span className="promotion-empty">NO ELIGIBLE UNITS</span>}
                  {sourceOptions.map((candidate) => <button className={sourceTier === candidate ? "active" : ""} key={candidate} onClick={() => {
                    setPromoteFrom((current) => ({ ...current, [type]: candidate }));
                    if (trainTier[type] <= candidate) {
                      const nextTarget = [...unlockedTiers].reverse().find((next) => next > candidate) ?? trainTier[type];
                      setTrainTier((current) => ({ ...current, [type]: nextTarget }));
                    }
                  }}><b>T{candidate}</b><small>{compact(displayTroops(view.troops[type][String(candidate)] ?? 0))}</small></button>)}
                </div>
              </div>
            )}
            <div className="train-section">
              <span className="train-label">{mode === "promote" ? "TO" : "TIER"}</span>
              <div className="qty tier-row">
                {Array.from({ length: 10 }, (_, i) => i + 1).map((candidate) => {
                  const candidateStats = troopStats(type, candidate)!;
                  const requiredLevel = candidateStats.unlockAtTrainingBuilding;
                  const unlocked = requiredLevel <= building.lvl && (mode === "train" || candidate > sourceTier);
                  const title = mode === "promote" && candidate <= sourceTier
                    ? `Target must be higher than T${sourceTier}`
                    : unlocked ? `T${candidate}` : `Requires ${BUILDINGS[buildingKey].label} Lv.${requiredLevel}`;
                  return <button key={candidate} disabled={!unlocked} title={title} className={"chip tier-chip" + (tier === candidate ? " on" : "")} onClick={() => setTrainTier((current) => ({ ...current, [type]: candidate }))}>T{candidate}</button>;
                })}
              </div>
            </div>
            <div className="train-section train-bottom">
              <div className="train-slider-copy"><span>QUANTITY</span><b className="mono">{compact(displayTroops(quantity))} / {compact(displayTroops(maxQuantity))}</b></div>
              <div className="train-slider-row">
                <span className="mono">{maxQuantity > 0 ? compact(displayTroops(1)) : "0"}</span>
                <input aria-label={`${TROOPS_META[type].label} quantity`} type="range" min={maxQuantity > 0 ? 1 : 0} max={maxQuantity} step={1} value={quantity} disabled={maxQuantity <= 0} onChange={(event) => setTrainQty((current) => ({ ...current, [type]: Number(event.target.value) }))} />
                <span className="mono">{compact(displayTroops(maxQuantity))}</span>
              </div>
              <div className="troop-order-summary"><div><small>LOADOUT</small><b className="mono">T{tier} · ATK {stats.attack} · DEF {stats.defense} · MIGHT {stats.power}</b></div>{quantity > 0 && <div><small>ORDER</small><b className="mono">{RES_ORDER.map((r) => batchCost[r] ? `${compact(displayResource(batchCost[r]!))}${RES[r].emoji} ` : "").join("")}· ◷ {fmtSec(totalSeconds)}</b></div>}</div>
              <button className="cta sm" disabled={quantity <= 0 || commandBusy} onClick={() => void (mode === "promote"
                ? runServerAction("promotion.start", { troop: type, sourceTier, targetTier: tier, quantity }, () => startPromote(game, type, sourceTier, tier, quantity))
                : runServerAction("training.start", { troop: type, tier, quantity }, () => startTrain(game, type, tier, quantity)))}>
                {quantity <= 0 ? (mode === "promote" ? "No eligible troops" : "Capacity full") : mode === "promote" ? `Promote ${compact(displayTroops(quantity))} T${sourceTier} → T${tier}` : `Train ${compact(displayTroops(quantity))} T${tier}`}
              </button>
            </div>
          </div>
        )}
      </div>
    );
  }

  function renderResearchCenter() {
    const config = researchConfig();
    const branch = config.branches[researchBranch];
    const technologies = researchTechs(researchBranch);
    const layers = researchTreeLayers(researchBranch);
    const maximumColumns = researchBranch === "battle" ? 5 : 3;
    const visualLayers = layers.flatMap((layer) => Array.from(
      { length: Math.ceil(layer.length / maximumColumns) },
      (_, index) => layer.slice(index * maximumColumns, (index + 1) * maximumColumns),
    ));
    const nodeWidth = researchBranch === "battle" ? 138 : 150;
    const nodeHeight = 52;
    const columnGap = 18;
    const rowGap = 32;
    const graphPadding = 24;
    const graphWidth = Math.max(720, maximumColumns * nodeWidth + Math.max(0, maximumColumns - 1) * columnGap + graphPadding * 2);
    const graphHeight = graphPadding * 2 + visualLayers.length * nodeHeight + Math.max(0, visualLayers.length - 1) * rowGap;
    const positions = new Map<string, { x: number; y: number; tech: any }>();
    visualLayers.forEach((layer, depth) => {
      const rowWidth = layer.length * nodeWidth + Math.max(0, layer.length - 1) * columnGap;
      const rowStart = (graphWidth - rowWidth) / 2;
      layer.forEach((tech, column) => {
      positions.set(tech.key, {
        x: rowStart + column * (nodeWidth + columnGap),
        y: graphPadding + depth * (nodeHeight + rowGap),
        tech,
      });
      });
    });
    const selectedTech = technologies.find((tech) => tech.key === selectedResearchKey)
      ?? technologies.find((tech) => researchLevel(view, tech.key) < tech.maxLevel && !researchBlockReason(view, tech.key))
      ?? technologies[0];
    const queue = view.researchQueue;
    const queueTech = queue.tech ? researchTech(queue.tech) : null;
    const researchedLevels = technologies.reduce((sum, tech) => sum + researchLevel(view, tech.key), 0);
    const accountModifiers = accountResearchModifiers(view);
    const activeEffects = Object.entries(RESEARCH_EFFECT_BRANCH)
      .filter(([key, category]) => category === researchBranch && (accountModifiers[key] ?? 0) > 0);

    return (
      <section className="research-center">
        <div className="research-titlebar">
          <button className="city-interior-back" type="button" onClick={() => setFacilityInterior(false)}>← STAR GRID</button>
          <span>PROGRESS</span>
          <div className="research-summary mono"><b>{researchedLevels}/{branch.totals.levels}</b></div>
        </div>

        {queue.finishAt > 0 && queueTech ? (
          <div className="research-queue active">
            <div><span>RESEARCHING</span><b>{queueTech.name} → Lv.{queue.targetLevel}</b></div>
            <div className="research-queue-time mono">{fmtMs(queue.finishAt - now)}</div>
            <div className="rmeter"><i style={{ width: Math.min(100, Math.max(0, ((queue.durationSec * 1000 - (queue.finishAt - now)) / (queue.durationSec * 1000)) * 100)) + "%" }} /></div>
            {renderSpeedupTray({ kind: "research" }, "wide")}
          </div>
        ) : <div className="research-queue"><div><span>QUEUE</span><b>IDLE</b></div></div>}

        <div className="research-tabs">
          {(Object.keys(config.branches) as ResearchBranch[]).map((key) => {
            const meta = config.branches[key];
            return <button key={key} className={researchBranch === key ? "on" : ""} onClick={() => { setResearchBranch(key); setSelectedResearchKey(""); }}><b>{meta.label}</b></button>;
          })}
        </div>
        {selectedTech && renderResearchDetail(selectedTech)}

        <div className="research-tree-head">
          <div><b>{branch.label.toUpperCase()} TREE</b></div>
          <div className="research-tree-legend"><span className="complete">MAXED</span><span className="available">AVAILABLE</span><span className="locked">LOCKED</span></div>
        </div>
        <div className="research-graph-scroll">
          <div className="research-graph" style={{ width: graphWidth, height: graphHeight }}>
            <svg className="research-links" width={graphWidth} height={graphHeight} viewBox={`0 0 ${graphWidth} ${graphHeight}`} aria-hidden="true">
              {technologies.flatMap((tech) => {
                const target = positions.get(tech.key);
                if (!target) return [];
                return (tech.requirements ?? []).flatMap((requirement: any) => {
                  const source = positions.get(requirement.tech);
                  if (!source) return [];
                  const startX = source.x + nodeWidth / 2;
                  const startY = source.y + nodeHeight;
                  const endX = target.x + nodeWidth / 2;
                  const endY = target.y;
                  const middleY = startY + (endY - startY) / 2;
                  const met = researchLevel(view, requirement.tech) >= requirement.level;
                  const focused = selectedTech.key === tech.key || selectedTech.key === requirement.tech;
                  return <path key={`${requirement.tech}-${tech.key}`} className={`${met ? "met " : ""}${focused ? "focused" : ""}`} d={`M ${startX} ${startY} V ${middleY} H ${endX} V ${endY}`} />;
                });
              })}
            </svg>
            {technologies.map((tech) => {
              const position = positions.get(tech.key)!;
              const current = researchLevel(view, tech.key);
              const complete = current >= tech.maxLevel;
              const reason = complete ? null : researchBlockReason(view, tech.key);
              const nextLevel = Math.min(tech.maxLevel, current + 1);
              const row = researchLevelRow(tech.key, nextLevel);
              const state = complete ? "complete" : reason ? "locked" : "available";
              return <button
                type="button"
                key={tech.key}
                className={`research-tree-node ${state}${selectedTech.key === tech.key ? " selected" : ""}`}
                style={{ left: position.x, top: position.y, width: nodeWidth, height: nodeHeight }}
                onClick={() => setSelectedResearchKey(tech.key)}
                aria-label={`${tech.name}, level ${current} of ${tech.maxLevel}`}
              >
                <span className="research-tree-node-name">{tech.name}</span>
                <span className="research-tree-node-meta"><i>RI {row?.academyLevel ?? 30}</i><b className="mono">{complete ? "MAX" : `${current}/${tech.maxLevel}`}</b></span>
              </button>;
            })}
          </div>
        </div>
        {activeEffects.length > 0 && <div className="research-account-effects">
          <div className="research-account-title"><b>ACTIVE BONUSES</b></div>
          <div className="research-account-grid">{activeEffects.map(([key]) => {
            const value = accountModifiers[key];
            const flat = key === "trainingCapacityBonus" || key === "hospitalCapacityBonus" || key === "marchQueueBonus";
            const detail = key === "marchQueueBonus"
              ? `${worldMarchSlots(view)} total World queues`
              : key === "marchCapacityBonus"
                ? `${compact(displayTroops(accountMarchCapacity(view)))} current march cap`
                : flat ? `+${compact(displayTroops(value))}` : `+${(value * 100).toFixed(value * 100 < 10 ? 1 : 0)}%`;
            return <div key={key}><span><strong>{researchEffectName(key)}</strong><small>{researchEffectTarget(key)}</small></span><b className="mono">{detail}</b></div>;
          })}</div>
        </div>}
      </section>
    );
  }

  function renderResearchDetail(tech: any) {
    const current = researchLevel(view, tech.key);
    const complete = current >= tech.maxLevel;
    const nextLevel = Math.min(tech.maxLevel, current + 1);
    const row = researchLevelRow(tech.key, nextLevel);
    const cost = researchCost(tech.key, nextLevel);
    const reason = complete ? null : researchBlockReason(view, tech.key);
    const resourcesMet = hasResources(cost);
    const currentEffect = current > 0 ? researchLevelRow(tech.key, current)?.effect : null;
    const nextEffect = row?.effect;
    const effectKey = nextEffect?.key ?? currentEffect?.key ?? "";
    const currentEffectLabel = currentEffect ? effectLabel(currentEffect) : nextEffect?.unit === "percent" ? "+0%" : "+0";
    return (
      <article className={`research-detail ${complete ? "complete" : reason ? "locked" : "available"}`}>
        <div className="research-detail-copy"><h3>{tech.name}</h3></div>
        <div className="research-detail-progress"><small>AFFECTS</small><strong>{researchEffectTarget(effectKey)}</strong><div className="research-effect"><span><i>CURRENT</i><b>{currentEffectLabel}</b></span>{!complete && nextEffect && <><em>→</em><span className="next"><i>LV.{nextLevel}</i><b>{effectLabel(nextEffect)}</b></span></>}</div><div className="research-level-count mono">LEVEL {current}/{tech.maxLevel}</div></div>
        {!complete && <div className="research-detail-gates">
          {view.buildings.academy.lvl < row.academyLevel && <span>🔒 Research Institute Lv.{row.academyLevel}</span>}
          {(tech.requirements ?? []).filter((requirement: any) => researchLevel(view, requirement.tech) < requirement.level).map((requirement: any) => <span key={requirement.tech}>🔒 {researchTech(requirement.tech)?.name} Lv.{requirement.level}</span>)}
        </div>}
        {!complete && <div className="research-detail-action"><div className="research-cost mono">{renderResourceCosts(cost)}<span>◷ {fmtSec(row.timeSec)}</span></div><button className={resourcesMet && !reason ? "ready" : ""} disabled={!!reason || commandBusy} onClick={() => void runServerAction("research.start", { tech: tech.key }, () => startResearch(game, tech.key))}>
          {complete ? "MAXED" : reason ?? `Research Lv.${nextLevel}`}
        </button></div>}
        {complete && <div className="research-detail-maxed">MAXED</div>}
      </article>
    );
  }

  function renderBuilding(k: BKey) {
    const b = view.buildings[k];
    const meta = BUILDINGS[k];
    const locked = !isUnlocked(view, k);
    const upgradable = isUpgradable(k);
    const upgrading = b.finishAt > 0;
    const target = b.lvl + 1;
    const atMaximum = b.lvl >= maxLevel(k);
    const atCap = !locked && b.lvl >= capForLevel(view, k);
    const cost = upgradable ? upgradeCost(k, target) : {};
    const missingRequirements = k === "keep" ? missingTownhallPrerequisites(view, target) : [];
    const activeTrainingType = TROOP_ORDER.find((type) => TRAINING_BUILDING[type] === k);
    const selectableBuilding = !locked && (upgradable || k === "academy" || k === "hospital" || !!activeTrainingType);
    const occupiedReason = k === "academy" && view.researchQueue.finishAt > 0
      ? "Researching"
      : activeTrainingType && view.training[activeTrainingType].finishAt > 0
        ? view.training[activeTrainingType].mode === "promote" ? "Promoting" : "Training"
        : k === "hospital" && view.healing.finishAt > 0 ? "Healing"
        : "";
    const resourcesMet = hasResources(cost);
    const buildersBusy = activeUpgrades(view) >= buildQueueSlots;
    const upgradeReady = resourcesMet && !buildersBusy && missingRequirements.length === 0 && !occupiedReason;
    const status = occupiedReason || (buildersBusy ? "BUILDERS BUSY" : missingRequirements.length ? "REQUIREMENTS" : resourcesMet ? "READY" : "NEEDS RESOURCES");

    return (
      <div className={`bcard${locked ? " locked" : ""}${selectableBuilding ? " facility" : ""}${facilityOpen === k ? " selected" : ""}`} key={k}
        role={selectableBuilding ? "button" : undefined}
        aria-label={selectableBuilding ? `${meta.label} details` : undefined}
        tabIndex={selectableBuilding ? 0 : undefined}
        onClick={selectableBuilding ? () => openFacility(k) : undefined}
        onKeyDown={selectableBuilding ? (event) => { if (event.key === "Enter" || event.key === " ") openFacility(k); } : undefined}>
        <header className="bcard-head">
          <div className="bicon"><BuildingGlyph building={k} /></div>
          <div className="brow1"><span className="blabel">{meta.label}</span>
            <span className="blvl">{locked || !upgradable ? "" : b.lvl === 0 ? "—" : "Lv." + b.lvl}</span></div>
        </header>
        <div className="bmain">
          {locked ? (
            <div className="bgate" title={`Unlocks at Townhall Lv.${unlockAtKeep(k)}`}>🔒 TH {unlockAtKeep(k)}</div>
          ) : !upgradable ? (
            <div className="bgate">SOON</div>
          ) : upgrading ? (
            <div className="bprog">
              <div className="rmeter"><i style={{ width: upPct(k, b, now) + "%" }} /></div>
              <span className="mono">{fmtMs(b.finishAt - now)}</span>
            </div>
          ) : atMaximum ? (
            <div className="bgate maxed">MAX LEVEL</div>
          ) : atCap ? (
            <div className="bgate" title="Upgrade Townhall first">🔒 TH {b.lvl + 1}</div>
          ) : (
            <div className={`bcard-state ${upgradeReady ? "ready" : "blocked"}`}><b>{status}</b><i>→</i></div>
          )}
        </div>
      </div>
    );
  }

  function renderEconomyBuilding(k: BKey) {
    const building = view.buildings[k];
    const meta = BUILDINGS[k];
    const resource = meta.produces!;
    const locked = !isUnlocked(view, k);
    const upgrading = building.finishAt > 0;
    const target = building.lvl + 1;
    const atMaximum = building.lvl >= maxLevel(k);
    const atCap = !locked && building.lvl >= capForLevel(view, k);
    const cost = upgradeCost(k, target);
    const resourcesMet = hasResources(cost);
    const buildersBusy = activeUpgrades(view) >= buildQueueSlots;
    const upgradeReady = resourcesMet && !buildersBusy;
    return (
      <article className={`economy-node ${resource}${locked ? " locked" : ""}${facilityOpen === k ? " selected" : ""}`} key={k}
        role={!locked ? "button" : undefined} aria-label={!locked ? `${meta.label} details` : undefined} tabIndex={!locked ? 0 : undefined}
        onClick={!locked ? () => openFacility(k) : undefined}
        onKeyDown={!locked ? (event) => { if (event.key === "Enter" || event.key === " ") openFacility(k); } : undefined}>
        <div className="economy-node-main">
          <span className="economy-glyph"><BuildingGlyph building={k} /></span>
          <div><small>{RES[resource].label}</small><b>{meta.label}</b></div>
          <strong className="mono">LV.{building.lvl}</strong>
        </div>
        <div className="economy-output"><span className="mono">+{compact(displayResource(rate[resource]))}/HR</span><i /></div>
        {locked ? <div className="economy-gate mono">🔒 TH {unlockAtKeep(k)}</div>
          : upgrading ? <div className="economy-progress"><div className="rmeter"><i style={{ width: upPct(k, building, now) + "%" }} /></div><span className="mono">{fmtMs(building.finishAt - now)}</span></div>
            : atMaximum ? <div className="economy-gate maxed mono">MAX LEVEL</div>
              : atCap ? <div className="economy-gate mono">🔒 TH {building.lvl + 1}</div>
              : <div className={`economy-state ${upgradeReady ? "ready" : "blocked"}`}><b>{buildersBusy ? "BUILDERS BUSY" : resourcesMet ? "READY" : "NEEDS RESOURCES"}</b><i>→</i></div>}
      </article>
    );
  }

  function renderBuildingUpgrade(k: BKey) {
    const building = view.buildings[k];
    const upgradable = isUpgradable(k);
    const locked = !isUnlocked(view, k);
    const target = building.lvl + 1;
    const atMaximum = building.lvl >= maxLevel(k);
    const atCap = !locked && building.lvl >= capForLevel(view, k);
    const upgrading = building.finishAt > 0;
    const cost = upgradable ? upgradeCost(k, target) : {};
    const missingRequirements = k === "keep" ? missingTownhallPrerequisites(view, target) : [];
    const operationBlock = buildingOperationBlockReason(view, k);
    const buildersBusy = activeUpgrades(view) >= buildQueueSlots;
    const resourcesMet = hasResources(cost);
    const ready = upgradable && !locked && !atCap && !upgrading && !operationBlock && !buildersBusy && resourcesMet && missingRequirements.length === 0;
    const blockLabel = locked ? `TH ${unlockAtKeep(k)} REQUIRED`
      : !upgradable ? "COMING SOON"
        : atMaximum ? "MAX LEVEL"
          : atCap ? `TH ${building.lvl + 1} REQUIRED`
          : operationBlock ? operationBlock.toUpperCase()
            : buildersBusy ? "BUILDERS BUSY"
              : missingRequirements.length ? "REQUIREMENTS NOT MET"
                : !resourcesMet ? "INSUFFICIENT RESOURCES"
                  : "READY";

    const helpRequest = upgrading ? openHelpFor(profile, "building", k) : null;
    void allianceRevision;
    return <section className={`upgrade-inspector${ready ? " ready" : " blocked"}`}>
      <div className="upgrade-inspector-level">
        <span>{atMaximum ? "STATUS" : "NEXT"}</span>
        <b>{atMaximum ? `LV.${building.lvl} · MAX` : building.lvl === 0 ? "BUILD" : `LV.${building.lvl} → LV.${target}`}</b>
        {upgradable && !atCap && <time className="mono">◷ {fmtSec(Math.ceil(upgradeTimeSec(k, target) / (1 + allianceBonuses.constructionSpeedBonus)))}</time>}
      </div>
      {upgradable && !atCap && <div className="upgrade-resource-grid">
        {RES_ORDER.filter((resource) => (cost[resource] ?? 0) > 0).map((resource) => {
          const required = cost[resource] ?? 0;
          const enough = view.res[resource] >= required;
          return <div className={`upgrade-resource ${enough ? "enough" : "short"}`} key={resource}>
            <span>{RES[resource].emoji} {RES[resource].label}</span>
            <b className="mono">{compact(displayResource(required))}</b>
            <small className="mono">{compact(displayResource(view.res[resource]))} AVAILABLE</small>
          </div>;
        })}
      </div>}
      {!!missingRequirements.length && <div className="upgrade-requirements">
        {missingRequirements.map((requirement) => <span key={requirement.key}>🔒 {BUILDINGS[requirement.key].label} LV.{requirement.requiredLevel}</span>)}
      </div>}
      {upgrading ? <><div className="upgrade-inspector-progress"><div className="rmeter"><i style={{ width: upPct(k, building, now) + "%" }} /></div><b className="mono">{fmtMs(building.finishAt - now)}</b></div><button className="alliance-help-request" disabled={!!helpRequest} onClick={() => { const result = requestAllianceHelp(profile, "building", k, `${BUILDINGS[k].label} LV.${target}`); setMsg(result.reason || "Help request sent to your alliance."); setAllianceRevision((value) => value + 1); }}>{helpRequest ? `ALLIANCE HELP · ${helpRequest.helpers.length}/25` : "REQUEST ALLIANCE HELP"}</button>{renderSpeedupTray({ kind: "construction", key: k })}</>
        : <button className={ready ? "ready" : "blocked"} disabled={!ready || commandBuilding !== null} onClick={() => void startServerUpgrade(k)}><span>{commandBuilding === k ? "SENDING ORDER" : blockLabel}</span>{ready && commandBuilding !== k && <b>{building.lvl === 0 ? "BUILD" : "UPGRADE"} →</b>}</button>}
    </section>;
  }

  function hasResources(cost: Partial<Record<ResKey, number>>): boolean {
    return RES_ORDER.every((resource) => view.res[resource] >= (cost[resource] ?? 0));
  }

  function renderResourceCosts(cost: Partial<Record<ResKey, number>>) {
    return <span className="upgrade-costs">{RES_ORDER.filter((resource) => (cost[resource] ?? 0) > 0).map((resource) => {
      const required = cost[resource] ?? 0;
      const enough = view.res[resource] >= required;
      return <span className={`upgrade-cost ${enough ? "enough" : "short"}`} key={resource} title={`${compact(displayResource(view.res[resource]))} available`}><i>{RES[resource].emoji}</i><b className="mono">{compact(displayResource(required))}</b></span>;
    })}</span>;
  }

  function renderHospitalControls(upgrading: boolean) {
    const hospitalCap = hospitalCapacity(view);
    const quantity = view.wounded <= 0 ? 0 : Math.max(1, Math.min(healQty, view.wounded));
    const cost = healingBatchCost(quantity);
    if (view.healing.finishAt > 0) {
      const total = Math.max(1, view.healing.durationSec * 1000);
      const progress = Math.min(100, Math.max(0, ((total - (view.healing.finishAt - now)) / total) * 100));
      const helpRequest = openHelpFor(profile, "healing", "hospital");
      void allianceRevision;
      return <div className="hospital-queue"><div className="tr-row"><span>Healing {compact(displayTroops(view.healing.qty))}</span><span className="mono">{fmtMs(view.healing.finishAt - now)}</span></div><div className="rmeter"><i style={{ width: progress + "%" }} /></div><button className="alliance-help-request" disabled={!!helpRequest} onClick={() => { const result = requestAllianceHelp(profile, "healing", "hospital", `Heal ${compact(displayTroops(view.healing.qty))} wounded`); setMsg(result.reason || "Help request sent to your alliance."); setAllianceRevision((value) => value + 1); }}>{helpRequest ? `ALLIANCE HELP · ${helpRequest.helpers.length}/25` : "REQUEST ALLIANCE HELP"}</button>{renderSpeedupTray({ kind: "healing" })}</div>;
    }
    return <div className="hospital-controls">
      <div className="hospital-stats mono"><span>Wounded {compact(displayTroops(view.wounded))}/{compact(displayTroops(hospitalCap))}</span><span>Healing speed ×{(healingSpeedMult(view) * (1 + allianceBonuses.healingSpeedBonus)).toFixed(2)}</span></div>
      {view.wounded > 0 && !upgrading && <>
        <div className="train-slider-row"><span className="mono">{compact(displayTroops(1))}</span><input aria-label="Healing quantity" type="range" min={1} max={view.wounded} step={1} value={quantity} onChange={(event) => setHealQty(Number(event.target.value))} /><span className="mono">{compact(displayTroops(view.wounded))}</span></div>
        <div className="bcost mono">Heal {compact(displayTroops(quantity))}: {RES_ORDER.map((resource) => cost[resource] ? `${compact(displayResource(cost[resource]!))}${RES[resource].emoji} ` : "").join("")}· ◷ {fmtSec(Math.ceil(healingDurationSec(view, quantity) / (1 + allianceBonuses.healingSpeedBonus)))}</div>
        <button className="academy-open" disabled={commandBusy} onClick={() => void runServerAction("healing.start", { quantity }, () => authorityVersion > 0 ? startHealing(game, quantity) : startAllianceHealing(quantity))}>Heal wounded</button>
      </>}
    </div>;
  }

  function upPct(k: BKey, b: { lvl: number; finishAt: number; durationSec?: number }, t: number) {
    const total = (b.durationSec || upgradeTimeSec(k, b.lvl + 1)) * 1000;
    if (total <= 0) return 0;
    return Math.min(100, ((total - (b.finishAt - t)) / total) * 100);
  }
}
