import { useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import BuildingGlyph from "./BuildingGlyph";
import PlanetOrbitPreview from "./PlanetOrbitPreview";
import {
  BUILDINGS, BUILDING_ORDER, GameState, BKey, isUnlocked, unlockAtKeep,
} from "./lib/game";
import { CITY_DISTRICTS, cityQueue, mountCityFx } from "./lib/city-fx";
import type { LiveMarch, ServerReport } from "./lib/realtime";
import {
  COSMETIC_VAULT_CHANGED_EVENT, loadCosmeticVault, type CosmeticLoadout,
} from "./lib/player-account";
import type { GraphicsQuality } from "./lib/graphics-tier";

function queueProgress(durationSec: number | undefined, finishAt: number, now: number) {
  const total = Math.max(0, durationSec || 0) * 1000;
  if (!total || finishAt <= 0) return 0;
  return Math.min(100, Math.max(0, ((total - (finishAt - now)) / total) * 100));
}

function timeLeft(finishAt: number, now: number) {
  const seconds = Math.max(0, Math.ceil((finishAt - now) / 1000));
  const minutes = Math.floor(seconds / 60);
  const rest = seconds % 60;
  return minutes > 99 ? `${Math.floor(minutes / 60)}H` : `${String(minutes).padStart(2, "0")}:${String(rest).padStart(2, "0")}`;
}

function loadout(address: string): CosmeticLoadout {
  return loadCosmeticVault(address).equipped;
}

export default function CityStarGrid({
  address, name, view, now, selected, quality, marches, scouted, arrived, onSelect,
}: {
  address: string;
  name: string;
  view: GameState;
  now: number;
  selected: BKey | null;
  quality: GraphicsQuality;
  marches: LiveMarch[];
  scouted: ServerReport | null;
  arrived: boolean;
  onSelect: (building: BKey) => void;
}) {
  const [equipped, setEquipped] = useState(() => loadout(address));
  useEffect(() => {
    const sync = () => setEquipped(loadout(address));
    sync();
    window.addEventListener(COSMETIC_VAULT_CHANGED_EVENT, sync);
    return () => window.removeEventListener(COSMETIC_VAULT_CHANGED_EVENT, sync);
  }, [address]);

  const mapRef = useRef<HTMLDivElement>(null);
  const coreRef = useRef<HTMLButtonElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const stateRef = useRef({ view, marches, quality });
  stateRef.current = { view, marches, quality };
  useEffect(() => {
    if (!mapRef.current || !coreRef.current || !canvasRef.current) return;
    return mountCityFx(mapRef.current, coreRef.current, canvasRef.current, () => stateRef.current);
  }, [quality.tier, quality.dprCap]);
  const positions = useMemo(() => CITY_DISTRICTS.flatMap(district => district.ids.map(building => ({ building: building as BKey, district }))), []);
  const incoming = marches.filter(m => m.arriveAt > now).sort((a,b) => a.arriveAt - b.arriveAt);
  const scoutActive = scouted && now - scouted.ts < 4500;
  const moving = quality.fallbackAnim && quality.tier !== "low";
  const staticPlanet = quality.tier === "low" || !quality.bgAnimate;


  return <section className={`city-star-grid city-quality-${quality.tier}${moving ? " has-motion" : " is-still"}${incoming.length ? " threat-inbound" : ""}${scoutActive ? " city-scouted" : ""}`} aria-label="Star Grid">
    <header className="city-star-grid-head"><span><i /> STAR GRID</span><b>{BUILDING_ORDER.filter(key => isUnlocked(view, key)).length} SYSTEMS</b></header>
    {(incoming.length > 0 || scoutActive || arrived) && <div className={`city-threat-banner ${incoming.length ? "" : scoutActive ? "scout" : "done"}`} role="alert">
      {incoming.length ? <><b>INCOMING ATTACK</b><span>{incoming[0].attackerName} · {incoming[0].armyTotal.toLocaleString()} TROOPS</span><em>ETA {timeLeft(incoming[0].arriveAt, now)}{incoming.length > 1 ? " · +" + (incoming.length - 1) + " MORE" : ""}</em></> :
        scoutActive ? <b>YOU WERE SCANNED · {scouted.byName || "UNKNOWN COMMANDER"}</b> : <b>ATTACK ARRIVED · MESSAGES</b>}
    </div>}
    <div className="city-star-grid-map" ref={mapRef}>
      <div className="city-grid-floor" aria-hidden="true" />
      <canvas ref={canvasRef} className="city-claude-fx" aria-label="City districts">
        {CITY_DISTRICTS.map(d => <span key={d.label}>{d.label} · {d.ids.length}</span>)}
      </canvas>
      <button ref={coreRef} className={`city-grid-core${selected === "keep" ? " selected" : ""}`} type="button" onClick={() => onSelect("keep")} aria-label={`Civilization Core level ${view.buildings.keep.lvl}`}>
        <PlanetOrbitPreview skin={equipped.planetBody} halo={equipped.halo} orbit={equipped.orbit} chrome={false} fitAssembly transparent className="city-grid-core-planet" staticPreview={staticPlanet} />
        <span><small>CIVILIZATION</small><b>{name}</b><em>{view.buildings.keep.lvl}</em></span>
      </button>

      {positions.map(({building, district}) => {
        const state = view.buildings[building];
        const locked = !isUnlocked(view, building);
        const operation = cityQueue(view, building);
        const busy = operation.finishAt > now;
        const progress = busy ? queueProgress(operation.durationSec, operation.finishAt, now) : 0;
        return <button
          className={`city-grid-node district-${district.label.toLowerCase().split(" ")[0]}${locked ? " locked" : ""}${busy ? " busy" : ""}${selected === building ? " selected" : ""}`}
          type="button"
          key={building}
          data-id={building}
          disabled={locked}
          onClick={() => onSelect(building)}
          style={{ color: district.color, "--city-progress": `${progress * 3.6}deg` } as CSSProperties}
          aria-label={locked ? `${BUILDINGS[building].label}, unlocks at Core ${unlockAtKeep(building)}` : `${BUILDINGS[building].label}, level ${state.lvl}`}
        >
          {building === "watchtower" && <><i className="city-watch-radar" /><i key={scouted?.id || "r1"} className="city-watch-ripple" /><i key={(scouted?.id || "r2") + "-2"} className="city-watch-ripple r2" /></>}
          <i className="city-grid-node-status" />
          <span className="city-grid-node-icon"><BuildingGlyph building={building} /></span>
          <strong>{locked ? "—" : state.lvl}</strong>
          <b>{BUILDINGS[building].label}</b>
          {busy && <time>{timeLeft(operation.finishAt, now)}</time>}
        </button>;
      })}
    </div>
  </section>;
}
