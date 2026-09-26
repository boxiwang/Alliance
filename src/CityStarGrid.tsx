import { useEffect, useMemo, useState, type CSSProperties } from "react";
import BuildingGlyph from "./BuildingGlyph";
import PlanetOrbitPreview from "./PlanetOrbitPreview";
import {
  BUILDINGS, BUILDING_ORDER, GameState, BKey, displayResource, isUnlocked, prodPerHour, unlockAtKeep,
} from "./lib/game";
import { compact } from "./lib/format";
import {
  COSMETIC_VAULT_CHANGED_EVENT, loadCosmeticVault, type CosmeticLoadout,
} from "./lib/player-account";
import type { GraphicsQuality } from "./lib/graphics-tier";

export type CityThreat = {
  phase: "inbound" | "engaged";
  id: string;
  attacker: string;
  arriveAt: number;
  armyTotal: number;
};

type District = {
  id: string;
  label: string;
  color: string;
  center: number;
  step: number;
  buildings: BKey[];
};

const DISTRICTS: District[] = [
  { id: "economy", label: "ECONOMY", color: "#e8b24c", center: -45, step: 19, buildings: ["bank", "oilwell", "powerplant", "storage"] },
  { id: "military", label: "MILITARY", color: "#ff8a5c", center: 45, step: 24, buildings: ["armyCamp", "navalBase", "airfield"] },
  { id: "bastion", label: "BASTION", color: "#5fc8ff", center: 135, step: 24, buildings: ["embassy", "wall", "hospital"] },
  { id: "science", label: "INTEL · SCIENCE", color: "#aa82ff", center: -135, step: 24, buildings: ["milestone", "watchtower", "academy"] },
];

const RESOURCE_NODES: Array<{ building: BKey; resource: "cash" | "oil" | "power"; color: string; delay: number }> = [
  { building: "bank", resource: "cash", color: "#43f2a1", delay: 0 },
  { building: "oilwell", resource: "oil", color: "#ffb454", delay: 2.7 },
  { building: "powerplant", resource: "power", color: "#38d9ff", delay: 5.4 },
];

const CX = 500;
const CY = 286;
const A = 402;
const B = 220;
const ROTATION = -7 * Math.PI / 180;

function point(degrees: number) {
  const angle = degrees * Math.PI / 180;
  const x = A * Math.cos(angle);
  const y = B * Math.sin(angle);
  return {
    x: CX + x * Math.cos(ROTATION) - y * Math.sin(ROTATION),
    y: CY + x * Math.sin(ROTATION) + y * Math.cos(ROTATION),
  };
}

function curve(from: { x: number; y: number }) {
  const dx = CX - from.x;
  const dy = CY - from.y;
  return `M ${from.x} ${from.y} Q ${(from.x + CX) / 2 - dy * .18} ${(from.y + CY) / 2 + dx * .18} ${CX} ${CY}`;
}

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
  address, name, view, now, selected, quality, threat, onSelect,
}: {
  address: string;
  name: string;
  view: GameState;
  now: number;
  selected: BKey | null;
  quality: GraphicsQuality;
  threat: CityThreat | null;
  onSelect: (building: BKey) => void;
}) {
  const [equipped, setEquipped] = useState(() => loadout(address));
  useEffect(() => {
    const sync = () => setEquipped(loadout(address));
    sync();
    window.addEventListener(COSMETIC_VAULT_CHANGED_EVENT, sync);
    return () => window.removeEventListener(COSMETIC_VAULT_CHANGED_EVENT, sync);
  }, [address]);

  const positions = useMemo(() => {
    const map = new Map<BKey, { x: number; y: number; district: District }>();
    DISTRICTS.forEach((district) => district.buildings.forEach((building, index) => {
      const angle = district.center + (index - (district.buildings.length - 1) / 2) * district.step;
      map.set(building, { ...point(angle), district });
    }));
    return map;
  }, []);
  const production = useMemo(() => prodPerHour(view), [view]);

  const activeFinish = (building: BKey): { finishAt: number; durationSec?: number } => {
    if (building === "academy" && view.researchQueue.finishAt > 0) return { finishAt: view.researchQueue.finishAt, durationSec: view.researchQueue.durationSec };
    if (building === "hospital" && view.healing.finishAt > 0) return { finishAt: view.healing.finishAt, durationSec: view.healing.durationSec };
    const arm = building === "armyCamp" ? "army" : building === "navalBase" ? "navy" : building === "airfield" ? "air" : null;
    if (arm && view.training[arm].finishAt > 0) {
      const queue = view.training[arm];
      return { finishAt: queue.finishAt, durationSec: queue.per * queue.qty };
    }
    return view.buildings[building];
  };

  const moving = quality.fallbackAnim && quality.tier !== "low";
  const staticPlanet = quality.tier === "low" || !quality.bgAnimate;
  const threatEta = threat?.phase === "inbound" ? Math.max(0, Math.ceil((threat.arriveAt - now) / 1000)) : 0;

  return <section className={`city-star-grid city-quality-${quality.tier}${moving ? " has-motion" : " is-still"}${threat ? ` threat-${threat.phase}` : ""}`} aria-label="Star Grid">
    <header className="city-star-grid-head"><span><i /> STAR GRID</span><b>{BUILDING_ORDER.filter((key) => isUnlocked(view, key)).length} SYSTEMS</b></header>
    {threat && <div className="city-threat-banner" role="alert">
      <span>{threat.phase === "inbound" ? "▲" : "◆"}</span>
      <b>{threat.phase === "inbound" ? "HOSTILE FLEET INBOUND" : "CITY UNDER ATTACK"}</b>
      <em>{threat.phase === "inbound" ? `ETA ${String(Math.floor(threatEta / 60)).padStart(2, "0")}:${String(threatEta % 60).padStart(2, "0")}` : threat.attacker}</em>
    </div>}
    <div className="city-star-grid-map">
      <div className="city-grid-floor" aria-hidden="true" />
      <svg className="city-grid-lines" viewBox="0 0 1000 600" preserveAspectRatio="none" aria-hidden="true">
        <g className="city-quadrant-dividers">
          {[0, 90, 180, 270].map((degrees) => {
            const edge = point(degrees);
            return <line key={degrees} x1={CX} y1={CY} x2={edge.x} y2={edge.y} />;
          })}
        </g>
        <ellipse className="city-orbit outer" cx={CX} cy={CY} rx={A} ry={B} transform={`rotate(-7 ${CX} ${CY})`} />
        <ellipse className="city-orbit inner" cx={CX} cy={CY} rx="260" ry="142" transform={`rotate(-7 ${CX} ${CY})`} />
        <g className="city-orbit-ticks">
          {Array.from({ length: 48 }, (_, index) => {
            const outer = point(index * 7.5);
            const inset = index % 4 === 0 ? .945 : .965;
            return <line key={index} x1={CX + (outer.x - CX) * inset} y1={CY + (outer.y - CY) * inset} x2={outer.x} y2={outer.y} />;
          })}
        </g>
        {DISTRICTS.map((district) => {
          const label = point(district.center);
          const dx = (label.x - CX) * .70;
          const dy = (label.y - CY) * .70;
          return <g className={`city-district ${district.id}`} style={{ color: district.color }} key={district.id}>
            <text x={CX + dx} y={CY + dy}>{district.label} · {district.buildings.length}</text>
          </g>;
        })}
        {RESOURCE_NODES.map(({ building, resource, color, delay }) => {
          const start = positions.get(building)!;
          const pathId = `city-resource-${building}`;
          const flightPath = curve(start);
          const packetGain = Math.max(1, Math.floor(production[resource] * 8 / 3600));
          return <g key={building} style={{ color }}>
            <path id={pathId} className="city-resource-route" d={flightPath} />
            {moving && <>
              <path className="city-resource-route-live" d={flightPath}>
                <animate attributeName="opacity" dur="8s" begin={`${delay}s`} repeatCount="indefinite" values="0;.8;.22;0;0" keyTimes="0;.035;.19;.2375;1" />
              </path>
              {[0, 1, 2].map((trail) => <circle key={trail} className={`city-resource-packet trail-${trail}`} r={(quality.tier === "ultra" ? 3.7 : 3.1) - trail * .75}>
                <animateMotion dur="8s" begin={`${delay + trail * .055}s`} repeatCount="indefinite" path={flightPath} keyPoints="0;1;1" keyTimes="0;.2375;1" calcMode="linear" />
                <animate attributeName="opacity" dur="8s" begin={`${delay + trail * .055}s`} repeatCount="indefinite" values="0;1;.82;0;0" keyTimes="0;.025;.19;.2375;1" />
              </circle>)}
              <circle className="city-resource-launch" cx={start.x} cy={start.y} r="5">
                <animate attributeName="r" dur="8s" begin={`${delay}s`} repeatCount="indefinite" values="5;21;21" keyTimes="0;.08;1" />
                <animate attributeName="opacity" dur="8s" begin={`${delay}s`} repeatCount="indefinite" values=".85;0;0" keyTimes="0;.08;1" />
              </circle>
              <circle className="city-resource-arrival" cx={CX} cy={CY} r="7">
                <animate attributeName="r" dur="8s" begin={`${delay}s`} repeatCount="indefinite" values="7;7;34;46;46" keyTimes="0;.20;.2375;.31;1" />
                <animate attributeName="opacity" dur="8s" begin={`${delay}s`} repeatCount="indefinite" values="0;0;.9;0;0" keyTimes="0;.20;.2375;.31;1" />
              </circle>
              <text className="city-resource-gain" x={CX + 34} y={CY - 24}>+{compact(displayResource(packetGain))}
                <animate attributeName="y" dur="8s" begin={`${delay}s`} repeatCount="indefinite" values={`${CY - 18};${CY - 18};${CY - 48};${CY - 48}`} keyTimes="0;.22;.34;1" />
                <animate attributeName="opacity" dur="8s" begin={`${delay}s`} repeatCount="indefinite" values="0;0;1;0;0" keyTimes="0;.22;.245;.36;1" />
              </text>
            </>}
          </g>;
        })}
        {threat?.phase === "inbound" && <path className="city-threat-route" d={`M -20 76 Q 140 14 260 184`} />}
      </svg>

      <button className={`city-grid-core${selected === "keep" ? " selected" : ""}`} type="button" onClick={() => onSelect("keep")} aria-label={`Civilization Core level ${view.buildings.keep.lvl}`}>
        {view.buildings.keep.lvl < 10 && <i className="city-core-shield-net" aria-hidden="true" />}
        <PlanetOrbitPreview skin={equipped.planetBody} halo={equipped.halo} orbit={equipped.orbit} chrome={false} fitAssembly transparent className="city-grid-core-planet" staticPreview={staticPlanet} />
        <span><small>CIVILIZATION</small><b>{name}</b><em>{view.buildings.keep.lvl}</em></span>
      </button>

      {Array.from(positions.entries()).map(([building, position]) => {
        const state = view.buildings[building];
        const locked = !isUnlocked(view, building);
        const operation = activeFinish(building);
        const busy = operation.finishAt > 0;
        const progress = busy ? queueProgress(operation.durationSec, operation.finishAt, now) : 0;
        return <button
          className={`city-grid-node district-${position.district.id}${locked ? " locked" : ""}${busy ? " busy" : ""}${selected === building ? " selected" : ""}`}
          type="button"
          key={building}
          disabled={locked}
          onClick={() => onSelect(building)}
          style={{ left: `${position.x / 10}%`, top: `${position.y / 6}%`, color: position.district.color, "--city-progress": `${progress * 3.6}deg` } as CSSProperties}
          aria-label={locked ? `${BUILDINGS[building].label}, unlocks at Core ${unlockAtKeep(building)}` : `${BUILDINGS[building].label}, level ${state.lvl}`}
        >
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
