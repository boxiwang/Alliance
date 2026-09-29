import { useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode, type RefObject } from "react";
import { flushSync } from "react-dom";
import { Profile } from "./lib/profile";
import {
  GameState, RES, RES_ORDER, TROOP_ORDER, TROOPS_META, TroopKey,
  capacity, displayResource, displayTroops, mightBreakdown, prodPerHour, project, totalTroops,
} from "./lib/game";
import { loadGame, saveGame, initGame } from "./lib/gamestore";
import { getN } from "./lib/numbers";
import { compact } from "./lib/format";
import { gmFillTroops, hasLocalGm } from "./lib/gm";
import type {
  CityEntity, HeadlessMarch, MonsterEntity, Point, ResourceEntity, WorldEntity, WorldReport,
} from "./lib/world-engine";
import { ISSUED_WORLD_COSMETICS, distance, energyAt, isInsidePlayableWorld, isScoutReportActive, scoutReportExpiresAt, worldCenter, worldPlayableRadius, relocateCity, nearestWarpPoint, warpBlockReason, warpReadiness, WARP_RULES, worldResourceMaxLevel, worldRogueMaxLevel, zoneForPoint } from "./lib/world-engine";
import { carryCapacity, resolveCombat } from "./lib/expedition";
import type { LocalWorldSession } from "./lib/world-adapter";
import {
  advanceLocalWorldSession, dispatchLocalWorldMarch, finishLocalWorldMarches,
  localWorldTargetName, openLocalWorldSession, recallLocalWorldMarch, saveLocalWorldSession, scanLocalWorldRogue,
} from "./lib/world-adapter";
import GameNav from "./GameNav";
import NameSignal from "./NameSignal";
import CommanderCardView from "./CommanderCardView";
import MiniComms from "./MiniComms";
import CosmicBackdrop from "./CosmicBackdrop";
import VoidPlanetOverlay from "./VoidPlanet";
import WorldVisualLayer, { createWorldVisualStress, worldStrategicBlend, worldVisualBodyRadius, worldWormholeRadius, type WorldViewport, type WorldVisualCity } from "./WorldVisualLayer";
import WorldStrikeLayer from "./WorldStrikeLayer";
import WorldMarchLayer from "./WorldMarchLayer";
import WorldBackdropLayer from "./WorldBackdropLayer";
import { markWorldMotion } from "./lib/world-motion";
import { useGraphicsQuality } from "./useGraphicsQuality";
import type { GraphicsQuality } from "./lib/graphics-tier";
import {
  PLANET_HALOS, PLANET_ORBITS, PLANET_SKINS, loadCosmeticVault, loadPlayerAccount,
  type ChatSignalId, type MarchSignatureId, type PlanetHaloId, type PlanetOrbitId, type PlanetSkinId,
} from "./lib/player-account";
import { playSfx, SFX_STARMAP_SELECT, SFX_STARMAP_SELECT_VOLUME } from "./lib/sfx";
import { RealtimeClient, type PresenceCity, type ScoutSnapshot, type LiveMarch, type ServerReport, type ViewRect } from "./lib/realtime";

// A rival city we are allowed to place: the server sent its coordinates because it
// is inside our current map view (location privacy, docs/BETA-P0.md P0-4).
type MapCity = PresenceCity & { coords: { x: number; y: number } };
const hasCoords = (p: PresenceCity): p is MapCity => !!p.coords && Number.isFinite(p.coords.x) && Number.isFinite(p.coords.y);
const VIEW_MAX_SPAN = 420; // matches worker/world-coords.ts
const rectHas = (rect: ViewRect, c: { x: number; y: number }) => c.x >= rect.x0 && c.x <= rect.x1 && c.y >= rect.y0 && c.y <= rect.y1;
import { radiantCrownSvgPath } from "./planet-halo-shared";
import { createCommanderShare, createCoordinateShare, createScoutIntelShare, queueCommsShare, queueDirectMessage, takeWorldFocus } from "./lib/shared-intel";
import { allianceForAddress, relationshipBetween, type AllianceRelation } from "./lib/alliance";
import { ensureGameAuthority, sendGameCommand, type GameCommandResponse, loadInventory } from "./lib/backend";

type SelectableEntity = ResourceEntity | MonsterEntity | CityEntity;
type WorldLayer = "resource" | "monster" | "city";
type ResultNotice = { title: string; detail: string; good: boolean };
export type ResourceOccupationDisposition = "neutral" | "self" | "ally" | "enemy";

const KIND_META = {
  resource: { color: "#43f2a1", icon: "●", label: "Resource planet" },
  monster: { color: "#ff5f78", icon: "◉", label: "Rogue planet" },
  city: { color: "#aa82ff", icon: "⬡", label: "Civilization" },
};

const RESOURCE_COLORS = { cash: "#43f2a1", oil: "#ffb454", power: "#38d9ff" };
// Faction accent for remote players on the shared map (falls back to cyan).
const REMOTE_FACTION_COLOR: Record<string, string> = { ORBT: "#38d9ff", PEPE: "#43f2a1", DOGE: "#ffb454", MOG: "#aa82ff", WIF: "#7cc0ff" };
const RESOURCE_EMOJI = { cash: "💰", oil: "⛽", power: "⚡" };
const RESOURCE_GRADIENT = { cash: "url(#world-planet-cash)", oil: "url(#world-planet-oil)", power: "url(#world-planet-power)" };
// Star Map style: resources/Rogues sized to the tile grid and visually quiet so
// cities, relations and selection lead the eye. The previous "classic" style is
// archived at git tag archive/classic-starmap; there is only one style now.
const CALM_MAP = true;
const RESOURCE_FILL = CALM_MAP ? { cash: "url(#world-planet-cash-calm)", oil: "url(#world-planet-oil-calm)", power: "url(#world-planet-power-calm)" } : RESOURCE_GRADIENT;
const ROGUE_FILL = CALM_MAP ? "url(#world-planet-rogue-calm)" : "url(#world-planet-rogue)";
// In-flight gather milestones (shown live in Live Fleets) are kept out of the results archive.
const ARCHIVE_HIDDEN_OUTCOMES = new Set(["gathering_started", "gathering_completed"]);

type SignalCluster = { id: string; kind: "resource" | "monster"; position: Point; count: number };
export const WORLD_MIN_ZOOM = 1;
// Zoom is anchored to a 512-tile span (docs/MAP-2048.md): the same zoom shows the same number
// of tiles on any map size, so markers keep their on-screen size; bigger maps zoom out further.
export const WORLD_VIEW_SPAN = 512;
const worldZoomFloor = (mapWidth: number) => Math.min(WORLD_MIN_ZOOM, WORLD_VIEW_SPAN / Math.max(1, mapWidth));
export const WORLD_MAX_ZOOM = 16;
export const WORLD_TACTICAL_ZOOM = 3;
/** Most target markers one screen may draw before the Field view switches to clusters. */
const TARGET_MARKER_BUDGET = 320;
const WORLD_PAN_OVERSCAN = 1.65;

/** Rival civilizations only resolve inside the Tactical sensor envelope. */
export function worldTargetObservable(kind: "resource" | "monster" | "city", zoom: number): boolean {
  return kind !== "city" || zoom >= WORLD_TACTICAL_ZOOM;
}

export function worldMarchObservable(ownerId: string, viewerId: string, zoom: number): boolean {
  return ownerId === viewerId || zoom >= WORLD_TACTICAL_ZOOM;
}

export function worldMarkerScale(zoom: number): number {
  const safeZoom = Math.max(WORLD_MIN_ZOOM, Math.min(WORLD_MAX_ZOOM, zoom));
  // Preserve stable markers through Field view, then let them grow gently in
  // deep Tactical view. At 16× a target is 2× its Field screen size, not 16×.
  const tacticalBoost = safeZoom <= 3 ? 1 : Math.min(2, 1 + Math.log2(safeZoom / 3) * .45);
  return tacticalBoost / safeZoom;
}

/**
 * Screen-space fleet scale. Because the marker is drawn with scale(value/zoom),
 * this value IS its on-screen size independent of zoom — so it must stay small
 * in Field view (where planets shrink to dots and an oversized fleet dwarfs
 * them) and only grow once you are in Tactical range inspecting a single fleet.
 */
export function worldMarchScreenScale(zoom: number): number {
  const safeZoom = Math.max(WORLD_MIN_ZOOM, Math.min(WORLD_MAX_ZOOM, zoom));
  if (safeZoom < 1.45) return .5;
  if (safeZoom < WORLD_TACTICAL_ZOOM) return .5 + ((safeZoom - 1.45) / (WORLD_TACTICAL_ZOOM - 1.45)) * .22;
  const amount = Math.max(0, Math.min(1, Math.log2(safeZoom / WORLD_TACTICAL_ZOOM) / Math.log2(WORLD_MAX_ZOOM / WORLD_TACTICAL_ZOOM)));
  return .72 + amount * .63;
}

/**
 * Local SVG offset for a fixed-size identity plate. Own and selected bodies
 * grow in screen space, while their label groups use different scale curves;
 * matching those curves prevents the plate from drifting at 1600%.
 */
export function worldIdentityLocalOffset(zoom: number, own: boolean): number {
  const safeZoom = Math.max(WORLD_MIN_ZOOM, Math.min(WORLD_MAX_ZOOM, zoom));
  if (safeZoom < WORLD_TACTICAL_ZOOM) return ((safeZoom - WORLD_MIN_ZOOM) / (WORLD_TACTICAL_ZOOM - WORLD_MIN_ZOOM)) * 14;
  const amount = Math.max(0, Math.min(1, Math.log2(safeZoom / WORLD_TACTICAL_ZOOM) / Math.log2(WORLD_MAX_ZOOM / WORLD_TACTICAL_ZOOM)));
  return own ? 14 + amount * 16 : 14 + amount * 3;
}

function steppedWorldZoom(value: number, direction: "in" | "out", factor: number, floor = WORLD_MIN_ZOOM): number {
  return Math.max(floor, Math.min(WORLD_MAX_ZOOM, direction === "in" ? value * factor : value / factor));
}

export function clusterWorldSignals(entities: SelectableEntity[], cellSize = 44): SignalCluster[] {
  const buckets = new Map<string, { kind: "resource" | "monster"; x: number; y: number; count: number }>();
  entities.forEach((entity) => {
    if (entity.kind === "city") return;
    const id = `${entity.kind}:${Math.floor(entity.position.x / cellSize)}:${Math.floor(entity.position.y / cellSize)}`;
    const bucket = buckets.get(id) || { kind: entity.kind, x: 0, y: 0, count: 0 };
    bucket.x += entity.position.x; bucket.y += entity.position.y; bucket.count += 1; buckets.set(id, bucket);
  });
  return Array.from(buckets, ([id, bucket]) => ({ id, kind: bucket.kind, position: { x: bucket.x / bucket.count, y: bucket.y / bucket.count }, count: bucket.count }));
}

function entityColor(entity: SelectableEntity): string {
  return entity.kind === "resource" ? RESOURCE_COLORS[entity.resource] : KIND_META[entity.kind].color;
}

function entitySignalIcon(entity: SelectableEntity): string {
  return entity.kind === "resource" ? RESOURCE_EMOJI[entity.resource] : entity.kind === "monster" ? "💀" : "◈";
}

export function resourceOccupationDisposition(
  entity: ResourceEntity,
  marches: Record<string, Pick<HeadlessMarch, "playerId">>,
  players: Record<string, { id: string; allianceId?: string | null }>,
  viewerId: string,
  viewerAllianceId: string | null,
): ResourceOccupationDisposition {
  if (entity.state !== "occupied" || !entity.occupiedByMarchId) return "neutral";
  const occupierId = marches[entity.occupiedByMarchId]?.playerId;
  if (!occupierId) return "enemy";
  if (occupierId === viewerId) return "self";
  const occupierAlliance = players[occupierId]?.allianceId;
  return viewerAllianceId && occupierAlliance === viewerAllianceId ? "ally" : "enemy";
}

// Selected body scale: calm markers start small, so they grow a little more.
type SearchKind = "monster" | "cash" | "oil" | "power";
type SearchTab = SearchKind | "coord";
const SEARCH_KINDS: { id: SearchTab; label: string }[] = [
  { id: "monster", label: "ROGUE" }, { id: "cash", label: "CASH" }, { id: "oil", label: "OIL" }, { id: "power", label: "POWER" }, { id: "coord", label: "COORD" },
];
const WARP_LOCATION_BLOCKS = new Set(["outside_frontier", "sector_sealed", "reserve_zone", "too_close_city", "tile_occupied"]);
const coordLabel = (point: Point) => `${Math.floor(point.x).toString().padStart(3, "0")}:${Math.floor(point.y).toString().padStart(3, "0")}`;
const SELECT_SCALE = CALM_MAP ? 1.4 : 1.2;
type LockTone = "own" | "rival" | "cash" | "oil" | "power" | "rogue" | "locked";

/** Edge arrow toward the home city whenever it is off-screen (mainstream SLG "home" compass). */
function HomeBeacon({ viewportRef, home, onHome }: { viewportRef: RefObject<WorldViewport>; home: Point; onHome: () => void }) {
  const ref = useRef<HTMLButtonElement>(null);
  const homeRef = useRef(home);
  homeRef.current = home;
  useEffect(() => {
    let raf = 0, lastKey = "";
    const tick = () => {
      raf = requestAnimationFrame(tick);
      const el = ref.current, vp = viewportRef.current, box = el?.parentElement;
      if (!el || !vp || !box) return;
      const cw = box.clientWidth, ch = box.clientHeight, h = homeRef.current;
      const scale = Math.min(cw / vp.width, ch / vp.height);
      const ox = (cw - vp.width * scale) / 2, oy = (ch - vp.height * scale) / 2;
      const hx = ox + (h.x - vp.x) * scale, hy = oy + (h.y - vp.y) * scale;
      const margin = 46;
      const visible = hx > margin && hx < cw - margin && hy > margin && hy < ch - margin;
      const cx = cw / 2, cy = ch / 2, dx = hx - cx, dy = hy - cy;
      const t = Math.min((cw / 2 - margin) / Math.max(1e-6, Math.abs(dx)), (ch / 2 - margin) / Math.max(1e-6, Math.abs(dy)));
      const px = cx + dx * t, py = cy + dy * t, angle = Math.atan2(dy, dx) * 180 / Math.PI;
      const tiles = Math.round(Math.hypot(h.x - (vp.x + vp.width / 2), h.y - (vp.y + vp.height / 2)));
      const key = visible ? "hidden" : `${px.toFixed(1)}|${py.toFixed(1)}|${angle.toFixed(1)}|${tiles}`;
      if (key === lastKey) return;
      lastKey = key;
      el.style.display = visible ? "none" : "";
      if (visible) return;
      el.style.transform = `translate(${px}px, ${py}px)`;
      const arrow = el.querySelector<HTMLElement>(".world-home-beacon-arrow");
      if (arrow) arrow.style.transform = `rotate(${angle}deg)`;
      const label = el.querySelector<HTMLElement>(".world-home-beacon-distance");
      if (label) label.textContent = `${tiles}`;
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [viewportRef]);
  return <button ref={ref} type="button" className="world-home-beacon" style={{ display: "none" }} onClick={onHome} aria-label="Return to your home city">
    <span className="world-home-beacon-arrow" aria-hidden="true" />
    <b>HOME</b><span className="world-home-beacon-distance" />
  </button>;
}

function WorldLevelBadge({ x, y, level }: { x: number; y: number; level: number }) {
  return <g className="world-level-badge"><circle cx={x + 6.5} cy={y + 6.2} r="3.25" /><text x={x + 6.5} y={y + 7.25}>{level}</text></g>;
}

function CityIdentityTag({ x, y, level, name, signal = "clear-channel", own = false, relation = own ? "self" : "neutral", coord }: { x: number; y: number; level: number; name: string; signal?: ChatSignalId | null; own?: boolean; relation?: AllianceRelation; coord?: Point }) {
  const label = name.slice(0, 18);
  // Width fits the actual rendered text (~1.82 units/char at this font) plus the level pill,
  // so the plate hugs the name instead of trailing empty space; the name is centred in the
  // region right of the pill.
  const charW = 1.82, levelPad = 9, rightPad = 4.5;
  const textW = label.length * charW;
  const width = Math.max(20, levelPad + textW + rightPad);
  const left = x - width / 2;
  const textCx = left + levelPad + textW / 2;
  return <g className={`world-city-tag signal-${signal || "clear-channel"} relation-${relation} ${own ? "own" : "rival"}`} pointerEvents="none">
    <rect x={left} y={y + 6.1} width={width} height="7.1" rx="2.2" />
    <circle cx={left} cy={y + 9.65} r="4.15" />
    <text className="world-city-level" x={left} y={y + 10.9} textAnchor="middle">{level}</text>
    <text className="world-city-player" x={textCx} y={y + 10.85} textAnchor="middle">{label}</text>
    {coord && (() => {
      // Coordinates hang under the plate as a small tab of the same material.
      const text = `X ${Math.round(coord.x)} · Y ${Math.round(coord.y)}`;
      const tabW = text.length * 1.58 + 3.4;
      return <g className="world-city-coord-tab">
        <path d={`M ${x - tabW / 2} ${y + 13.2} h ${tabW} v 3.1 q 0 1.4 -1.4 1.4 h ${-(tabW - 2.8)} q -1.4 0 -1.4 -1.4 Z`} />
        <text x={x} y={y + 16.45} textAnchor="middle">{text}</text>
      </g>;
    })()}
  </g>;
}

function WorldSurfaceMark({ x, y, kind }: { x: number; y: number; kind: ResourceEntity["resource"] | "rogue" }) {
  if (kind === "cash") return <g className="world-surface-mark cash">
    <ellipse cx={x} cy={y - 1.9} rx="2.65" ry="1" />
    <path d={`M ${x - 2.65} ${y - 1.9}v2.7c0 .55 1.2 1 2.65 1s2.65-.45 2.65-1v-2.7M ${x - 2.65} ${y - .55}c0 .55 1.2 1 2.65 1s2.65-.45 2.65-1`} />
  </g>;
  if (kind === "oil") return <path className="world-surface-mark oil" d={`M ${x} ${y - 3.6}C ${x - .65} ${y - 2.25} ${x - 2.55} ${y - .25} ${x - 2.55} ${y + 1.25}a2.55 2.55 0 0 0 5.1 0C ${x + 2.55} ${y - .25} ${x + .65} ${y - 2.25} ${x} ${y - 3.6}Z`} />;
  if (kind === "power") return <path className="world-surface-mark power" d={`M ${x + .65} ${y - 3.8}L ${x - 2.5} ${y + .35}h2.05l-.55 3.45 3.55-4.75H ${x + .4}Z`} />;
  return <g className="world-surface-mark rogue">
    <path d={`M ${x - 3} ${y + .4}v-1.05a3 3 0 1 1 6 0V ${y + .4}l-1 1.05v1.65h-4V ${y + 1.45}Z`} />
    <circle cx={x - 1.05} cy={y - .55} r=".55" /><circle cx={x + 1.05} cy={y - .55} r=".55" />
    <path d={`M ${x - .7} ${y + 2.05}v1.05M ${x + .7} ${y + 2.05}v1.05`} />
  </g>;
}

function WorldEntityGlyph({ entity, detailZoom, occupation }: { entity: SelectableEntity; detailZoom: boolean; occupation: ResourceOccupationDisposition }) {
  const x = entity.position.x;
  const y = entity.position.y;
  const color = entityColor(entity);
  if (entity.kind === "resource") {
    const radius = detailZoom ? 7.2 : 4.2;
    return <g className={`world-planet-glyph ${entity.resource} ${detailZoom ? "tactical" : "field"}`}>
      {occupation !== "neutral" && <><circle cx={x} cy={y} r={radius + 2.15} className="world-occupation-ring" /><circle cx={x + radius * .82} cy={y - radius * .72} r="1.45" className="world-occupation-pip" /></>}
      <circle cx={x} cy={y} r={radius} fill={RESOURCE_FILL[entity.resource]} />
      <ellipse cx={x} cy={y} rx={radius * 1.22} ry={radius * .35} transform={`rotate(-18 ${x} ${y})`} fill="none" stroke={color} strokeWidth=".55" opacity=".68" />
      <circle cx={x - radius * .3} cy={y - radius * .32} r={radius * .18} className="world-planet-specular" />
      {detailZoom && <><path d={`M ${x - 5.5} ${y + 1.8}Q ${x} ${y + 4.7} ${x + 5.5} ${y + 1.1}`} className="world-planet-contour" /><WorldSurfaceMark x={x} y={y} kind={entity.resource} /></>}
      {detailZoom && <WorldLevelBadge x={x} y={y} level={entity.level} />}
    </g>;
  }
  if (entity.kind === "city") {
    return <polygon points={`${x},${y - 4.1} ${x + 3.6},${y - 2} ${x + 3.6},${y + 2} ${x},${y + 4.1} ${x - 3.6},${y + 2} ${x - 3.6},${y - 2}`} fill={color} />;
  }
  if (detailZoom) return <g className="world-rogue-glyph"><circle cx={x} cy={y} r="7.2" fill={ROGUE_FILL} /><ellipse cx={x} cy={y} rx="8.5" ry="2.4" transform={`rotate(16 ${x} ${y})`} /><path d={`M ${x - 5.4} ${y + 1.7}Q ${x} ${y + 4.5} ${x + 5.4} ${y + 1}`} className="world-planet-contour" /><WorldSurfaceMark x={x} y={y} kind="rogue" /><WorldLevelBadge x={x} y={y} level={entity.level} /></g>;
  return <path d={`M ${x} ${y - 4.2} L ${x + 4} ${y + 3.4} H ${x - 4} Z`} fill={color} />;
}

function WorldOrbitFx({ cx, cy, r, orbit, half }: { cx: number; cy: number; r: number; orbit: PlanetOrbitId; half: "back" | "front" }) {
  const arc = (rx: number, ry: number) => half === "back"
    ? `M ${cx - rx} ${cy} A ${rx} ${ry} 0 0 1 ${cx + rx} ${cy}`
    : `M ${cx - rx} ${cy} A ${rx} ${ry} 0 0 0 ${cx + rx} ${cy}`;
  const tiltedArc = (rx: number, ry: number, rotation: number) => {
    const start = half === "front" ? 0 : Math.PI;
    const radians = rotation * Math.PI / 180;
    return Array.from({ length: 25 }, (_, index) => {
      const angle = start + index / 24 * Math.PI;
      const x = rx * Math.cos(angle); const y = ry * Math.sin(angle);
      const px = cx + x * Math.cos(radians) - y * Math.sin(radians);
      const py = cy + x * Math.sin(radians) + y * Math.cos(radians);
      return `${index ? "L" : "M"} ${px.toFixed(2)} ${py.toFixed(2)}`;
    }).join(" ");
  };
  const point = (rx: number, ry: number, angle: number) => ({ x: cx + rx * Math.cos(angle), y: cy + ry * Math.sin(angle), front: Math.sin(angle) > 0 });

  if (orbit === "survey-ring") {
    const rx = r * 2.15; const ry = rx * .3;
    const marker = point(rx, ry, half === "front" ? .55 : Math.PI * 1.55);
    return <g className={`world-orbit world-orbit-survey world-orbit-${half}`}>
      <path d={arc(rx, ry)} />
      <path className="world-orbit-survey-tick" d={`M ${marker.x} ${marker.y - 2.2} V ${marker.y + 2.2}`} />
      <circle className="world-orbit-survey-node" cx={marker.x} cy={marker.y} r=".85" />
    </g>;
  }

  if (orbit === "orbital-belt") {
    const rx = r * 2.05; const ry = rx * .3;
    const satellites = Array.from({ length: 4 }, (_, index) => point(rx, ry, index * Math.PI / 2 + .42)).filter((satellite) => satellite.front === (half === "front"));
    const debris = Array.from({ length: 18 }, (_, index) => point(rx * (1 + .08 * Math.sin(index * 4.7)), ry * (1 + .08 * Math.sin(index * 4.7)), index * .39 + .21)).filter((mote) => mote.front === (half === "front"));
    return <g className={`world-orbit world-orbit-belt world-orbit-${half}`}>
      <path d={arc(rx, ry)} />
      <path className="world-orbit-belt-outer" d={arc(r * 2.55, r * 2.55 * .24)} />
      {debris.map((mote, index) => <circle key={`debris-${index}`} className="world-orbit-debris" cx={mote.x} cy={mote.y} r=".45" />)}
      {satellites.map((satellite, index) => <g className="world-orbit-satellite" key={`satellite-${index}`}><circle cx={satellite.x} cy={satellite.y} r="2.4" className="glow" /><circle cx={satellite.x} cy={satellite.y} r=".82" /></g>)}
    </g>;
  }

  if (orbit === "accretion-halo") {
    const rx = r * 2.25; const ry = rx * .34;
    const particles = Array.from({ length: 64 }, (_, index) => {
      const angle = index / 64 * Math.PI * 2 + .18;
      const jitter = .86 + .2 * Math.sin(index * 12.9);
      return { ...point(rx * jitter, ry * jitter, angle), warm: Math.cos(angle) < 0, bright: index % 7 === 0 };
    }).filter((particle) => particle.front === (half === "front"));
    return <g className={`world-orbit world-orbit-accretion world-orbit-${half}`}>
      <path className="world-orbit-accretion-glow" d={arc(rx, ry)} />
      {particles.map((particle, index) => <circle key={`particle-${index}`} className={`${particle.warm ? "violet" : "amber"} ${particle.bright ? "bright" : ""}`} cx={particle.x} cy={particle.y} r={particle.bright ? "1.05" : index % 3 === 0 ? ".72" : ".46"} />)}
      <path className="world-orbit-photon" d={arc(rx * .86, ry * .86)} />
    </g>;
  }

  const rx = r * 2.2; const ry = rx * .32;
  const gems = Array.from({ length: 6 }, (_, index) => point(rx, ry, index * Math.PI / 3 + .28)).filter((gem) => gem.front === (half === "front"));
  const shimmer = Array.from({ length: 12 }, (_, index) => point(rx * (1.04 + .05 * Math.sin(index * 3.1)), ry * (1.04 + .05 * Math.sin(index * 3.1)), index * Math.PI / 6 + .12)).filter((spark) => spark.front === (half === "front"));
  return <g className={`world-orbit world-orbit-crown world-orbit-${half}`}>
    <path className="world-orbit-crown-gyro gyro-a" d={tiltedArc(r * 2.35, r * .5, 29)} />
    <path className="world-orbit-crown-gyro gyro-b" d={tiltedArc(r * 2.35, r * .5, -40)} />
    <path className="world-orbit-crown-main" d={arc(rx, ry)} />
    {shimmer.map((spark, index) => <circle className="world-orbit-crown-spark" key={`spark-${index}`} cx={spark.x} cy={spark.y} r={index % 4 === 0 ? ".58" : ".3"} />)}
    {gems.map((gem, index) => <g className="world-orbit-gem" key={`gem-${index}`} transform={`translate(${gem.x} ${gem.y}) rotate(45)`}><rect x="-1.15" y="-1.15" width="2.3" height="2.3" /><circle cx="0" cy="0" r="3.4" /></g>)}
  </g>;
}

// Map-LOD rendering of the "Void-Touched / Rift Sovereign" premium planet skin
// (the full animated WebGL shader is reserved for the cosmetic preview / profile).
// Obsidian body · violet energy fractures · cyan-violet orbit halo · void-scar tail.
function VoidTouchedPlanet({ cx, cy, r }: { cx: number; cy: number; r: number }) {
  const path = (pts: number[][]) => pts.map((p, i) => `${i ? "L" : "M"} ${(cx + p[0] * r).toFixed(2)} ${(cy + p[1] * r).toFixed(2)}`).join(" ");
  const cracks = [
    [[-.12, -.62], [-.04, -.22], [.16, -.04], [.08, .26], [.3, .54]],
    [[-.58, .04], [-.24, .12], [.02, 0], [.22, -.16], [.56, -.22]],
    [[.04, -.06], [-.16, .22], [-.32, .5]],
  ];
  return <g className="world-void-planet">
    <path className="world-void-tail" d={`M ${cx + r * .5} ${cy - r * .12} Q ${cx + r * 1.9} ${cy - r * .06} ${cx + r * 3.3} ${cy + r * .16} Q ${cx + r * 1.8} ${cy + r * .4} ${cx + r * .5} ${cy + r * .3} Z`} fill="url(#world-void-tail)" />
    <circle className="world-void-halo" cx={cx} cy={cy} r={r * 1.34} />
    <circle className="world-void-halo outer" cx={cx} cy={cy} r={r * 1.52} />
    <circle className="world-void-body" cx={cx} cy={cy} r={r} fill="url(#world-planet-void)" />
    {cracks.map((c, i) => <path key={`glow-${i}`} className="world-void-crack glow" d={path(c)} />)}
    {cracks.map((c, i) => <path key={`crack-${i}`} className="world-void-crack" d={path(c)} />)}
    <circle className="world-void-spec" cx={cx - r * .3} cy={cy - r * .33} r={r * .16} />
  </g>;
}

function WorldHaloFx({ cx, cy, r, halo, half }: { cx: number; cy: number; r: number; halo: PlanetHaloId; half: "back" | "front" }) {
  if (halo === "faint-corona") return <g className={`world-halo world-halo-corona ${half}`}>
    {half === "back" ? <circle cx={cx} cy={cy} r={r * 1.34} /> : <circle cx={cx} cy={cy} r={r * 1.02} />}
  </g>;
  if (halo === "pulse-aura") return <g className={`world-halo world-halo-pulse ${half}`}>
    {half === "back" ? <><circle className="world-halo-bloom" cx={cx} cy={cy} r={r * 1.28} /><circle className="world-halo-wave wave-a" cx={cx} cy={cy} r={r * 1.06} /><circle className="world-halo-wave wave-b" cx={cx} cy={cy} r={r * 1.06} /></> : <circle className="world-halo-rim" cx={cx} cy={cy} r={r * 1.02} />}
  </g>;
  if (halo === "aurora-veil") {
    const motes = Array.from({ length: 22 }, (_, index) => {
      const angle = index / 22 * Math.PI * 2; const isFront = Math.sin(angle) > 0;
      const radius = r * (1.16 + .07 * Math.sin(angle * 4));
      return { x: cx + Math.cos(angle) * radius, y: cy + Math.sin(angle) * radius * .92, isFront };
    }).filter((mote) => mote.isFront === (half === "front"));
    return <g className={`world-halo world-halo-aurora ${half}`}>
      {half === "back" && <circle className="world-halo-bloom" cx={cx} cy={cy} r={r * 1.42} />}
      {motes.map((mote, index) => <circle key={index} className="world-halo-aurora-mote" cx={mote.x} cy={mote.y} r={r * .18} />)}
      {half === "front" && <circle className="world-halo-rim" cx={cx} cy={cy} r={r * 1.02} />}
    </g>;
  }
  const crown = radiantCrownSvgPath(cx, cy, r);
  const finial = `M ${cx} ${cy - r * 2.13} L ${cx + r * .144} ${cy - r * 1.93} L ${cx} ${cy - r * 1.73} L ${cx - r * .144} ${cy - r * 1.93} Z`;
  return <g className={`world-halo world-halo-radiant ${half}`}>
    {half === "back" ? <><circle className="world-halo-radiant-bloom" cx={cx} cy={cy} r={r * 1.72} /><path className="world-halo-crown-shape" d={crown} /></> : <><circle className="world-halo-rim" cx={cx} cy={cy} r={r * 1.02} /><path className="world-halo-crown-gem" d={finial} /></>}
  </g>;
}

function WorldPlanetFx({ cx, cy, r, skin }: { cx: number; cy: number; r: number; skin: PlanetSkinId }) {
  if (skin === "dust-homestead") return <g className="world-planet-skin world-planet-dust-homestead">
    <circle className="world-dust-body" cx={cx} cy={cy} r={r} fill="url(#world-planet-dust)" />
    <ellipse className="world-dust-band" cx={cx} cy={cy - r * .14} rx={r * .9} ry={r * .18} />
    <ellipse className="world-dust-crater" cx={cx - r * .36} cy={cy - r * .24} rx={r * .16} ry={r * .12} />
    <ellipse className="world-dust-crater small" cx={cx + r * .34} cy={cy + r * .12} rx={r * .11} ry={r * .08} />
    <ellipse className="world-dust-crater faint" cx={cx - r * .12} cy={cy + r * .43} rx={r * .13} ry={r * .09} />
  </g>;
  if (skin === "blue-marble") return <g className="world-planet-skin world-planet-blue-marble">
    <circle className="world-blue-body" cx={cx} cy={cy} r={r} fill="url(#world-planet-blue)" />
    <path className="world-blue-land" d={`M ${cx-r*.72} ${cy-r*.24} Q ${cx-r*.48} ${cy-r*.62} ${cx-r*.17} ${cy-r*.31} T ${cx+r*.08} ${cy-r*.08} Q ${cx-r*.16} ${cy+r*.08} ${cx-r*.39} ${cy+r*.17} T ${cx-r*.72} ${cy-r*.24} M ${cx+r*.18} ${cy-r*.52} Q ${cx+r*.52} ${cy-r*.47} ${cx+r*.67} ${cy-r*.12} L ${cx+r*.42} ${cy+r*.03} Q ${cx+r*.58} ${cy+r*.37} ${cx+r*.28} ${cy+r*.61} Q ${cx+r*.02} ${cy+r*.24} ${cx+r*.18} ${cy-r*.52}`} />
    <path className="world-blue-cloud" d={`M ${cx-r*.72} ${cy-r*.02} Q ${cx-r*.28} ${cy-r*.29} ${cx+r*.17} ${cy-r*.08} T ${cx+r*.72} ${cy-r*.2} M ${cx-r*.53} ${cy+r*.35} Q ${cx-r*.02} ${cy+r*.12} ${cx+r*.55} ${cy+r*.32}`} />
    <path className="world-blue-ice" d={`M ${cx-r*.51} ${cy-r*.82} Q ${cx} ${cy-r*1.02} ${cx+r*.51} ${cy-r*.82} M ${cx-r*.43} ${cy+r*.86} Q ${cx} ${cy+r*.99} ${cx+r*.43} ${cy+r*.86}`} />
    <circle className="world-blue-rim" cx={cx} cy={cy} r={r} />
  </g>;
  if (skin === "void-touched") return <VoidTouchedPlanet cx={cx} cy={cy} r={r} />;
  if (skin === "sovereign-core") return <g className="world-planet-skin world-planet-sovereign-core">
    <circle className="world-sovereign-body" cx={cx} cy={cy} r={r} fill="url(#world-planet-sovereign)" />
    <path className="world-sovereign-cell" d={`M ${cx-r*.62} ${cy-r*.18} Q ${cx-r*.3} ${cy-r*.54} ${cx-r*.02} ${cy-r*.2} T ${cx+r*.58} ${cy-r*.3} M ${cx-r*.5} ${cy+r*.34} Q ${cx-r*.1} ${cy+r*.02} ${cx+r*.18} ${cy+r*.38} T ${cx+r*.65} ${cy+r*.18}`} />
    <circle className="world-sovereign-flare" cx={cx-r*.23} cy={cy-r*.18} r={r*.18} />
    <ellipse className="world-sovereign-spot" cx={cx+r*.35} cy={cy+r*.16} rx={r*.13} ry={r*.08} />
    <circle className="world-sovereign-rim" cx={cx} cy={cy} r={r} />
  </g>;
  if (skin === "event-horizon") return <g className="world-planet-skin world-planet-event-horizon">
    <circle className="world-event-lens outer" cx={cx} cy={cy} r={r * 1.42} />
    <ellipse className="world-event-accretion back" cx={cx} cy={cy} rx={r * 1.52} ry={r * .4} transform={`rotate(-16 ${cx} ${cy})`} />
    <circle className="world-event-core" cx={cx} cy={cy} r={r * .82} />
    <circle className="world-event-photon" cx={cx} cy={cy} r={r * .98} />
    <ellipse className="world-event-accretion front" cx={cx} cy={cy} rx={r * 1.52} ry={r * .4} transform={`rotate(-16 ${cx} ${cy})`} />
  </g>;
  if (skin === "solar-imperator") return <g className="world-planet-skin world-planet-solar-imperator">
    <circle className="world-solar-corona" cx={cx} cy={cy} r={r * 1.28} />
    <circle className="world-solar-body" cx={cx} cy={cy} r={r} fill="url(#world-planet-solar)" />
    <path className="world-solar-contour" d={`M ${cx - r * .68} ${cy - r * .2} Q ${cx} ${cy - r * .55} ${cx + r * .7} ${cy - r * .08} M ${cx - r * .72} ${cy + r * .25} Q ${cx} ${cy + r * .58} ${cx + r * .7} ${cy + r * .12}`} />
    <path className="world-solar-crown" d={`M ${cx - r * .6} ${cy - r * .78} L ${cx - r * .32} ${cy - r * 1.18} L ${cx} ${cy - r * .82} L ${cx + r * .32} ${cy - r * 1.18} L ${cx + r * .6} ${cy - r * .78}`} />
    <circle className="world-solar-spec" cx={cx - r * .3} cy={cy - r * .3} r={r * .16} />
  </g>;
  return null;
}

function entityState(entity: SelectableEntity): string {
  if (entity.kind === "resource") return entity.state === "available" ? "UNCHARTED" : entity.state.toUpperCase();
  if (entity.kind === "monster") return entity.state === "alive" ? "ROAMING" : entity.state.toUpperCase();
  return entity.state === "burning" ? "UNDER ATTACK" : "STABLE";
}

function loadBookmarks(address: string): string[] {
  try {
    const value = JSON.parse(localStorage.getItem(`ruglands:world-bookmarks:${address.toLowerCase()}`) || "[]");
    return Array.isArray(value) ? value.filter((id): id is string => typeof id === "string") : [];
  } catch { return []; }
}

const ERROR_COPY: Record<string, string> = {
  player_not_found: "Player record is unavailable.", invalid_target: "That target is no longer valid.",
  cannot_target_self: "You cannot target your own city.", march_slots_full: "All march queues are busy.",
  troops_required: "Select at least one troop.", march_capacity_exceeded: "The selected force exceeds this march's capacity.",
  resource_force_exceeds_need: "This fleet contains troops whose load would go unused. Use the minimum useful fleet.",
  insufficient_troops: "Some selected troops are no longer standing in the city.", target_unavailable: "Another march reached that target first.",
  monster_level_locked: "Defeat the previous monster level first.", insufficient_energy: "Not enough Stamina for this hunt.",
  rogue_level_locked: "Defeat the previous Rogue level first.", frontier_complete: "Frontier I is complete. The Wormhole is ready for a future map.",
  rogue_unavailable: "No matching Rogue signal is currently available.",
  target_shielded: "That city is protected by a shield.",
  fleets_away: "Bring every fleet home before warping.", city_burning: "Your city is burning — let it recover before warping.",
  outside_frontier: "That spot is outside the Frontier.", reserve_zone: "The Wormhole reserve cannot be settled.",
  too_close_city: `Too close to another commander — keep ${WARP_RULES.minCitySpacing} tiles apart.`, tile_occupied: "A planet or Rogue already occupies that spot.",
  no_space: "No safe sector found. Try again.", no_warp_item: "You have no Warp item of that type left.",
  sector_sealed: "That quadrant is not open yet.", under_attack: "An attack is inbound — you cannot warp now.", rate_limited: "Too many warp attempts. Wait a minute and try again.", world_unreachable: "Warp link failed. Try again.", warp_rejected: "The warp was rejected.",
};

function fmtDuration(seconds: number): string {
  const s = Math.max(0, Math.ceil(seconds));
  if (s < 60) return `${s}s`;
  if (s < 3600) return `${Math.floor(s / 60)}m ${s % 60}s`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ${Math.floor((s % 3600) / 60)}m`;
  return `${(s / 86400).toFixed(1)}d`;
}

function emptySelection(): Record<TroopKey, Record<string, number>> { return { army: {}, navy: {}, air: {} }; }
export function recommendedGatherForce(
  troops: GameState["troops"],
  targetAmount: number,
  limit: number,
  numbers: any,
  accountModifiers: Record<string, number> = {},
): Record<TroopKey, Record<string, number>> {
  const selected = emptySelection();
  let remainingCount = Math.max(0, Math.floor(limit));
  let remainingLoad = Math.max(0, targetAmount);
  const rows = TROOP_ORDER.flatMap((arm) => Object.entries(troops[arm] ?? {})
    .map(([tier, qty]) => {
      const unit = emptySelection(); unit[arm][tier] = 1;
      return { arm, tier, qty: Math.max(0, Math.floor(qty)), load: gatherCarryWithAccount(unit, accountModifiers, numbers) };
    })
    .filter((row) => row.qty > 0))
    .sort((left, right) => right.load - left.load || Number(right.tier) - Number(left.tier));
  rows.forEach(({ arm, tier, qty, load }) => {
    if (remainingCount <= 0 || remainingLoad <= 0 || load <= 0) return;
    const take = Math.min(remainingCount, qty, Math.ceil(remainingLoad / load));
    if (take > 0) selected[arm][tier] = take;
    remainingCount -= take;
    remainingLoad -= take * load;
  });
  return selected;
}
export function gatherCarryWithAccount(
  troops: Record<TroopKey, Record<string, number>>,
  accountModifiers: Record<string, number>,
  numbers: any,
): number {
  const runtime = { ...(numbers.runtimeAccountModifiers ?? {}) };
  Object.entries(accountModifiers).forEach(([key, value]) => { runtime[key] = (Number(runtime[key]) || 0) + (Number(value) || 0); });
  return carryCapacity({ troops }, { ...numbers, runtimeAccountModifiers: runtime });
}
export function marchMapProgress(march: HeadlessMarch, now: number): number {
  if (march.state === "outbound") return Math.max(0, Math.min(1, (now - march.dispatchedAt) / Math.max(1, march.arriveAt - march.dispatchedAt)));
  if (march.state === "gathering") return 1;
  if (march.state !== "returning") return 0;
  const fullTravel = Math.max(1, march.arriveAt - march.dispatchedAt);
  const legacyRecallStart = march.workUntil > 0
    ? march.returnAt - fullTravel
    : (march.returnAt + march.dispatchedAt) / 2;
  const returnStartedAt = march.returnStartedAt
    || (march.outcome === "recalled" ? legacyRecallStart : march.workUntil || march.arriveAt);
  const outboundProgressAtReturn = returnStartedAt >= march.arriveAt
    ? 1
    : Math.max(0, Math.min(1, (returnStartedAt - march.dispatchedAt) / fullTravel));
  const returnProgress = (now - returnStartedAt) / Math.max(1, march.returnAt - returnStartedAt);
  return Math.max(0, Math.min(1, outboundProgressAtReturn * (1 - returnProgress)));
}
function entityLevel(entity: SelectableEntity): number { return entity.kind === "city" ? entity.townhallLevel : entity.level; }
function cityShielded(city: CityEntity, now: number, numbers: any): boolean {
  return !city.hasAttacked && (city.shieldUntil > now || city.townhallLevel < (Number(numbers.global?.shield?.protectedUntilKeepLevel) || 0));
}
function marchRemainingSec(march: HeadlessMarch, now: number): number {
  const end = march.state === "outbound" ? march.arriveAt : march.state === "gathering" ? march.workUntil : march.state === "returning" ? march.returnAt : now;
  return Math.max(0, Math.ceil((end - now) / 1000));
}

function reportCopy(report: WorldReport, world: LocalWorldSession["world"], now: number): { title: string; detail: string; good: boolean } {
  const target = localWorldTargetName(world, report.targetId);
  const good = ["victory", "scouted", "gathering_started", "gathering_completed", "delivered", "defended"].includes(report.outcome);
  if (report.stage === "return") {
    if (report.action === "scout") return { title: `Scout returned from ${target}`, detail: "Reconnaissance team returned safely.", good: true };
    const cargo = (report.payload.cargo ?? {}) as Record<string, number>;
    const delivered = RES_ORDER.map((resource) => cargo[resource] ? `${compact(displayResource(cargo[resource]))} ${RES[resource].label}` : "").filter(Boolean).join(" · ");
    return { title: `March returned from ${target}`, detail: delivered || `${compact(displayTroops(Number(report.payload.survivingTroops ?? 0)))} troops returned.`, good: true };
  }
  if (report.action === "scout") {
    if (report.outcome === "scouted" && !isScoutReportActive(report, now, world.config.scoutIntelTtlSec * 1000)) {
      return { title: `Recon decayed: ${target}`, detail: "The intelligence seal collapsed. A new scan is required.", good: false };
    }
    const snapshot = (report.payload.snapshot ?? {}) as Record<string, any>;
    const mightPart = snapshot.might != null ? ` · Might ${compact(snapshot.might)}` : "";
    return { title: `Scout report: ${target}`, detail: `In-city ${compact(displayTroops(snapshot.garrison ?? 0))} troops${mightPart} · est. loot ${compact(displayResource(snapshot.estimatedLoot ?? 0))}.`, good };
  }
  if (report.action === "gather") {
    // Shared ecology: a latecomer attacks the fleet holding the planet (docs/SHARED-ECOLOGY.md).
    const losses = (value: unknown) => { const l = value as { wounded?: number; dead?: number } | undefined; return `${compact(displayTroops(Number(l?.wounded ?? 0)))} wounded · ${compact(displayTroops(Number(l?.dead ?? 0)))} dead`; };
    if (report.outcome === "gather_won") return { title: `Seized ${target}`, detail: `Drove off the occupying fleet · ${losses(report.payload.attackerLosses)}.`, good: true };
    if (report.outcome === "gather_repelled") return { title: `Repelled at ${target}`, detail: `The occupying fleet held · ${losses(report.payload.attackerLosses)}.`, good: false };
    if (report.outcome === "gather_lost") return { title: `Driven off ${target}`, detail: `A rival fleet took the planet · kept ${compact(displayResource(Number(report.payload.keptCargo ?? 0)))} · ${losses(report.payload.holderLosses)}.`, good: false };
    if (report.outcome === "gather_defended") return { title: `Held ${target}`, detail: `Beat off a rival fleet · ${losses(report.payload.holderLosses)}.`, good: true };
    if (report.outcome === "held_by_ally") return { title: `${target} is held by an ally`, detail: "Your fleet turned back.", good: false };
    return { title: report.outcome === "target_unavailable" ? `${target} was claimed first` : `Gathering at ${target}`, detail: report.outcome === "gathering_completed" ? `${compact(displayResource(Number(report.payload.hauled ?? 0)))} supplies loaded for return.` : report.outcome.split("_").join(" "), good };
  }
  const wounded = Number(report.payload.wounded ?? (report.payload.attackerLosses as any)?.wounded ?? 0);
  const dead = Number(report.payload.dead ?? (report.payload.attackerLosses as any)?.dead ?? 0);
  return { title: `${report.outcome === "victory" ? "Victory" : report.outcome === "defeat" ? "Defeat" : "Battle result"} at ${target}`, detail: `${compact(displayTroops(wounded))} wounded · ${compact(displayTroops(dead))} dead.`, good };
}

export default function World({ address, profile, onAlliance = () => {}, onBack, onMessages = () => {}, onShop = () => {}, onProfile = () => {} }: { address: string; profile: Profile; onAlliance?: () => void; onBack: () => void; onMessages?: () => void; onShop?: () => void; onProfile?: () => void }) {
  const N = useMemo(() => getN(), []);
  const quality = useGraphicsQuality(address);
  const equippedCosmetics = useMemo(() => loadCosmeticVault(address).equipped, [address]);
  const equippedPlanetSkin = equippedCosmetics.planetBody;
  const equippedPlanetHalo = equippedCosmetics.halo;
  const equippedPlanetOrbit = equippedCosmetics.orbit;
  const voidSkinEquipped = equippedPlanetSkin === "void-touched";
  // The home planet isn't an attackable target, so it can't enter selectedId;
  // this gives it the same selection reticle when you tap it.
  const [homeSelected, setHomeSelected] = useState(false);
  const initial = useMemo(() => openLocalWorldSession(address, loadGame(address) || initGame(address), Date.now(), N), [address, N]);
  const [game, setGame] = useState<GameState>(() => initial.game);
  useEffect(() => {
    const syncActivity = (event: Event) => {
      const detail = (event as CustomEvent<{ address: string; game: GameState }>).detail;
      if (detail?.address === address.toLowerCase()) setGame(detail.game);
    };
    window.addEventListener("alliance:game-activity", syncActivity);
    return () => window.removeEventListener("alliance:game-activity", syncActivity);
  }, [address]);
  const [session, setSession] = useState<LocalWorldSession>(() => initial.session);
  const gameRef = useRef(initial.game);
  const sessionRef = useRef(initial.session);
  const [authorityVersion, setAuthorityVersion] = useState(0);
  const focusRequestedRef = useRef(false);
  const focusTakenRef = useRef<{ address: string; focus: ReturnType<typeof takeWorldFocus> } | null>(null);
  const authorityRef = useRef(0);
  const advanceBusyRef = useRef(false);
  const [now, setNow] = useState(Date.now());
  const viewerAlliance = useMemo(() => allianceForAddress(address), [address]);
  const cityRelation = (ownerId: string): AllianceRelation => {
    if (ownerId === session.playerId) return "self";
    const targetAllianceId = session.world.players[ownerId]?.allianceId ?? null;
    const actual = relationshipBetween(viewerAlliance?.id ?? null, targetAllianceId);
    if (actual !== "neutral" || targetAllianceId || !ownerId.startsWith("npc.")) return actual;
    // Local population carries deterministic diplomacy samples until a server
    // directory supplies real alliance ids. This exercises every tactical tone.
    const index = Number(ownerId.slice(-4)) || 0;
    return index % 7 === 0 ? "ally" : index % 7 === 1 ? "nap" : index % 11 === 0 ? "war" : "neutral";
  };
  const [selectedId, setSelectedId] = useState<string | null>(null);
  // Shared star map: other real commanders from the realtime presence roster.
  // Read-only for now — you can see them, open their card and message them;
  // scouting/attacking real players is the next milestone (server-side combat).
  // Returning to the Star Map paints the last view at once (cached per player), then refreshes.
  const [remotePlayers, setRemotePlayers] = useState<MapCity[]>(() => cachedView(address)?.players ?? []);
  const [rtEpoch, setRtEpoch] = useState(0); // bumps on every (re)connect snapshot → resend the map view
  // Shared world (authority v2, docs/SHARED-ECOLOGY.md): public targets arrive per map view;
  // own city, marches and reports come in the server slice. Others' fleets are known only
  // as "who occupies this planet" — never their paths (their homes stay private).
  const [viewTargets, setViewTargets] = useState<Record<string, WorldEntity>>(() => cachedView(address)?.targets ?? {});
  const [viewOccupiers, setViewOccupiers] = useState<Record<string, string>>(() => cachedView(address)?.occupiers ?? {});
  const [serverClusters, setServerClusters] = useState<SignalCluster[] | null>(() => cachedView(address)?.clusters ?? null);
  // Dense Field view: the server sent an aggregate instead of every planet.
  const [serverFieldClusters, setServerFieldClusters] = useState<SignalCluster[] | null>(() => cachedView(address)?.fieldClusters ?? null);
  useEffect(() => {
    VIEW_CACHE.set(address, { at: Date.now(), targets: viewTargets, occupiers: viewOccupiers, clusters: serverClusters, fieldClusters: serverFieldClusters, players: remotePlayers });
  }, [address, viewTargets, viewOccupiers, serverClusters, serverFieldClusters, remotePlayers]);
  const searchReplyRef = useRef<((result: { total: number; target: unknown | null }) => void) | null>(null);
  const [remoteSelectedId, setRemoteSelectedId] = useState<string | null>(null);
  // A shared commander card opened from chat: select that planet once it arrives in view.
  const pendingRemoteFocusRef = useRef<string | null>(null);
  useEffect(() => {
    const id = pendingRemoteFocusRef.current;
    if (!id || !remotePlayers.some((p) => p.id === id)) return;
    pendingRemoteFocusRef.current = null;
    setRemoteSelectedId(id); setSelectedId(null); setTileMark(null);
  }, [remotePlayers]);
  const [cardHint, setCardHint] = useState<string | null>(null);
  // My own spawn coordinate, owned by the server (shared map). Once known, the
  // home city is moved here so "where I see my home" == "where others see me".
  const [serverHomeCoord, setServerHomeCoord] = useState<Point | null>(null);
  // Recon on other commanders from server "recon" reports; the commander card shows it
  // expanded until the intel expires (numbers.json march.scoutIntelTtlSeconds).
  const [recon, setRecon] = useState<Record<string, ReconIntel>>({});
  const [scoutingId, setScoutingId] = useState<string | null>(null);
  // Disabled buttons swallow mouseleave; clear the hint whenever the card or scan state changes.
  useEffect(() => { setCardHint(null); }, [remoteSelectedId, scoutingId]);
  const [marches, setMarches] = useState<LiveMarch[]>([]);
  const rtRef = useRef<RealtimeClient | null>(null);
  useEffect(() => {
    const rt = new RealtimeClient(address, profile.name || "Commander");
    rtRef.current = rt;
    const keep = (list: PresenceCity[]) => list.filter((p): p is MapCity => p.id !== address && hasCoords(p));
    rt.handlers.onSnapshot = (_you, players, _chat, _dms, reports, snapMarches) => {
      const known: Record<string, ReconIntel> = {};
      for (const report of reports || []) { const entry = reconFromReport(report); if (entry) known[entry[0]] = entry[1]; }
      setRecon(known);
      // The roster carries no coordinates for others; keep cities already placed from a view
      // answer (if they are still in the world) until the next view refreshes them.
      const fresh = keep(players);
      const onRoster = new Set(players.map((p) => p.id));
      setRemotePlayers((cur) => [...cur.filter((x) => onRoster.has(x.id) && !fresh.some((p) => p.id === x.id)), ...fresh]);
      setRtEpoch((value) => value + 1);
      setMarches(snapMarches || []);
      const mine = players.find((p) => p.id === address)?.coords;
      if (mine && Number.isFinite(mine.x) && Number.isFinite(mine.y)) setServerHomeCoord({ x: mine.x, y: mine.y });
    };
    rt.handlers.onPlayer = (p) => {
      if (p.id === address) return;
      // No coordinates = outside our view (or it warped away): drop it from the map.
      const id = p.id;
      if (!hasCoords(p)) { setRemotePlayers((cur) => cur.filter((x) => x.id !== id)); return; }
      setRemotePlayers((cur) => { const i = cur.findIndex((x) => x.id === p.id); if (i < 0) return [...cur, p]; const next = cur.slice(); next[i] = p; return next; });
    };
    rt.handlers.onPlayerRemoved = (id) => setRemotePlayers((cur) => cur.filter((x) => x.id !== id));
    rt.handlers.onViewPlayers = (rect, list, shared) => {
      const fresh = keep(list);
      setRemotePlayers((cur) => [...cur.filter((x) => !rectHas(rect, x.coords) && !fresh.some((p) => p.id === x.id)), ...fresh]);
      if (shared?.clusters) { setServerFieldClusters(shared.clusters); return; }
      if (shared?.targets) {
        setServerFieldClusters(null);
        const targets = shared.targets as WorldEntity[];
        setViewTargets((cur) => {
          const next: Record<string, WorldEntity> = {};
          for (const [id, entity] of Object.entries(cur)) if (!rectHas(rect, entity.position)) next[id] = entity;
          for (const entity of targets) next[entity.id] = entity;
          return next;
        });
        setViewOccupiers((cur) => ({ ...cur, ...(shared.occupiers ?? {}) }));
      }
    };
    rt.handlers.onViewClusters = (clusters) => setServerClusters(clusters);
    rt.handlers.onSearchResult = (result) => searchReplyRef.current?.(result);
    rt.handlers.onMarch = (m) => {
      if (m.kind === "scout") setScoutingId(null);
      setMarches((cur) => cur.some((x) => x.id === m.id) ? cur : [...cur, m]);
    };
    rt.handlers.onMarchDone = (id) => setMarches((cur) => cur.filter((x) => x.id !== id));
    rt.handlers.onMarchRejected = (reason) => setResultNotice({ title: "March blocked", detail: reason === "shielded" ? "That city is shielded — it can't be attacked." : reason === "no_troops" ? "You have no troops to send." : "March was rejected.", good: false });
    // Live alarms (also filed to Comms > System).
    rt.handlers.onReport = (report) => {
      const entry = reconFromReport(report);
      if (entry) {
        setRecon((current) => ({ ...current, [entry[0]]: entry[1] }));
        setResultNotice({ title: "Recon complete", detail: `Intel on ${entry[1].name} is on their card for ${Math.round((entry[1].expiresAt - report.ts) / 60_000)} min.`, good: true });
      } else if (report.kind === "scouted") setResultNotice({ title: "You were scouted", detail: `${report.byName || "A commander"} scanned your city.`, good: false });
      else if (report.kind === "incoming") setResultNotice({ title: "⚔ Incoming attack", detail: `${report.byName || "A commander"} is marching on you — ETA ${Math.round(Number(report.payload?.etaSec) || 0)}s.`, good: false });
      else if (report.kind === "battle") setResultNotice({ title: "Battle report", detail: String(report.payload?.summary || "A battle resolved."), good: false });
      else if (report.kind === "relocated") setResultNotice({ title: "Welcome back", detail: String(report.payload?.summary || "Your city moved to a new sector."), good: true });
    };
    const g = loadGame(address);
    rt.sendPresence({
      name: profile.name, faction: profile.factionSymbol || null,
      keepLevel: g?.buildings?.keep?.lvl ?? 1,
      might: g ? mightBreakdown(project(g, Date.now())).total : 0,
      cosmetics: loadCosmeticVault(address).equipped,
      avatar: profile.avatarId || "genesis",
    });
    return () => rt.close();
  }, [address, profile.name, profile.factionSymbol]);
  // Presence liveness: re-broadcast when the publicly-visible fields change (keep
  // level, faction, name, cosmetics) so others see fresh stats without a scan.
  // Might stays scan-gated, so we don't poll it — event-driven is enough until
  // alliance/leaderboards need faster, targeted refresh.
  useEffect(() => {
    rtRef.current?.sendPresence({
      name: profile.name, faction: profile.factionSymbol || null,
      keepLevel: game.buildings.keep.lvl,
      might: mightBreakdown(project(game, Date.now())).total,
      cosmetics: loadCosmeticVault(address).equipped,
      avatar: profile.avatarId || "genesis",
    });
  }, [game.buildings.keep.lvl, profile.factionSymbol, profile.name, profile.avatarId, address]);
  const [selection, setSelection] = useState<Record<TroopKey, Record<string, number>>>(emptySelection);
  const [message, setMessage] = useState(initial.session.migratedLegacyAt ? "Old World marches were safely settled and migrated." : "");
  const [zoom, setZoom] = useState(1.8);
  const [layers, setLayers] = useState<Record<WorldLayer, boolean>>({ resource: true, monster: true, city: true });
  const [coordinateDraft, setCoordinateDraft] = useState({ x: "", y: "" });
  const [bookmarks, setBookmarks] = useState<string[]>(() => loadBookmarks(address));
  const [resultNotice, setResultNotice] = useState<ResultNotice | null>(null);
  const [tileMark, setTileMark] = useState<Point | null>(null);
  const [strikeBurstNonce, setStrikeBurstNonce] = useState(0);
  const playerCity = session.world.entities[session.world.players[session.playerId].cityId] as CityEntity;
  const [camera, setCamera] = useState<Point>(() => ({ ...playerCity.position }));
  const svgRef = useRef<SVGSVGElement>(null);
  const overlayRef = useRef<SVGSVGElement>(null);
  const [mapPx, setMapPx] = useState({ w: 1, h: 1 });
  useEffect(() => {
    const el = svgRef.current;
    if (!el) return;
    const measure = () => { if (el.clientWidth && el.clientHeight) setMapPx({ w: el.clientWidth, h: el.clientHeight }); };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  // null = WebGL still initialising, true = drawing, false = unavailable (SVG fallback).
  // The SVG fallback must not flash in while WebGL is merely compiling shaders.
  const [gpuVisualsState, setGpuVisualsReady] = useState<boolean | null>(null);
  const gpuVisualsReady = gpuVisualsState === true;
  const gpuFallback = gpuVisualsState === false;
  // True while the WebGL Void-Touched shader is actively covering the home planet;
  // when so, we hide the SVG skin underneath to avoid a doubled halo.
  const [voidShaderActive, setVoidShaderActive] = useState(false);
  const drag = useRef<{ x: number; y: number; camera: Point; moved: boolean } | null>(null);
  const pendingCamera = useRef<Point | null>(null);
  const dispatchSeq = useRef(0);
  const seenReportCount = useRef(initial.session.world.players[initial.session.playerId].reportIds.length);
  const gm = hasLocalGm(address);

  useEffect(() => { gameRef.current = game; }, [game]);
  useEffect(() => { sessionRef.current = session; }, [session]);
  useEffect(() => { authorityRef.current = authorityVersion; }, [authorityVersion]);
  useEffect(() => {
    const opened = openLocalWorldSession(address, loadGame(address) || initGame(address), Date.now(), N);
    opened.session.world.players[opened.session.playerId].allianceId = profile.faction;
    setGame(opened.game); gameRef.current = opened.game; setSession(opened.session); sessionRef.current = opened.session;
    const city = opened.session.world.entities[opened.session.world.players[opened.session.playerId].cityId] as CityEntity;
    // Take the queued focus once per address (StrictMode re-runs this effect; the second
    // run must see the same request, not an empty queue).
    if (focusTakenRef.current?.address !== address) focusTakenRef.current = { address, focus: takeWorldFocus(address) };
    const requestedFocus = focusTakenRef.current.focus;
    focusRequestedRef.current = !!requestedFocus;
    const focusedEntity = requestedFocus?.targetId ? opened.session.world.entities[requestedFocus.targetId] : null;
    if (requestedFocus) {
      if (requestedFocus.targetId && !focusedEntity) pendingRemoteFocusRef.current = requestedFocus.targetId;
      const position = focusedEntity?.position || requestedFocus.position;
      setCamera({ ...position });
      setZoom(focusedEntity?.kind === "city" || !focusedEntity ? 3.2 : 2.1);
      setSelectedId(focusedEntity && (focusedEntity.kind === "resource" || focusedEntity.kind === "monster" || (focusedEntity.kind === "city" && focusedEntity.ownerId !== opened.session.playerId)) ? focusedEntity.id : null);
      setTileMark(focusedEntity ? null : { x: Math.floor(position.x), y: Math.floor(position.y) });
    } else {
      setCamera({ ...city.position });
    }
    saveGame(opened.game); saveLocalWorldSession(opened.session);
    setBookmarks(loadBookmarks(address));
    seenReportCount.current = opened.session.world.players[opened.session.playerId].reportIds.length;
    if (opened.session.migratedLegacyAt) setMessage("Old World marches were safely settled and migrated.");
  }, [address, N, profile.faction]);
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const localGame = project(loadGame(address) || gameRef.current, Date.now());
      const opened = openLocalWorldSession(address, localGame, Date.now(), N);
      const remote = await ensureGameAuthority(address, opened.game, opened.session);
      if (!remote || cancelled) return;
      if (cancelled || remote.authorityVersion <= 0 || !remote.game || !remote.world) return;
      const nextSession = remote.world as LocalWorldSession;
      const nextGame = remote.game as GameState;
      authorityRef.current = remote.authorityVersion;
      setAuthorityVersion(remote.authorityVersion);
      sessionRef.current = nextSession; gameRef.current = nextGame;
      setSession(nextSession); setGame(nextGame);
      saveLocalWorldSession(nextSession); saveGame(nextGame);
      seenReportCount.current = nextSession.world.players[nextSession.playerId]?.reportIds.length || 0;
      // The server home can differ from the provisional local one: frame it unless the
      // player arrived here to look at something specific.
      const serverHome = nextSession.world.entities[nextSession.world.players[nextSession.playerId]?.cityId];
      if (serverHome && !focusRequestedRef.current) setCamera({ ...serverHome.position });
    })().catch(() => {
      if (!cancelled) setMessage("Command link unavailable. Progress remains safe on this device; reconnect to continue server play.");
    });
    return () => { cancelled = true; };
  }, [address]);
  // Shared-map coordinate unification: once the server hands us our spawn coord,
  // move the home city there (PvE targets are placed globally by radius, so only
  // the city moves) and recenter. Runs once per distinct coord.
  useEffect(() => {
    if (!serverHomeCoord) return;
    const s = sessionRef.current;
    const cityId = s.world.players[s.playerId]?.cityId;
    const city = cityId ? (s.world.entities[cityId] as CityEntity | undefined) : undefined;
    if (!cityId || !city) return;
    if (Math.round(city.position.x) === Math.round(serverHomeCoord.x) && Math.round(city.position.y) === Math.round(serverHomeCoord.y)) return;
    const next: LocalWorldSession = { ...s, world: { ...s.world, entities: { ...s.world.entities, [cityId]: { ...city, position: { ...serverHomeCoord }, zone: zoneForPoint(serverHomeCoord, s.world.config) } } } };
    sessionRef.current = next; setSession(next); saveLocalWorldSession(next);
    setCamera({ ...serverHomeCoord });
  }, [serverHomeCoord]);
  useEffect(() => {
    const timer = window.setInterval(() => {
      const tick = Date.now(); setNow(tick);
      if (authorityRef.current > 0) {
        const due = sessionRef.current.world.scheduledEvents
          .filter((event) => !event.processedAt && event.at <= tick)
          .sort((a, b) => a.at - b.at)[0];
        if (!due || advanceBusyRef.current) return;
        advanceBusyRef.current = true;
        const key = `world-advance:${due.id}:${due.at}`;
        void sendWorldCommandWithRetry("world.advance", {}, key)
          .then((result) => { if (result.ok && result.world && result.game) commitServer(result); })
          .finally(() => { advanceBusyRef.current = false; });
        return;
      }
      const result = advanceLocalWorldSession(sessionRef.current, loadGame(address) || gameRef.current, tick, N);
      if (!result.changed) return;
      const reports = result.session.world.players[result.session.playerId].reportIds;
      if (reports.length > seenReportCount.current) {
        const report = result.session.world.reports[reports[reports.length - 1]];
        if (report) setResultNotice(reportCopy(report, result.session.world, tick));
        seenReportCount.current = reports.length;
      }
      sessionRef.current = result.session; setSession(result.session);
      setGame(result.game); gameRef.current = result.game; saveGame(result.game); saveLocalWorldSession(result.session);
    }, 1000);
    return () => window.clearInterval(timer);
  }, [address, N]);
  useEffect(() => {
    try { localStorage.setItem(`ruglands:world-bookmarks:${address.toLowerCase()}`, JSON.stringify(bookmarks)); } catch {}
  }, [address, bookmarks]);
  // Map search (mainstream SLG pattern): pick a kind + level, jump to the nearest
  // free match from home; pressing again steps to the next nearest.
  const [warpOpen, setWarpOpen] = useState(false);
  const [warpBusy, setWarpBusy] = useState(false);
  const [warpCounts, setWarpCounts] = useState<{ precision: number; drift: number } | null>(null);
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchKind, setSearchKind] = useState<SearchTab>("monster");
  const [searchLevels, setSearchLevels] = useState<Record<SearchKind, number>>({ monster: 0, cash: 1, oil: 1, power: 1 });
  const [searchResult, setSearchResult] = useState<{ key: string; index: number; total: number; targetId: string } | null>(null);
  const sharedMode = authorityVersion >= 2;
  const world = useMemo(() => {
    if (!sharedMode) return session.world;
    const entities: Record<string, WorldEntity> = { ...viewTargets };
    for (const [id, entity] of Object.entries(session.world.entities)) {
      const seen = entities[id];
      if (!seen || entity.revision >= seen.revision) entities[id] = entity;
    }
    return { ...session.world, entities };
  }, [sharedMode, session.world, viewTargets]);
  // Occupation lookups also know other players' occupying fleets (owner only).
  const occupationMarches = useMemo(() => {
    if (!sharedMode) return world.marches;
    const marches: Record<string, Pick<HeadlessMarch, "playerId">> = {};
    for (const [marchId, playerId] of Object.entries(viewOccupiers)) marches[marchId] = { playerId };
    return { ...marches, ...world.marches };
  }, [sharedMode, world.marches, viewOccupiers]);
  const viewGame = useMemo(() => project(game, now), [game, now]);
  const targets = useMemo(() => Object.values(world.entities).filter((entity): entity is SelectableEntity => entity.kind === "resource" || entity.kind === "monster" || (entity.kind === "city" && entity.ownerId !== session.playerId)), [world.entities, session.playerId]);
  const detailZoom = zoom >= WORLD_TACTICAL_ZOOM;
  const selectedCandidate = targets.find((target) => target.id === selectedId) || null;
  const selected = selectedCandidate && worldTargetObservable(selectedCandidate.kind, zoom) ? selectedCandidate : null;
  useEffect(() => {
    if (detailZoom || selectedCandidate?.kind !== "city") return;
    setSelectedId(null);
    setSelection(emptySelection());
  }, [detailZoom, selectedCandidate]);
  const selectedCityCosmetics = selected?.kind === "city" ? world.players[selected.ownerId]?.cosmetics || ISSUED_WORLD_COSMETICS : null;
  const selectedCoreName = selectedCityCosmetics ? PLANET_SKINS.find((skin) => skin.id === selectedCityCosmetics.planetBody)?.name || "Dust Homestead" : "";
  const selectedHaloName = selectedCityCosmetics ? PLANET_HALOS.find((halo) => halo.id === selectedCityCosmetics.halo)?.name || "Unbound" : "";
  const selectedOrbitName = selectedCityCosmetics ? PLANET_ORBITS.find((orbit) => orbit.id === selectedCityCosmetics.orbit)?.name || "Unbound" : "";
  const allActiveMarches = Object.values(world.marches).filter((march) => !["completed", "failed"].includes(march.state));
  const activeMarches = allActiveMarches.filter((march) => march.playerId === session.playerId);
  const mapMarches = allActiveMarches.filter((march) => worldMarchObservable(march.playerId, session.playerId, zoom));
  const sentCount = TROOP_ORDER.reduce((sum, arm) => sum + Object.values(selection[arm]).reduce((subtotal, qty) => subtotal + (qty || 0), 0), 0);
  const zoomFloor = worldZoomFloor(world.config.width);
  const viewport = { width: WORLD_VIEW_SPAN / zoom, height: WORLD_VIEW_SPAN * .655 / zoom };
  // The camera may look beyond a State edge. This is intentional: a node near
  // the rim must still be able to occupy the true visual center of the screen.
  const viewX = camera.x - viewport.width / 2;
  const viewY = camera.y - viewport.height / 2;
  const renderViewBox = `${camera.x - viewport.width * WORLD_PAN_OVERSCAN / 2} ${camera.y - viewport.height * WORLD_PAN_OVERSCAN / 2} ${viewport.width * WORLD_PAN_OVERSCAN} ${viewport.height * WORLD_PAN_OVERSCAN}`;
  // All visual engines consume one live camera snapshot. During a pan the SVG
  // planes use a composited transform while WebGL/Canvas read this snapshot;
  // React state and SVG viewBoxes commit once on release. This avoids rebuilding
  // the full map 60–200 times/second and keeps every layer on the same camera.
  const liveViewportRef = useRef<WorldViewport>({ x: viewX, y: viewY, width: viewport.width, height: viewport.height });
  const zoomRef = useRef(zoom); zoomRef.current = zoom;
  const cameraRef = useRef(camera); cameraRef.current = camera;
  // Live zoom. Wheel/pinch and the +/- buttons move a live zoom that canvas layers
  // read every frame; the SVG plane is scaled on the compositor. React commits the
  // zoom every ~90ms (and whenever the plane drifts >15% from what it rasterised),
  // so SVG markers and name plates never stretch far from their true size.
  const liveZoom = useRef<number | null>(null);
  const lastZoomCommit = useRef(0);
  const zoomSettle = useRef<number | undefined>(undefined);
  const zoomTween = useRef(0);
  useEffect(() => () => { window.clearTimeout(zoomSettle.current); cancelAnimationFrame(zoomTween.current); }, []);
  function commitZoom(z: number) { lastZoomCommit.current = performance.now(); setZoom(z); }
  function applyLiveZoom(requested: number) {
    const z = Math.max(worldZoomFloor(sessionRef.current.world.config.width), Math.min(WORLD_MAX_ZOOM, requested));
    liveZoom.current = z;
    const baseW = WORLD_VIEW_SPAN, baseH = WORLD_VIEW_SPAN * .655, cam = cameraRef.current;
    liveViewportRef.current = { x: cam.x - baseW / z / 2, y: cam.y - baseH / z / 2, width: baseW / z, height: baseH / z };
    const drift = z / zoomRef.current;
    const planeTransform = `translate3d(0,0,0) scale(${WORLD_PAN_OVERSCAN * drift})`;
    if (svgRef.current) svgRef.current.style.transform = planeTransform;
    if (overlayRef.current) overlayRef.current.style.transform = planeTransform;
    markWorldMotion();
    if (performance.now() - lastZoomCommit.current > 90 || Math.abs(Math.log(drift)) > Math.log(1.15)) commitZoom(z);
    window.clearTimeout(zoomSettle.current);
    zoomSettle.current = window.setTimeout(() => { if (liveZoom.current != null && liveZoom.current !== zoomRef.current) commitZoom(liveZoom.current); liveZoom.current = null; }, 120);
  }
  const currentZoom = () => liveZoom.current ?? zoomRef.current;
  // Proportional wheel zoom: a mouse notch (deltaY≈100) ≈ 14%; trackpad pinch
  // (ctrlKey) and momentum scroll produce small deltas and zoom smoothly.
  function onMapWheel(event: WheelEvent) {
    event.preventDefault();
    cancelAnimationFrame(zoomTween.current);
    const delta = event.deltaMode === 1 ? event.deltaY * 33 : event.deltaY;
    const factor = Math.exp(-delta * (event.ctrlKey ? .01 : .0013));
    applyLiveZoom(currentZoom() * Math.max(.8, Math.min(1.25, factor)));
  }
  const wheelHandler = useRef(onMapWheel); wheelHandler.current = onMapWheel;
  useEffect(() => {
    const el = svgRef.current;
    if (!el) return;
    // Native, non-passive listener: React's onWheel is passive, so preventDefault was ignored.
    const listener = (event: WheelEvent) => wheelHandler.current(event);
    el.addEventListener("wheel", listener, { passive: false });
    return () => el.removeEventListener("wheel", listener);
  }, []);
  function animateZoomTo(requested: number) {
    const target = Math.max(worldZoomFloor(sessionRef.current.world.config.width), Math.min(WORLD_MAX_ZOOM, requested));
    const from = currentZoom();
    cancelAnimationFrame(zoomTween.current);
    if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) { applyLiveZoom(target); return; }
    const started = performance.now();
    const step = (time: number) => {
      const k = Math.min(1, (time - started) / 200), eased = 1 - Math.pow(1 - k, 3);
      applyLiveZoom(Math.exp(Math.log(from) + (Math.log(target) - Math.log(from)) * eased));
      if (k < 1) zoomTween.current = requestAnimationFrame(step);
    };
    zoomTween.current = requestAnimationFrame(step);
  }
  useLayoutEffect(() => {
    liveViewportRef.current = { x: viewX, y: viewY, width: viewport.width, height: viewport.height };
    const restingTransform = `translate3d(0,0,0) scale(${WORLD_PAN_OVERSCAN})`;
    if (svgRef.current) svgRef.current.style.transform = restingTransform;
    if (overlayRef.current) overlayRef.current.style.transform = restingTransform;
  }, [viewX, viewY, viewport.width, viewport.height]);
  const center = worldCenter(world.config);
  const worldRadius = worldPlayableRadius(world.config);
  const player = world.players[session.playerId];
  const marchSpeed = Math.max(.01, 1 + (Number(N.global?.accountModifiers?.marchSpeedBonus) || 0)
    + (Number(player.accountModifiers.marchSpeedBonus) || 0));
  const marchCapacity = Math.floor(player.marchCapacity * (1 + (Number(N.global?.accountModifiers?.marchCapacityBonus) || 0)
    + (Number(player.accountModifiers.marchCapacityBonus) || 0)));
  const travelSecondsTo = (point: Point) => distance(playerCity.position, point) * world.config.travelSecondsPerTile / marchSpeed;
  const oneWay = selected ? travelSecondsTo(selected.position) : 0;
  const scoutSpeedMultiplier = Math.max(1, Number(N.global?.march?.scoutSpeedMultiplier) || 3);
  const scoutOneWay = oneWay / scoutSpeedMultiplier;
  const forceLimit = marchCapacity;
  const energy = energyAt(player, now, world.config);
  // Rogues unlock sequentially: you may engage up to (highest defeated + 1).
  const rogueMaxLevel = worldRogueMaxLevel(N);
  const resourceMaxLevel = worldResourceMaxLevel(N);
  const frontierComplete = player.highestMonsterDefeated >= rogueMaxLevel;
  const nextRogueLevel = Math.min(rogueMaxLevel, player.highestMonsterDefeated + 1);
  const rogueLocked = !!selected && selected.kind === "monster"
    && (selected.level > nextRogueLevel || selected.level > rogueMaxLevel);
  const selectedCarry = selected?.kind === "resource" ? gatherCarryWithAccount(selection, player.accountModifiers, N) : 0;
  const expectedHarvest = selected?.kind === "resource" ? Math.floor(Math.min(selectedCarry, selected.amount)) : 0;
  // While a harvest march works this planet, show its liquidity draining in real time
  // (the engine only settles the deduction on return, so this is a projected read).
  const activeGatherOnSelected = selected?.kind === "resource" ? activeMarches.find((m) => m.targetId === selected.id && m.action === "gather" && m.state === "gathering") : undefined;
  const liveSelectedAmount = (() => {
    if (!selected || selected.kind !== "resource") return 0;
    if (!activeGatherOnSelected) return selected.amount;
    const m = activeGatherOnSelected;
    const progress = Math.max(0, Math.min(1, (now - m.arriveAt) / Math.max(1, m.workUntil - m.arriveAt)));
    const reserved = Math.floor(Math.min(gatherCarryWithAccount(m.force, player.accountModifiers, N), selected.amount));
    return Math.max(0, selected.amount - Math.floor(reserved * progress));
  })();
  // Mission Archive = settled RESULTS only. In-flight gather milestones are already
  // shown live (with countdowns) in Live Fleets, so they are excluded here to avoid duplication.
  const latestReports = player.reportIds.slice().reverse().map((id) => world.reports[id]).filter((report) => report && !ARCHIVE_HIDDEN_OUTCOMES.has(report.outcome)).slice(0, 6);
  const strategicZoom = zoom < 1.45;
  const markerScale = worldMarkerScale(zoom);
  // Strategic → Field is a smooth band, so the home planet and its name plate
  // grow/shrink together instead of jumping in opposite directions at 145%.
  const strategicBlend = worldStrategicBlend(zoom);
  const importantScale = (1.6 + (1.18 - 1.6) * strategicBlend) / zoom;
  const worldPerPxEarly = Math.max(viewport.width / Math.max(1, mapPx.w), viewport.height / Math.max(1, mapPx.h));
  // In Tactical the home planet keeps growing; the plate grows with it
  // (sub-linearly, ^0.7) and stays the same gap below the planet body.
  const homeBodyPx = worldVisualBodyRadius(zoom, true, false, CALM_MAP);
  const homeTagGrowth = zoom > WORLD_TACTICAL_ZOOM ? Math.pow(homeBodyPx / worldVisualBodyRadius(WORLD_TACTICAL_ZOOM, true, false, CALM_MAP), .7) : 1;
  // Home plate: smaller when zoomed all the way out (0.95 → 1.18 across the
  // Strategic band) and growing with the planet in Tactical.
  const homeTagBase = (.95 + (1.18 - .95) * strategicBlend) / zoom;
  const homeTagScale = homeTagBase * homeTagGrowth;
  // One rule at every zoom: the plate sits a fixed screen gap below the planet body the
  // visual layer actually draws, so it never drifts against the planet while zooming.
  const homeIdentityOffset = mapPx.w <= 10
    ? worldIdentityLocalOffset(zoom, true)
    : (homeBodyPx + 12 * homeTagGrowth) * worldPerPxEarly / homeTagScale;
  const rivalIdentityOffset = worldIdentityLocalOffset(zoom, false);
  // The home planet must read as clearly the biggest body on the map at every
  // zoom. importantScale is a flat 1/zoom shrink, so in deep Tactical view it
  // fell BELOW a resource planet (whose worldMarkerScale grows via tacticalBoost).
  // Track that same growth curve and stay ~1.35x above it.
  const homeScale = strategicZoom ? 2 / zoom : worldMarkerScale(zoom) * 1.35;
  // Selection ring radius in WORLD units: the planet's on-screen body radius is
  // in px (grows with zoom via LOD), so convert px→world and wrap at 3.35× the
  // body — just outside the halo/orbit — with a non-scaling (constant-thin) stroke.
  const worldPerPx = Math.max(viewport.width / mapPx.w, viewport.height / mapPx.h);
  // Map 2048: quadrants that are not open yet render as sealed (no targets, no warp).
  const sealedQuadrants = useMemo(() => world.config.openQuadrants ? [0, 1, 2, 3].filter((quadrant) => !world.config.openQuadrants!.includes(quadrant)) : [],
    [world.config.openQuadrants]);
  const selectionRadius = (own: boolean, sel: boolean) => worldVisualBodyRadius(zoom, own, sel, CALM_MAP) * 2.85 + 8;
  // ~1.1 tile radius, clamped so resources stay readable yet always read smaller than a city.
  // The cap itself grows with depth (11px at Tactical entry → 17px at 1600%) so a
  // deep zoom still rewards the player with a larger, inspectable planet.
  const calmDepth = Math.max(0, Math.min(1, Math.log2(Math.max(1, zoom) / WORLD_TACTICAL_ZOOM) / Math.log2(WORLD_MAX_ZOOM / WORLD_TACTICAL_ZOOM)));
  const calmTargetRadiusPx = detailZoom ? Math.max(8, Math.min(11 + calmDepth * 6, 1.1 / Math.max(.0001, worldPerPx))) : Math.max(3.5, Math.min(6, .9 / Math.max(.0001, worldPerPx)));
  // Until the map box has been measured (mapPx starts at 1×1) worldPerPx is huge;
  // fall back to the default marker scale so the first frame is not a wall of Rogues.
  const calmTargetScale = mapPx.w > 10 && mapPx.h > 10 ? calmTargetRadiusPx * worldPerPx / (detailZoom ? 7.2 : 4.2) : markerScale;
  const filteredTargets = useMemo(() => targets.filter((entity) => layers[entity.kind]
    && worldTargetObservable(entity.kind, zoom)
    && !(entity.kind === "resource" && entity.state === "depleted")
    && !(entity.kind === "monster" && entity.state === "defeated")), [layers, targets, zoom]);
  const nearbySignals = useMemo(() => filteredTargets.filter((target) => target.kind !== "city")
    .sort((left, right) => distance(playerCity.position, left.position) - distance(playerCity.position, right.position))
    .slice(0, 3), [filteredTargets, playerCity.position.x, playerCity.position.y]);
  const signalClusters = useMemo(() => sharedMode && serverClusters
    ? serverClusters.filter((cluster) => layers[cluster.kind])
    : clusterWorldSignals(filteredTargets, 72), [sharedMode, serverClusters, layers, filteredTargets]);
  const bookmarkedTargets = bookmarks.map((id) => targets.find((target) => target.id === id)).filter((target): target is SelectableEntity => !!target);
  const scoutIntelTtlMs = world.config.scoutIntelTtlSec * 1000;
  const scoutedTargetIds = useMemo(() => new Set(player.reportIds.map((id) => world.reports[id]).filter((report): report is WorldReport => !!report && isScoutReportActive(report, now, scoutIntelTtlMs)).map((report) => report.targetId)), [now, player.reportIds, scoutIntelTtlMs, world.reports]);
  const selectedScoutReport = selected ? player.reportIds.slice().reverse().map((id) => world.reports[id]).find((report) => report?.targetId === selected.id && isScoutReportActive(report, now, scoutIntelTtlMs)) : undefined;
  const selectedScoutSnapshot = (selectedScoutReport?.payload.snapshot ?? {}) as Record<string, any>;
  const selectedVerified = !!selected && (selected.kind === "resource" || scoutedTargetIds.has(selected.id));
  const selectedIntelRemainingSec = selectedScoutReport ? Math.max(0, Math.ceil((scoutReportExpiresAt(selectedScoutReport, scoutIntelTtlMs) - now) / 1000)) : 0;
  const selectedOccupation = selected?.kind === "resource"
    ? resourceOccupationDisposition(selected, occupationMarches, world.players, session.playerId, profile.faction)
    : "neutral";
  const zoomLabel = strategicZoom ? "STRATEGIC" : detailZoom ? "TACTICAL" : "FIELD";
  const renderStressCount = gm
    ? Math.max(0, Math.min(50_000, Math.floor(Number(new URLSearchParams(window.location.search).get("stress")) || 0)))
    : 0;
  const strikeStressCount = gm
    ? Math.max(0, Math.min(512, Math.floor(Number(new URLSearchParams(window.location.search).get("strikeStress")) || 0)))
    : 0;
  const stressVisuals = useMemo(
    () => createWorldVisualStress(renderStressCount, world.config.width, world.config.height),
    [renderStressCount, world.config.width, world.config.height],
  );
  const cityEntities = useMemo(
    () => Object.values(world.entities).filter((entity): entity is CityEntity => entity.kind === "city"),
    [world.entities],
  );
  const visualCities = useMemo(() => {
    const live = cityEntities
      .filter((entity) => entity.ownerId === session.playerId || (detailZoom && layers.city))
      .map((city): WorldVisualCity => {
        // Your own planet always shows what you have equipped right now; the world
        // snapshot's copy can lag (it arrives from the server after first paint).
        const cosmetics = city.ownerId === session.playerId ? { ...ISSUED_WORLD_COSMETICS, ...equippedCosmetics } : world.players[city.ownerId]?.cosmetics || ISSUED_WORLD_COSMETICS;
        return {
          id: city.id,
          position: city.position,
          skin: cosmetics.planetBody,
          halo: cosmetics.halo,
          orbit: cosmetics.orbit,
          own: city.ownerId === session.playerId,
          selected: city.id === selectedId,
          burning: city.state === "burning",
        };
      });
    // Other real commanders (shared map) use the same planet renderer as your own city, so
    // their halo/orbit look identical instead of a tight SVG ring.
    const remote = !strategicZoom && layers.city ? remotePlayers.map((p): WorldVisualCity => {
      const cos = (p.cosmetics || {}) as { planetBody?: string; halo?: string; orbit?: string };
      return {
        id: `rp-${p.id}`, position: p.coords,
        skin: (PLANET_SKINS.some((skin) => skin.id === cos.planetBody) ? cos.planetBody : ISSUED_WORLD_COSMETICS.planetBody) as PlanetSkinId,
        halo: (PLANET_HALOS.some((halo) => halo.id === cos.halo) ? cos.halo : null) as PlanetHaloId | null,
        orbit: (PLANET_ORBITS.some((orbit) => orbit.id === cos.orbit) ? cos.orbit : null) as PlanetOrbitId | null,
        selected: p.id === remoteSelectedId,
      };
    }) : [];
    return live.concat(remote, detailZoom ? stressVisuals : []);
  }, [cityEntities, detailZoom, strategicZoom, layers.city, selectedId, session.playerId, stressVisuals, world.players, equippedCosmetics, remotePlayers, remoteSelectedId]);
  const monsterPreview = useMemo(() => {
    if (!selected || selected.kind !== "monster" || sentCount <= 0) return null;
    const runtime = { ...(N.runtimeAccountModifiers ?? {}) };
    Object.entries(player.accountModifiers).forEach(([key, value]) => { runtime[key] = (Number(runtime[key]) || 0) + (Number(value) || 0); });
    const tuned = structuredClone(N);
    tuned.runtimeAccountModifiers = runtime;
    tuned.global.combat.casualtyScaling = Number(N.world?.monsters?.casualtyScaling) || 0;
    tuned.global.combat.woundedRatio = Number(N.world?.monsters?.woundedRatio) || 0;
    const hospitalRow = N.buildings?.["building.hospital"]?.levels?.[String(Math.max(1, viewGame.buildings.hospital.lvl))];
    const hospitalOpen = Math.max(0, (Number(hospitalRow?.woundedCapacity) || 0) - viewGame.wounded);
    return resolveCombat({ troops: selection }, {
      kind: "monster", level: selected.level, power: selected.power,
      reward: selected.reward, dominantArm: selected.dominantArm,
    }, tuned, hospitalOpen);
  }, [N, player.accountModifiers, selected, selection, sentCount, viewGame.buildings.hospital.lvl, viewGame.wounded]);

  // Viewport culling on a coarse grid. We only build markers near the visible
  // region, and recompute on a grid step (~1/3 screen) with a full-screen margin
  // on every side — so an ordinary drag stays inside an already-rendered band
  // (nothing pops in) AND the memoized marker layer below is not rebuilt frame by
  // frame. At higher populations / larger maps this is what keeps the cost flat.
  const cullCell = Math.max(16, Math.round(Math.min(viewport.width, viewport.height) / 3));
  const cullQX = Math.round(camera.x / cullCell);
  const cullQY = Math.round(camera.y / cullCell);

  // LAYER 1 — static scaffold (grid, rings, wormhole core). Never depends on the
  // camera or the clock, so panning and the 1s tick reuse this element tree
  // untouched: React skips reconciling it entirely.
  const mapScaffold = useMemo(() => <>
    <defs>
      <pattern id="world-micro-grid" width="8" height="8" patternUnits="userSpaceOnUse"><path d="M 8 0 L 0 0 0 8" fill="none" stroke="#17344a" strokeWidth={.25 / zoom} opacity=".34" /></pattern>
      <pattern id="world-grid" width="40" height="40" patternUnits="userSpaceOnUse"><path d="M 40 0 L 0 0 0 40" fill="none" stroke="#2e7892" strokeWidth={.48 / zoom} opacity=".52" /><circle cx="0" cy="0" r={.7 / zoom} fill="#41dffc" opacity=".5" /></pattern>
      <pattern id="world-stars" width="64" height="64" patternUnits="userSpaceOnUse"><circle cx="7" cy="13" r={.42 / zoom} fill="#c9f4ff" opacity=".72"/><circle cx="43" cy="8" r={.25 / zoom} fill="#a8c8ff" opacity=".55"/><circle cx="27" cy="47" r={.35 / zoom} fill="#e2d4ff" opacity=".64"/><circle cx="58" cy="36" r={.18 / zoom} fill="#fff" opacity=".8"/><circle cx="12" cy="59" r={.2 / zoom} fill="#73dfff" opacity=".48"/></pattern>
      <radialGradient id="world-ground" cx="58%" cy="42%"><stop offset="0" stopColor="#152044"/><stop offset=".34" stopColor="#0b1532"/><stop offset=".72" stopColor="#060c20"/><stop offset="1" stopColor="#02050e"/></radialGradient>
      <radialGradient id="world-nebula" cx="50%" cy="50%"><stop offset="0" stopColor="#7a49d8" stopOpacity=".16"/><stop offset=".48" stopColor="#215e9b" stopOpacity=".07"/><stop offset="1" stopColor="#030711" stopOpacity="0"/></radialGradient>
      <radialGradient id="circle-core"><stop offset="0" stopColor="#010208" stopOpacity="1"/><stop offset=".22" stopColor="#09051d" stopOpacity="1"/><stop offset=".48" stopColor="#a35cff" stopOpacity=".42"/><stop offset=".72" stopColor="#38d9ff" stopOpacity=".16"/><stop offset="1" stopColor="#1d123a" stopOpacity="0"/></radialGradient>
      <radialGradient id="world-planet-cash" cx="32%" cy="27%"><stop offset="0" stopColor="#a9c9b8"/><stop offset=".16" stopColor="#659d83"/><stop offset=".56" stopColor="#294d3e"/><stop offset="1" stopColor="#08120f"/></radialGradient>
      <radialGradient id="world-planet-oil" cx="32%" cy="27%"><stop offset="0" stopColor="#d1b58a"/><stop offset=".16" stopColor="#9a754b"/><stop offset=".56" stopColor="#513a25"/><stop offset="1" stopColor="#140e09"/></radialGradient>
      <radialGradient id="world-planet-power" cx="32%" cy="27%"><stop offset="0" stopColor="#b5ccd1"/><stop offset=".16" stopColor="#6895a1"/><stop offset=".56" stopColor="#2b5262"/><stop offset="1" stopColor="#08131a"/></radialGradient>
      <radialGradient id="world-planet-rogue" cx="32%" cy="27%"><stop offset="0" stopColor="#b9a3ac"/><stop offset=".16" stopColor="#805967"/><stop offset=".56" stopColor="#452632"/><stop offset="1" stopColor="#12080d"/></radialGradient>
      <radialGradient id="world-planet-cash-calm" cx="32%" cy="27%"><stop offset="0" stopColor="#a3bcb0"/><stop offset=".2" stopColor="#62847a"/><stop offset=".6" stopColor="#2c4640"/><stop offset="1" stopColor="#0a1210"/></radialGradient>
      <radialGradient id="world-planet-oil-calm" cx="32%" cy="27%"><stop offset="0" stopColor="#c8b595"/><stop offset=".2" stopColor="#8b7456"/><stop offset=".6" stopColor="#453828"/><stop offset="1" stopColor="#120e0a"/></radialGradient>
      <radialGradient id="world-planet-power-calm" cx="32%" cy="27%"><stop offset="0" stopColor="#b1c5cb"/><stop offset=".2" stopColor="#66848f"/><stop offset=".6" stopColor="#2f4550"/><stop offset="1" stopColor="#0a1217"/></radialGradient>
      <radialGradient id="world-planet-rogue-calm" cx="32%" cy="27%"><stop offset="0" stopColor="#bba3ab"/><stop offset=".2" stopColor="#826570"/><stop offset=".6" stopColor="#432f37"/><stop offset="1" stopColor="#110a0d"/></radialGradient>
      <radialGradient id="world-planet-dust" cx="31%" cy="25%"><stop offset="0" stopColor="#d7bb88"/><stop offset=".28" stopColor="#94724a"/><stop offset=".68" stopColor="#49331e"/><stop offset="1" stopColor="#171009"/></radialGradient>
      <radialGradient id="world-planet-blue" cx="30%" cy="24%"><stop offset="0" stopColor="#8eeaff"/><stop offset=".2" stopColor="#2a90bd"/><stop offset=".63" stopColor="#075071"/><stop offset="1" stopColor="#031326"/></radialGradient>
      <radialGradient id="world-planet-void" cx="36%" cy="30%"><stop offset="0" stopColor="#3a3f63"/><stop offset=".32" stopColor="#1a2038"/><stop offset=".7" stopColor="#0a0e1e"/><stop offset="1" stopColor="#02040b"/></radialGradient>
      <radialGradient id="world-planet-sovereign" cx="38%" cy="34%"><stop offset="0" stopColor="#fffdeb"/><stop offset=".18" stopColor="#ffe17a"/><stop offset=".52" stopColor="#f08a18"/><stop offset=".82" stopColor="#8b2605"/><stop offset="1" stopColor="#310700"/></radialGradient>
      <radialGradient id="world-planet-solar" cx="34%" cy="27%"><stop offset="0" stopColor="#fffbea"/><stop offset=".15" stopColor="#ffe09a"/><stop offset=".5" stopColor="#dc7b26"/><stop offset="1" stopColor="#291007"/></radialGradient>
      <linearGradient id="world-void-tail" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stopColor="#8a3cff" stopOpacity=".55"/><stop offset=".55" stopColor="#7a2cff" stopOpacity=".18"/><stop offset="1" stopColor="#7a2cff" stopOpacity="0"/></linearGradient>
      <filter id="signal-glow" x="-200%" y="-200%" width="400%" height="400%"><feGaussianBlur stdDeviation="1.6" result="blur"/><feMerge><feMergeNode in="blur"/><feMergeNode in="SourceGraphic"/></feMerge></filter>
    </defs>
    {/* Ground, nebula, stars, grids, sector rings and the reserve glow are drawn by
        WorldBackdropLayer from the live camera, so a long pan never exposes the shell. */}
    <g transform={`translate(${center.x} ${center.y}) scale(${importantScale}) translate(${-center.x} ${-center.y})`} className="world-core-marker" onPointerDown={(event) => event.stopPropagation()} onClick={() => setCamera(center)}><circle cx={center.x} cy={center.y} r="32" className="world-core-hit" /></g>
  </>, [zoom, world.config, center.x, center.y, worldRadius, importantScale, quality.bgAnimate]);

  // LAYER 2a — strategic clusters. Depends on the signal set + zoom, not the camera.
  // Level of detail (docs/MAP-2048.md, "no lag on low-end devices"): when one screen holds more
  // targets than the marker budget, the Field view shows local signal clusters instead of
  // hundreds of SVG planets; zooming in brings individual planets back.
  // Counted over the same band mapTargets renders (one screen plus the pan margin).
  const visibleTargetCount = useMemo(() => {
    if (strategicZoom) return 0;
    const cx = viewX + viewport.width / 2, cy = viewY + viewport.height / 2;
    const halfW = viewport.width * .82, halfH = viewport.height * .82;
    let count = 0;
    for (const entity of filteredTargets) {
      if (Math.abs(entity.position.x - cx) <= halfW && Math.abs(entity.position.y - cy) <= halfH) count += 1;
    }
    return count;
  }, [strategicZoom, filteredTargets, viewX, viewY, viewport.width, viewport.height]);
  // Shared world: the switch is a zoom level, identical in both directions (Field = signal
  // clusters, Tactical = planets) and the server is told which one to send. Local worlds keep
  // the marker budget.
  const denseField = !strategicZoom && (sharedMode ? zoom < WORLD_TACTICAL_ZOOM : visibleTargetCount > TARGET_MARKER_BUDGET);
  const fieldClusters = useMemo(() => {
    if (!denseField) return null;
    if (sharedMode && serverFieldClusters) return serverFieldClusters.filter((cluster) => layers[cluster.kind]);
    // Power-of-two cells so clusters do not re-shuffle on every zoom tick.
    const cell = 2 ** Math.round(Math.log2(Math.max(16, viewport.width / 8)));
    const pad = viewport.width * .6;
    return clusterWorldSignals(filteredTargets.filter((entity) => entity.position.x >= viewX - pad && entity.position.x <= viewX + viewport.width + pad
      && entity.position.y >= viewY - pad && entity.position.y <= viewY + viewport.height + pad), cell);
  }, [denseField, sharedMode, serverFieldClusters, layers, filteredTargets, viewX, viewY, viewport.width, viewport.height]);
  const mapClusters = useMemo(() => (strategicZoom || fieldClusters) ? (fieldClusters ?? signalClusters).map((cluster) => <g key={cluster.id} transform={`translate(${cluster.position.x} ${cluster.position.y}) scale(${markerScale * 1.1 * Math.max(1, 1 / zoom)}) translate(${-cluster.position.x} ${-cluster.position.y})`} className={`world-cluster ${cluster.kind}`} onPointerDown={(event) => event.stopPropagation()} onClick={() => { setRemoteSelectedId(null); setCamera(cluster.position); setZoom((value) => Math.max(1.8, Math.min(WORLD_MAX_ZOOM, value * 1.8))); }}>
    <circle cx={cluster.position.x} cy={cluster.position.y} r="6.5" /><circle cx={cluster.position.x} cy={cluster.position.y} r="3.7" /><text x={cluster.position.x} y={cluster.position.y + 1.3}>{cluster.count}</text>
  </g>) : null, [strategicZoom, fieldClusters, signalClusters, markerScale, zoom]);

  // LAYER 2b — planet / rogue / rival-city markers. Rebuilt only when the entities
  // themselves change (spawn / deplete / occupation), when zoom changes the marker
  // scale/detail, when the selection or bookmarks change, or when the coarse cull
  // cell changes — NOT on every drag frame and NOT on the 1s clock tick.
  const mapTargets = useMemo(() => {
    if (strategicZoom || denseField) return null;
    const cx = cullQX * cullCell, cy = cullQY * cullCell;
    // One visible screen plus a measured gesture margin. The old 3x band put
    // 200–300 richly styled SVG nodesets in Safari's viewBox repaint path even
    // though most were two screens away; that was the main Tactical pan stall.
    const minX = cx - viewport.width * .82, maxX = cx + viewport.width * .82;
    const minY = cy - viewport.height * .82, maxY = cy + viewport.height * .82;
    return filteredTargets.filter((entity) => entity.position.x >= minX && entity.position.x <= maxX && entity.position.y >= minY && entity.position.y <= maxY)
      .sort((a, b) => (a.id === selectedId ? 1 : 0) - (b.id === selectedId ? 1 : 0))
      .map((entity) => {
        const color = entityColor(entity); const unavailable = (entity.kind === "resource" && entity.state !== "available") || (entity.kind === "monster" && entity.state !== "alive"); const selectedTarget = selectedId === entity.id; const verified = entity.kind === "resource" || scoutedTargetIds.has(entity.id);
        const occupation = entity.kind === "resource" ? resourceOccupationDisposition(entity, occupationMarches, world.players, session.playerId, profile.faction) : "neutral";
        const publicCosmetics = entity.kind === "city" ? world.players[entity.ownerId]?.cosmetics || ISSUED_WORLD_COSMETICS : null;
        const targetScale = CALM_MAP && entity.kind !== "city" ? calmTargetScale : markerScale;
        const outOfReach = entity.kind === "monster" && entity.level > nextRogueLevel;
        return <g key={entity.id} transform={`translate(${entity.position.x} ${entity.position.y}) scale(${targetScale}) translate(${-entity.position.x} ${-entity.position.y})`} className={`world-target ${entity.kind} state-${entity.state} ${outOfReach ? "out-of-reach" : ""} occupation-${occupation} ${selectedTarget ? "selected" : ""} ${verified ? "verified" : "public"} ${bookmarks.includes(entity.id) ? "bookmarked" : ""} ${unavailable ? "depleted" : ""}`} onPointerDown={(event) => event.stopPropagation()} onClick={() => { setSelectedId(entity.id); setHomeSelected(false); setRemoteSelectedId(null); setSelection(emptySelection()); setMessage(""); setTileMark(null); playSelectSfx(); }}>
          {selectedTarget && entity.kind === "city" && gpuFallback && <><circle cx={entity.position.x} cy={entity.position.y} r="9" className="world-lock-ring" /><path d={`M ${entity.position.x - 12} ${entity.position.y} h 6 M ${entity.position.x + 6} ${entity.position.y} h 6 M ${entity.position.x} ${entity.position.y - 12} v 6 M ${entity.position.x} ${entity.position.y + 6} v 6`} className="world-lock-cross" /></>}
          {(gpuFallback || entity.kind !== "city") && <circle cx={entity.position.x} cy={entity.position.y} r={entity.kind === "city" ? 4.5 : 3.6} fill={color} className="world-signal-halo" />}
          {entity.kind === "city" && publicCosmetics ? <>
            {!gpuFallback ? <circle cx={entity.position.x} cy={entity.position.y} r="14" className="world-city-hit" /> : <>
              {publicCosmetics.halo && <WorldHaloFx cx={entity.position.x} cy={entity.position.y} r={9} halo={publicCosmetics.halo} half="back" />}
              {publicCosmetics.orbit && <WorldOrbitFx cx={entity.position.x} cy={entity.position.y} r={9} orbit={publicCosmetics.orbit} half="back" />}
              <WorldPlanetFx cx={entity.position.x} cy={entity.position.y} r={9} skin={publicCosmetics.planetBody} />
              {publicCosmetics.orbit && <WorldOrbitFx cx={entity.position.x} cy={entity.position.y} r={9} orbit={publicCosmetics.orbit} half="front" />}
              {publicCosmetics.halo && <WorldHaloFx cx={entity.position.x} cy={entity.position.y} r={9} halo={publicCosmetics.halo} half="front" />}
            </>}
          </> : <g className="world-target-body" style={{ transformOrigin: `${entity.position.x}px ${entity.position.y}px` }}><WorldEntityGlyph entity={entity} detailZoom={detailZoom} occupation={occupation} /></g>}
          {gpuFallback && entity.kind === "city" && detailZoom && (selectedId === entity.id
            ? <CityIdentityTag x={entity.position.x} y={entity.position.y} level={entity.townhallLevel} name={localWorldTargetName(world, entity.id)} signal={publicCosmetics?.chatSignal} relation={cityRelation(entity.ownerId)} />
            : <WorldLevelBadge x={entity.position.x} y={entity.position.y} level={entity.townhallLevel} />)}
          {verified && entity.kind !== "resource" && <circle cx={entity.position.x + 4.5} cy={entity.position.y - 4.5} r="1.2" className="world-verified-dot" />}
          {bookmarks.includes(entity.id) && <text x={entity.position.x + 7} y={entity.position.y - 6} className="world-bookmark-star">★</text>}
        </g>;
      });
  }, [denseField, filteredTargets, strategicZoom, detailZoom, markerScale, calmTargetScale, nextRogueLevel, selectedId, bookmarks, scoutedTargetIds, world.marches, world.players, world.entities, session.playerId, profile.faction, viewport.width, viewport.height, cullQX, cullQY, cullCell, gpuVisualsState]);

  // Other real commanders overlaid on the shared map (read-only). Culled to the
  // viewport and only shown once you're zoomed past strategic, same as targets.
  // Ask the server for the rival cities in view (with a margin so small pans reuse it).
  // Rival cities only render past Strategic zoom, so no request is made there.
  const lastViewRef = useRef<ViewRect | null>(null);
  useEffect(() => {
    if (!sharedMode || !strategicZoom) return;
    const ask = () => rtRef.current?.sendView({ x0: 0, y0: 0, x1: 0, y1: 0 }, true);
    ask();
    const timer = window.setInterval(ask, 30_000);
    return () => window.clearInterval(timer);
  }, [sharedMode, strategicZoom, rtEpoch]);
  const lastViewDetailRef = useRef<boolean | null>(null);
  // Fetch planets one zoom step before Tactical, so zooming in finds them already here
  // (Field then clusters them locally until the Tactical threshold).
  const wantPlanets = !denseField || zoom >= WORLD_TACTICAL_ZOOM * .75;
  useEffect(() => {
    lastViewRef.current = null; lastViewDetailRef.current = null;
  }, [rtEpoch]);
  useEffect(() => {
    if (strategicZoom) return;
    const pad = 30, spare = 40;
    const want = { x0: viewX - pad, y0: viewY - pad, x1: viewX + viewport.width + pad, y1: viewY + viewport.height + pad };
    const last = lastViewRef.current;
    // Reuse the last answer only while it still fits the view at a similar scale: after a
    // zoom-in the last answer may have been clusters, and planets are needed now.
    const area = (rect: ViewRect) => (rect.x1 - rect.x0) * (rect.y1 - rect.y0);
    const detail = wantPlanets; // planets (Tactical, or one zoom step before it) or signal clusters (Field)
    if (last && lastViewDetailRef.current === detail && want.x0 >= last.x0 && want.y0 >= last.y0 && want.x1 <= last.x1 && want.y1 <= last.y1 && area(want) > area(last) * .35) return;
    // First view and a Field <-> Tactical switch go out at once; pans are lightly debounced.
    const urgent = !last || lastViewDetailRef.current !== detail;
    const timer = window.setTimeout(() => {
      // The server serves at most VIEW_MAX_SPAN tiles per axis; spend what is left on the margin.
      const sx = Math.max(0, Math.min(spare, (VIEW_MAX_SPAN - (want.x1 - want.x0)) / 2));
      const sy = Math.max(0, Math.min(spare, (VIEW_MAX_SPAN - (want.y1 - want.y0)) / 2));
      const rect = { x0: Math.floor(want.x0 - sx), y0: Math.floor(want.y0 - sy), x1: Math.ceil(want.x1 + sx), y1: Math.ceil(want.y1 + sy) };
      lastViewRef.current = rect; lastViewDetailRef.current = detail;
      rtRef.current?.sendView(rect, false, detail);
    }, urgent ? 0 : 120);
    return () => window.clearTimeout(timer);
  }, [strategicZoom, wantPlanets, viewX, viewY, viewport.width, viewport.height, rtEpoch]);
  const mapRemotePlayers = useMemo(() => {
    if (strategicZoom) return null;
    const pad = 30;
    const minX = viewX - pad, maxX = viewX + viewport.width + pad, minY = viewY - pad, maxY = viewY + viewport.height + pad;
    const bodyR = detailZoom ? 7.2 : 4.2;
    // Offline cities stay on the map (SLG convention); no online indicator is shown.
    return remotePlayers.filter((p) => p.coords.x >= minX && p.coords.x <= maxX && p.coords.y >= minY && p.coords.y <= maxY)
      .map((p) => {
        const sel = remoteSelectedId === p.id;
        const col = REMOTE_FACTION_COLOR[String(p.faction || "")] || "#7cc0ff";
        const cos = (p.cosmetics || {}) as { chatSignal?: ChatSignalId | null; planetBody?: string; halo?: string; orbit?: string };
        // Render the player's actual equipped planet look (skin/halo/orbit) from
        // their presence cosmetics, falling back to defaults for anything absent.
        const cx = p.coords.x, cy = p.coords.y;
        const skin = (PLANET_SKINS.some((s) => s.id === cos.planetBody) ? cos.planetBody : "dust-homestead") as PlanetSkinId;
        const halo = (PLANET_HALOS.some((h) => h.id === cos.halo) ? cos.halo : null) as PlanetHaloId | null;
        const orbit = (PLANET_ORBITS.some((o) => o.id === cos.orbit) ? cos.orbit : null) as PlanetOrbitId | null;
        // With the GPU layer the planet is drawn there (like your own); SVG keeps the hit area
        // and the plate, placed a fixed gap below the body that is actually drawn.
        const gpuBodyPx = worldVisualBodyRadius(zoom, false, sel, CALM_MAP);
        const toLocal = worldPerPx / Math.max(.0001, markerScale);
        const hitR = gpuFallback ? bodyR + 3 : (gpuBodyPx + 5) * toLocal;
        const tagY = gpuFallback ? cy : cy + (gpuBodyPx + 4) * toLocal - 6.1;
        return <g key={`rp-${p.id}`} transform={`translate(${cx} ${cy}) scale(${markerScale}) translate(${-cx} ${-cy})`} className={`world-remote-player ${sel ? "selected" : ""}`} onPointerDown={(event) => event.stopPropagation()} onClick={() => { setRemoteSelectedId(p.id); setSelectedId(null); setHomeSelected(false); setSelection(emptySelection()); setMessage(""); setTileMark(null); playSelectSfx(); }}>
          {/* Planet skin and name plate ignore the pointer, so the city needs its own hit area. */}
          <circle cx={cx} cy={cy} r={hitR} className="world-remote-hit" />
          {gpuFallback && <>
            {halo && <WorldHaloFx cx={cx} cy={cy} r={bodyR} halo={halo} half="back" />}
            {orbit && <WorldOrbitFx cx={cx} cy={cy} r={bodyR} orbit={orbit} half="back" />}
            <WorldPlanetFx cx={cx} cy={cy} r={bodyR} skin={skin} />
            {orbit && <WorldOrbitFx cx={cx} cy={cy} r={bodyR} orbit={orbit} half="front" />}
            {halo && <WorldHaloFx cx={cx} cy={cy} r={bodyR} halo={halo} half="front" />}
          </>}
          <CityIdentityTag x={cx} y={tagY} level={p.keepLevel || 1} name={`${p.faction ? `[${p.faction}] ` : ""}${p.name || "Commander"}`} signal={cos.chatSignal ?? "clear-channel"} relation="neutral" />
        </g>;
      });
  }, [strategicZoom, remotePlayers, remoteSelectedId, viewX, viewY, viewport.width, viewport.height, markerScale, detailZoom, gpuFallback, zoom, worldPerPx]);
  const remoteSelected = useMemo(() => remotePlayers.find((p) => p.id === remoteSelectedId) || null, [remotePlayers, remoteSelectedId]);

  function commit(result: ReturnType<typeof advanceLocalWorldSession>) {
    sessionRef.current = result.session; setSession(result.session); setGame(result.game); gameRef.current = result.game; saveLocalWorldSession(result.session); saveGame(result.game);
  }
  function commitServer(result: GameCommandResponse) {
    if (!result.world || !result.game) return;
    if (result.authorityVersion && result.authorityVersion !== authorityRef.current) {
      authorityRef.current = result.authorityVersion; setAuthorityVersion(result.authorityVersion);
    }
    const nextSession = result.world as LocalWorldSession;
    const nextGame = result.game as GameState;
    const ids = nextSession.world.players[nextSession.playerId]?.reportIds || [];
    if (ids.length > seenReportCount.current) {
      const report = nextSession.world.reports[ids[ids.length - 1]];
      if (report) setResultNotice(reportCopy(report, nextSession.world, Date.now()));
    }
    seenReportCount.current = ids.length;
    sessionRef.current = nextSession; gameRef.current = nextGame;
    setSession(nextSession); setGame(nextGame);
    saveLocalWorldSession(nextSession); saveGame(nextGame);
  }
  async function sendWorldCommandWithRetry(type: string, args: Record<string, unknown>, idempotencyKey: string): Promise<GameCommandResponse> {
    try { return await sendGameCommand(address, type, args, idempotencyKey); }
    catch { return sendGameCommand(address, type, args, idempotencyKey); }
  }
  function revealLatestReport(next: LocalWorldSession) {
    const ids = next.world.players[next.playerId].reportIds;
    seenReportCount.current = ids.length;
    const report = next.world.reports[ids[ids.length - 1]];
    if (report) setResultNotice(reportCopy(report, next.world, Date.now()));
  }
  function setTroop(arm: TroopKey, tier: string, qty: number) {
    const available = viewGame.troops[arm]?.[tier] ?? 0;
    setSelection((current) => {
      const currentRow = current[arm][tier] ?? 0;
      const currentTotal = TROOP_ORDER.reduce((sum, key) => sum + Object.values(current[key]).reduce((subtotal, amount) => subtotal + (amount || 0), 0), 0);
      const rowLimit = Math.max(0, forceLimit - (currentTotal - currentRow));
      return { ...current, [arm]: { ...current[arm], [tier]: Math.max(0, Math.min(available, rowLimit, Math.floor(qty) || 0)) } };
    });
  }
  function maxTroop(arm: TroopKey, tier: string, available: number) {
    setTroop(arm, tier, available);
  }
  function autoAssignGatherForce() {
    if (!selected || selected.kind !== "resource") return;
    setSelection(recommendedGatherForce(viewGame.troops, selected.amount, forceLimit, N, player.accountModifiers));
  }
  async function run(action: "scout" | "gather" | "attack_monster" | "attack_city") {
    if (!selected) return;
    // Scouting occupies a march slot but does not quietly reserve whatever force
    // the player happened to have selected for a later attack.
    const force = action === "scout" ? emptySelection() : selection;
    const dispatchKey = `ui:${Date.now()}:${dispatchSeq.current++}`;
    if (authorityVersion > 0) {
      setMessage("Fleet order uplinking…");
      try {
        const result = await sendWorldCommandWithRetry("world.dispatch", { targetId: selected.id, action, force, dispatchKey }, `world-dispatch:${crypto.randomUUID()}`);
        if (!result.ok) { setMessage(ERROR_COPY[result.reason || "dispatch_failed"] || (result.reason || "Order rejected.")); return; }
        commitServer(result); setSelection(emptySelection());
        setMessage(`${action === "scout" ? "Survey probe" : action === "gather" ? "Harvest fleet" : "Strike fleet"} launched toward ${localWorldTargetName((result.world as LocalWorldSession).world, selected.id)}.`);
      } catch { setMessage("Fleet order lost. Try again."); }
      return;
    }
    const result = dispatchLocalWorldMarch(session, viewGame, { targetId: selected.id, action, force, idempotencyKey: dispatchKey }, Date.now(), N);
    if (result.error) { setMessage(ERROR_COPY[result.error] || result.error.split("_").join(" ")); return; }
    commit(result); setSelection(emptySelection());
    setMessage(`${action === "scout" ? "Survey probe" : action === "gather" ? "Harvest fleet" : "Strike fleet"} launched toward ${localWorldTargetName(result.session.world, selected.id)}.`);
  }
  function finishMarches() {
    if (authorityVersion > 0) { setMessage("GM: server-timed marches cannot be force-finished in the live lane."); return; }
    const result = finishLocalWorldMarches(session, viewGame, Date.now(), N); commit(result);
    revealLatestReport(result.session);
    setMessage("GM: all active marches completed through the headless engine.");
  }
  function fillTroops() {
    if (authorityVersion > 0) { setMessage("GM: use the City server tools to change live troops."); return; }
    const result = advanceLocalWorldSession(session, gmFillTroops(viewGame), Date.now(), N); commit(result);
    setMessage("GM: standing troops filled to current training-building capacity.");
  }
  // Sound cue when the player selects a target on the star map. Read the account
  // fresh so a Profile change (sound toggle / SFX volume) applies immediately.
  function playSelectSfx() {
    const acc = loadPlayerAccount(address);
    if (acc.soundEnabled) playSfx(SFX_STARMAP_SELECT, SFX_STARMAP_SELECT_VOLUME * acc.sfxVolume);
  }
  function focusTarget(targetId: string) {
    const target = targets.find((entity) => entity.id === targetId);
    if (!target) { setMessage("That signal has left the current sector."); return; }
    setSelectedId(target.id); setCamera({ ...target.position }); setZoom((value) => Math.max(value, target.kind === "city" ? 3.2 : 2.1)); setMessage("");
    playSelectSfx();
  }
  function shareSelected() {
    if (!selected) return;
    const target = {
      id: selected.id,
      name: localWorldTargetName(world, selected.id),
      level: entityLevel(selected),
      kind: selected.kind,
      position: selected.position,
    };
    if (selected.kind === "city" && selectedScoutReport && isScoutReportActive(selectedScoutReport, now, scoutIntelTtlMs)) {
      queueCommsShare(address, createScoutIntelShare(target, selectedScoutReport, scoutIntelTtlMs));
    } else {
      queueCommsShare(address, createCoordinateShare(target, now));
    }
    onMessages();
  }
  async function findNextRogue() {
    if (frontierComplete) { setCamera(center); setMessage("Frontier I complete. Hold the Wormhole to enter the next map when it opens."); return; }
    if (authorityVersion > 0) {
      try {
        const result = await sendWorldCommandWithRetry("world.scan", { requestedLevel: nextRogueLevel }, `world-scan:${crypto.randomUUID()}`);
        const returnedSession = result.world as LocalWorldSession | null;
        const targetId = result.targetId || returnedSession?.world.players[returnedSession.playerId]?.deepScanTargetIds[String(nextRogueLevel)];
        if (!result.ok || !targetId) { setMessage(ERROR_COPY[result.reason || "rogue_unavailable"] || "No Rogue signal found."); return; }
        commitServer(result);
        const next = returnedSession!;
        const target = next.world.entities[targetId];
        if (!target || target.kind !== "monster") return;
        setSelectedId(target.id); setSelection(emptySelection()); setCamera({ ...target.position });
        setZoom((value) => Math.max(value, 2.1)); setTileMark(null); playSelectSfx();
        setMessage(result.spawned ? `Deep Scan discovered an uncharted L${target.level} Rogue signal.` : `Tracking the nearest L${target.level} Rogue signal.`);
      } catch { setMessage("Deep Scan link failed. Try again."); }
      return;
    }
    const result = scanLocalWorldRogue(session, viewGame, nextRogueLevel, Date.now(), N);
    if (result.error || !result.targetId) { setMessage(ERROR_COPY[result.error || "rogue_unavailable"] || "No Rogue signal found."); return; }
    commit(result);
    const target = result.session.world.entities[result.targetId];
    if (!target || target.kind !== "monster") return;
    setSelectedId(target.id); setSelection(emptySelection()); setCamera({ ...target.position });
    setZoom((value) => Math.max(value, 2.1)); setTileMark(null); playSelectSfx();
    setMessage(result.spawned
      ? `Deep Scan discovered an uncharted L${target.level} Rogue signal.`
      : `Tracking the nearest L${target.level} Rogue signal.`);
  }
  const levelKind: SearchKind = searchKind === "coord" ? "monster" : searchKind;
  const searchLevel = levelKind === "monster" ? Math.min(rogueMaxLevel, searchLevels.monster || nextRogueLevel) : Math.min(resourceMaxLevel, searchLevels[levelKind]);
  const searchMaxLevel = levelKind === "monster" ? rogueMaxLevel : resourceMaxLevel;
  const searchKey = `${searchKind}:${searchLevel}`;
  function setSearchLevel(level: number) {
    setSearchLevels((current) => ({ ...current, [levelKind]: Math.max(1, Math.min(searchMaxLevel, level)) }));
    setSearchResult(null);
  }
  function runSearch() {
    if (searchKind === "coord") { viewCoordinates(); return; }
    const label = SEARCH_KINDS.find((kind) => kind.id === searchKind)!.label;
    if (sharedMode && rtRef.current) {
      const index = searchResult?.key === searchKey ? searchResult.index + 1 : 0;
      const kind = searchKind, level = searchLevel, key = searchKey;
      searchReplyRef.current = (result) => {
        searchReplyRef.current = null;
        const target = result.target as WorldEntity | null;
        if (!target || !result.total) {
          if (kind === "monster" && level === nextRogueLevel) { setSearchResult(null); void findNextRogue(); return; }
          setSearchResult(null); setMessage(`No free L${level} ${label} signal found. Try another level.`); return;
        }
        setViewTargets((cur) => ({ ...cur, [target.id]: target }));
        setSearchResult({ key, index: index % result.total, total: result.total, targetId: target.id });
        setSelectedId(target.id); setHomeSelected(false); setRemoteSelectedId(null); setSelection(emptySelection()); setTileMark(null);
        setCamera({ ...target.position }); setZoom((value) => Math.max(value, 3.2)); setMessage(""); playSelectSfx();
      };
      rtRef.current.sendSearch(kind, level, index);
      return;
    }
    const candidates = targets.filter((entity) => searchKind === "monster"
      ? entity.kind === "monster" && entity.state === "alive" && entity.level === searchLevel
      : entity.kind === "resource" && entity.resource === searchKind && entity.state === "available" && entity.level === searchLevel
        && resourceOccupationDisposition(entity, occupationMarches, world.players, session.playerId, profile.faction) === "neutral")
      .sort((left, right) => distance(playerCity.position, left.position) - distance(playerCity.position, right.position));
    if (!candidates.length) {
      // Nothing charted at the next Rogue tier: fall back to the server Deep Scan.
      if (searchKind === "monster" && searchLevel === nextRogueLevel) { setSearchResult(null); void findNextRogue(); return; }
      setSearchResult(null); setMessage(`No free L${searchLevel} ${label} signal found. Try another level.`); return;
    }
    const index = searchResult?.key === searchKey ? (searchResult.index + 1) % candidates.length : 0;
    const target = candidates[index];
    setSearchResult({ key: searchKey, index, total: candidates.length, targetId: target.id });
    setSelectedId(target.id); setHomeSelected(false); setRemoteSelectedId(null); setSelection(emptySelection()); setTileMark(null);
    setCamera({ ...target.position }); setZoom((value) => Math.max(value, 3.2)); setMessage(""); playSelectSfx();
  }
  useEffect(() => {
    if (!searchOpen) return;
    const close = (event: KeyboardEvent) => { if (event.key === "Escape") setSearchOpen(false); };
    window.addEventListener("keydown", close);
    return () => window.removeEventListener("keydown", close);
  }, [searchOpen]);
  // ---- Warp (city relocation) ----
  const warpDestination = tileMark ? { x: tileMark.x + .5, y: tileMark.y + .5 } : null;
  const inboundAttack = marches.some((march) => march.defender === address && march.kind !== "scout" && march.arriveAt > now);
  const warpNotReady = inboundAttack ? "under_attack" : warpReadiness(world, session.playerId);
  const warpDestinationBlock = warpDestination ? warpBlockReason(world, session.playerId, warpDestination, N) : null;
  function refreshWarpCounts() {
    if (authorityVersion <= 0) { setWarpCounts(null); return; }
    loadInventory(address).then((rows) => setWarpCounts({
      precision: rows.find((row) => row.itemId === "war.relocator.advanced")?.quantity ?? 0,
      drift: rows.find((row) => row.itemId === "war.relocator.random")?.quantity ?? 0,
    })).catch(() => setWarpCounts(null));
  }
  function openWarp() {
    setSearchOpen(false); setWarpOpen(true); refreshWarpCounts();
  }
  // Typed destination (the other way to choose besides clicking a tile).
  const [warpDraft, setWarpDraft] = useState({ x: "", y: "" });
  useEffect(() => {
    if (warpOpen && tileMark) setWarpDraft({ x: String(tileMark.x), y: String(tileMark.y) });
  }, [warpOpen, tileMark]);
  function setWarpDestinationFromDraft() {
    const x = Number(warpDraft.x), y = Number(warpDraft.y);
    if (warpDraft.x.trim() === "" || warpDraft.y.trim() === "" || !Number.isFinite(x) || !Number.isFinite(y)) { setMessage("Enter a valid X and Y coordinate."); return; }
    const tile = { x: Math.floor(x), y: Math.floor(y) };
    setTileMark(tile); setSelectedId(null); setRemoteSelectedId(null); setCamera({ x: tile.x + .5, y: tile.y + .5 });
  }
  const warpHint = useMemo(() => (warpOpen && warpDestination && warpDestinationBlock && WARP_LOCATION_BLOCKS.has(warpDestinationBlock)
    ? nearestWarpPoint(world, session.playerId, warpDestination, N) : null),
  // eslint-disable-next-line react-hooks/exhaustive-deps
  [warpOpen, warpDestination?.x, warpDestination?.y, warpDestinationBlock, world]);
  function selectWarpHint() {
    if (!warpHint) return;
    const tile = { x: Math.floor(warpHint.x), y: Math.floor(warpHint.y) };
    setTileMark(tile); setCamera({ x: warpHint.x, y: warpHint.y }); playSelectSfx();
  }
  async function executeWarp(mode: "precision" | "random") {
    if (warpBusy) return;
    if (mode === "precision" && !warpDestination) { setMessage("Click an empty tile to choose the destination."); return; }
    setWarpBusy(true);
    try {
      let position: Point | undefined;
      if (authorityVersion > 0) {
        const result = await sendWorldCommandWithRetry("world.warp", mode === "random" ? { mode } : { mode, x: warpDestination!.x, y: warpDestination!.y }, `world-warp:${crypto.randomUUID()}`);
        if (!result.ok) { setMessage(ERROR_COPY[result.reason || ""] || "Warp failed."); return; }
        commitServer(result);
        position = result.position;
      } else {
        // Local session: same engine rule, no item — dev/GM only. Production players
        // must warp through the server (item + shared-coordinate reservation).
        if (!import.meta.env.DEV && !gm) { setMessage("Warp needs a server connection. Try again in a moment."); return; }
        const warped = relocateCity(session.world, session.playerId, mode === "random" ? { mode } : { mode, target: warpDestination! }, Date.now(), N);
        if (warped.error) { setMessage(ERROR_COPY[warped.error] || "Warp failed."); return; }
        const next: LocalWorldSession = { ...session, world: warped.world };
        sessionRef.current = next; setSession(next); saveLocalWorldSession(next);
        position = warped.position;
      }
      if (position) {
        setCamera({ ...position });
        setMessage(`Warp complete · new home ${Math.round(position.x).toString().padStart(3, "0")}:${Math.round(position.y).toString().padStart(3, "0")}.`);
      }
      setTileMark(null); setWarpOpen(false); setSelectedId(null); setHomeSelected(true); playSelectSfx();
      refreshWarpCounts();
    } catch { setMessage("Warp link failed. Try again."); }
    finally { setWarpBusy(false); }
  }
  useEffect(() => {
    if (!warpOpen) return;
    const close = (event: KeyboardEvent) => { if (event.key === "Escape") setWarpOpen(false); };
    window.addEventListener("keydown", close);
    return () => window.removeEventListener("keydown", close);
  }, [warpOpen]);
  function toggleLayer(layer: WorldLayer) {
    setLayers((current) => ({ ...current, [layer]: !current[layer] }));
    if (selected?.kind === layer) setSelectedId(null);
  }
  function toggleBookmark(targetId: string) {
    setBookmarks((current) => current.includes(targetId) ? current.filter((id) => id !== targetId) : [...current, targetId]);
  }
  function viewCoordinates() {
    const x = Number(coordinateDraft.x); const y = Number(coordinateDraft.y);
    if (coordinateDraft.x.trim() === "" || coordinateDraft.y.trim() === "" || !Number.isFinite(x) || !Number.isFinite(y)) { setMessage("Enter a valid X and Y coordinate."); return; }
    const tile = { x: Math.floor(x), y: Math.floor(y) };
    const point = { x: tile.x + .5, y: tile.y + .5 };
    if (!isInsidePlayableWorld(point, world.config, 0)) { setMessage("Those coordinates are outside the circular Frontier."); return; }
    setCamera(point); setTileMark(tile); setSelectedId(null); setHomeSelected(false); setRemoteSelectedId(null);
    setZoom((value) => Math.max(value, 2.1)); setMessage(""); playSelectSfx();
  }
  async function recall(marchId: string) {
    // gameRef is updated synchronously by commit; the projected render value can
    // lag one frame behind a dispatch during fast GM/browser interactions.
    if (authorityVersion > 0) {
      try {
        const result = await sendWorldCommandWithRetry("world.recall", { marchId }, `world-recall:${crypto.randomUUID()}`);
        if (!result.ok) { setMessage("That fleet can no longer be recalled."); return; }
        commitServer(result); setMessage("Fleet recalled. It is returning along its traveled route.");
      } catch { setMessage("Recall link failed. Try again."); }
      return;
    }
    const result = recallLocalWorldMarch(session, gameRef.current, marchId, Date.now(), N);
    if (result.error) { setMessage("That fleet can no longer be recalled."); return; }
    commit(result); setMessage("Fleet recalled. It is returning along its traveled route.");
  }
  function pointerDown(event: React.PointerEvent<SVGSVGElement>) { drag.current = { x: event.clientX, y: event.clientY, camera, moved: false }; event.currentTarget.setPointerCapture(event.pointerId); }
  function pointerMove(event: React.PointerEvent<SVGSVGElement>) {
    if (!drag.current) return;
    if (!drag.current.moved && Math.hypot(event.clientX - drag.current.x, event.clientY - drag.current.y) > 3) drag.current.moved = true;
    if (!drag.current.moved) return;
    // World units per screen px under the SVG's xMidYMid "meet" fit — the SAME
    // mapping every layer draws with. Using only the width drifted the camera
    // ~16% short on wide map frames, so markers snapped back on release.
    const el = event.currentTarget;
    const scale = Math.max(viewport.width / Math.max(1, el.clientWidth), viewport.height / Math.max(1, el.clientHeight));
    const nextCamera = {
      x: Math.max(0, Math.min(world.config.width, drag.current.camera.x - (event.clientX - drag.current.x) * scale)),
      y: Math.max(0, Math.min(world.config.height, drag.current.camera.y - (event.clientY - drag.current.y) * scale)),
    };
    pendingCamera.current = nextCamera;
    const nextViewport = {
      x: nextCamera.x - viewport.width / 2,
      y: nextCamera.y - viewport.height / 2,
      width: viewport.width,
      height: viewport.height,
    };
    liveViewportRef.current = nextViewport;
    markWorldMotion();
    // Composite an already-rasterized, overscanned SVG during the gesture.
    // Updating viewBox here forces Safari to repaint thousands of SVG nodes and
    // is the direct source of the black flash. WebGL/Canvas still use the live
    // camera above, so planets, fleets and strikes stay locked to the grid.
    const panX = event.clientX - drag.current.x;
    const panY = event.clientY - drag.current.y;
    // The SVG plane only holds markers for its overscan margin. Before a long
    // gesture runs past it, commit the camera once and continue from here — one
    // marker-only re-raster instead of an empty edge.
    const marginX = el.clientWidth * (WORLD_PAN_OVERSCAN - 1) / 2, marginY = el.clientHeight * (WORLD_PAN_OVERSCAN - 1) / 2;
    if (Math.abs(panX) > marginX * .7 || Math.abs(panY) > marginY * .7) {
      drag.current = { x: event.clientX, y: event.clientY, camera: nextCamera, moved: true };
      pendingCamera.current = null;
      flushSync(() => setCamera(nextCamera));
      return;
    }
    const liveTransform = `translate3d(${panX}px,${panY}px,0) scale(${WORLD_PAN_OVERSCAN})`;
    if (svgRef.current) svgRef.current.style.transform = liveTransform;
    if (overlayRef.current) overlayRef.current.style.transform = liveTransform;
  }
  function pointerUp(event: React.PointerEvent<SVGSVGElement>) {
    const state = drag.current; drag.current = null;
    const committedCamera = pendingCamera.current;
    pendingCamera.current = null;
    if (state?.moved && committedCamera) setCamera(committedCamera);
    // A press with no drag on empty space = inspect that tile's coordinate (Kingshot-style).
    if (!state || state.moved) return;
    const svg = event.currentTarget; const ctm = svg.getScreenCTM(); if (!ctm) return;
    const pt = svg.createSVGPoint(); pt.x = event.clientX; pt.y = event.clientY;
    const local = pt.matrixTransform(ctm.inverse());
    const tx = Math.max(0, Math.min(world.config.width - 1, Math.floor(local.x)));
    const ty = Math.max(0, Math.min(world.config.height - 1, Math.floor(local.y)));
    setTileMark({ x: tx, y: ty }); setSelectedId(null); setRemoteSelectedId(null);
  }
  function pointerCancel() {
    const committedCamera = pendingCamera.current;
    drag.current = null;
    pendingCamera.current = null;
    if (committedCamera) setCamera(committedCamera);
  }

  return <section className={`world world-crypto world-cosmos${CALM_MAP ? " world-calm" : ""}${zoom >= 5.5 ? " world-deep" : ""}${detailZoom ? " world-tactical" : ""}`} style={CALM_MAP ? { ["--badge-boost" as string]: "1.5" } as CSSProperties : undefined}>
    <CosmicBackdrop address={address} />
    <div className="world-page-black-hole" aria-hidden="true"><i className="world-page-hole-glow" /><i className="world-page-accretion" /><i className="world-page-hole-core" /></div>
    <GameNav view="world" profile={profile} townhallLevel={viewGame.buildings.keep.lvl}
      location={`SECTOR ${world.stateId.slice(-6).toUpperCase()} · HOME ${Math.round(playerCity.position.x).toString().padStart(3, "0")}:${Math.round(playerCity.position.y).toString().padStart(3, "0")}`}
      resources={viewGame.res}
      incomePerHour={prodPerHour(viewGame)} resourceCap={capacity(viewGame)}
      stamina={energy} staminaCap={world.config.energyCap}
      troops={totalTroops(viewGame)} wounded={viewGame.wounded} might={mightBreakdown(viewGame).total}
      onAlliance={onAlliance} onCity={onBack} onWorld={() => {}} onMessages={onMessages} onShop={onShop} onProfile={onProfile} />
    {gm && <div className="world-gm-strip"><span>LOCAL GM</span><button onClick={fillTroops}>FILL TROOPS</button><button onClick={finishMarches} disabled={!activeMarches.length}>RESOLVE FLEETS</button><button onClick={() => setStrikeBurstNonce((value) => value + 1)}>CAST STRIKE SUITE</button></div>}
    {message && <div className="world-message">{message}</div>}
    <div className="world-layout">
      <div className={`world-map-shell${gpuVisualsState === null ? " world-map-booting" : ""}`}>
        <div className="world-map-status"><b>{zoomLabel}</b><em>{Math.round(zoom * 100)}%</em></div>
        {marches.length > 0 && <div style={{ position: "absolute", top: 12, left: "50%", transform: "translateX(-50%)", zIndex: 7, display: "flex", flexDirection: "column", gap: 5, maxWidth: 300 }}>
          {marches.slice(0, 4).map((m) => {
            const incoming = m.defender === address;
            const scout = m.kind === "scout";
            const eta = Math.max(0, Math.round((m.arriveAt - now) / 1000));
            const col = incoming ? "#ff6f85" : "#f3c46b";
            // Incoming: click to find the attacker's city (retaliation locate, docs/COMBAT.md §9).
            return <div key={m.id} role={incoming ? "button" : undefined} aria-label={incoming ? `Locate ${m.attackerName || "attacker"}` : undefined} onClick={incoming ? () => { setCamera({ ...m.from }); setZoom((value) => Math.max(value, 2.1)); setTileMark({ x: Math.floor(m.from.x), y: Math.floor(m.from.y) }); } : undefined} style={{ display: "flex", alignItems: "center", gap: 8, padding: "6px 11px", borderRadius: 9, border: `1px solid ${col}66`, background: "linear-gradient(160deg,rgba(14,10,16,.94),rgba(9,7,12,.96))", boxShadow: "0 6px 18px rgba(0,0,0,.35)", cursor: incoming ? "pointer" : undefined }}>
              <span style={{ font: "700 12px var(--hud)", color: scout ? "#7ff0c4" : col }}>{incoming ? "⚔" : scout ? "◎" : "➤"}</span>
              <span style={{ font: "600 10px var(--sans)", color: "#dbe2f3", flex: 1 }}>{incoming ? `${m.attackerName || "Enemy"} → YOU · ${m.armyTotal.toLocaleString()}` : scout ? `Scout → ${m.defenderName || "Target"}` : `You → ${m.defenderName || "Target"} · ${m.armyTotal.toLocaleString()}`}</span>
              <span style={{ font: "700 10px var(--mono)", color: col }}>{eta > 0 ? `${Math.floor(eta / 60)}:${String(eta % 60).padStart(2, "0")}` : "IMPACT"}</span>
            </div>;
          })}
        </div>}
        <div className="world-map-tools"><button onClick={() => setCamera({ ...playerCity.position })}>HOME</button><button className={searchOpen ? "active" : ""} aria-expanded={searchOpen} onClick={() => setSearchOpen((open) => !open)}>SEARCH</button><button aria-label="Zoom in" onClick={() => animateZoomTo(steppedWorldZoom(currentZoom(), "in", 1.35))}>＋</button><button aria-label="Zoom out" onClick={() => animateZoomTo(steppedWorldZoom(currentZoom(), "out", 1.35, zoomFloor))}>－</button></div>
        {searchOpen && <div className="world-search-panel" role="dialog" aria-label="Search the Star Map">
          <header><b>SEARCH</b><button aria-label="Close search" onClick={() => setSearchOpen(false)}>×</button></header>
          <div className="world-search-kinds" role="tablist">{SEARCH_KINDS.map((kind) => <button key={kind.id} role="tab" aria-selected={searchKind === kind.id} className={searchKind === kind.id ? "active" : ""} onClick={() => { setSearchKind(kind.id); setSearchResult(null); }}><i className={kind.id} />{kind.label}</button>)}</div>
          {searchKind === "coord" ? <form className="world-search-coord" onSubmit={(event) => { event.preventDefault(); viewCoordinates(); }}>
            <label>X<input aria-label="Search X coordinate" value={coordinateDraft.x} onChange={(event) => setCoordinateDraft((value) => ({ ...value, x: event.target.value }))} inputMode="numeric" autoFocus /></label>
            <label>Y<input aria-label="Search Y coordinate" value={coordinateDraft.y} onChange={(event) => setCoordinateDraft((value) => ({ ...value, y: event.target.value }))} inputMode="numeric" /></label>
            <button className="world-search-go">GO</button>
          </form> : <>
          <div className="world-search-level">
            <span>LEVEL</span>
            <button aria-label="Lower level" disabled={searchLevel <= 1} onClick={() => setSearchLevel(searchLevel - 1)}>−</button>
            <input type="range" aria-label="Target level" min={1} max={searchMaxLevel} value={searchLevel} onChange={(event) => setSearchLevel(Number(event.target.value))} />
            <button aria-label="Higher level" disabled={searchLevel >= searchMaxLevel} onClick={() => setSearchLevel(searchLevel + 1)}>+</button>
            <b>L{searchLevel}</b>
          </div>
          {searchKind === "monster" && <p className={`world-search-note ${searchLevel > nextRogueLevel ? "warn" : ""}`}>{searchLevel > nextRogueLevel ? `Locked · defeat L${nextRogueLevel} first` : `Unlocked up to L${nextRogueLevel}`}</p>}
          {searchResult?.key === searchKey && (() => { const hit = targets.find((entity) => entity.id === searchResult.targetId); return hit ? <p className="world-search-result"><b>{searchResult.index + 1}/{searchResult.total}</b> · {Math.round(hit.position.x).toString().padStart(3, "0")}:{Math.round(hit.position.y).toString().padStart(3, "0")} · {fmtDuration(travelSecondsTo(hit.position))}</p> : null; })()}
          <button className="world-search-go" onClick={runSearch}>{searchResult?.key === searchKey ? "NEXT ▸" : "SEARCH"}</button>
          </>}
        </div>}
        {warpOpen && <div className="world-warp-panel" role="dialog" aria-label="Warp your city">
          <header><b>WARP</b><button aria-label="Close warp" onClick={() => setWarpOpen(false)}>×</button></header>
          {warpNotReady && <p className="world-warp-alert">{ERROR_COPY[warpNotReady]}</p>}
          <section>
            <div className="world-warp-option-head"><b>PRECISION JUMP</b><em>{warpCounts ? `×${warpCounts.precision}` : "DEV"}</em></div>
            <form className="world-warp-coord" onSubmit={(event) => { event.preventDefault(); setWarpDestinationFromDraft(); }}>
              <label>X<input aria-label="Warp X coordinate" value={warpDraft.x} onChange={(event) => setWarpDraft((value) => ({ ...value, x: event.target.value }))} inputMode="numeric" /></label>
              <label>Y<input aria-label="Warp Y coordinate" value={warpDraft.y} onChange={(event) => setWarpDraft((value) => ({ ...value, y: event.target.value }))} inputMode="numeric" /></label>
              <button>SET</button>
            </form>
            <p>{warpDestination ? <>Destination <b>{coordLabel(warpDestination)}</b> · {fmtDuration(travelSecondsTo(warpDestination))} march from your current home</> : "Click an empty tile on the map, or enter X / Y."}</p>
            {warpDestination && warpDestinationBlock && <p className="world-warp-invalid">{ERROR_COPY[warpDestinationBlock]}</p>}
            {warpHint && <button type="button" className="world-warp-hint" onClick={selectWarpHint}>Nearest open tile <b>{coordLabel(warpHint)}</b> · SELECT</button>}
            <button className="world-warp-go" disabled={warpBusy || !!warpNotReady || !warpDestination || !!warpDestinationBlock || warpCounts?.precision === 0} onClick={() => void executeWarp("precision")}>{warpBusy ? "WARPING…" : "WARP HERE"}</button>
          </section>
          <section>
            <div className="world-warp-option-head"><b>DRIFT JUMP</b><em>{warpCounts ? `×${warpCounts.drift}` : "DEV"}</em></div>
            <p>Jump to a random safe sector of the Frontier.</p>
            <button className="world-warp-go secondary" disabled={warpBusy || !!warpNotReady || warpCounts?.drift === 0} onClick={() => void executeWarp("random")}>RANDOM WARP</button>
          </section>
          <footer>Fleets must be home · no warp while an attack is inbound · keep {WARP_RULES.minCitySpacing} tiles from other cities</footer>
        </div>}
        <div className="world-coordinate-jump"><button type="button" className={`world-warp-open ${warpOpen ? "active" : ""}`} aria-expanded={warpOpen} onClick={() => (warpOpen ? setWarpOpen(false) : openWarp())}>WARP</button></div>
        <div className="world-coordinate world-coordinate-x">X {Math.round(Math.max(0, viewX)).toString().padStart(3, "0")} — {Math.round(Math.min(world.config.width, viewX + viewport.width)).toString().padStart(3, "0")}</div>
        <div className="world-coordinate world-coordinate-y">Y {Math.round(Math.max(0, viewY)).toString().padStart(3, "0")} — {Math.round(Math.min(world.config.height, viewY + viewport.height)).toString().padStart(3, "0")}</div>
        <WorldBackdropLayer sealedQuadrants={sealedQuadrants} viewportRef={liveViewportRef} worldWidth={world.config.width} worldHeight={world.config.height} center={center} worldRadius={worldRadius} reserveRadius={world.config.circleReserveRadius} zoom={zoom} dprCap={quality.dprCap} animateStars={quality.bgAnimate} calm={CALM_MAP} tier={quality.tier} />
        <svg ref={svgRef} className="world-map world-map-v2 world-map-pan-plane" viewBox={renderViewBox} style={{ transform: `translate3d(0,0,0) scale(${WORLD_PAN_OVERSCAN})` }} onPointerDown={pointerDown} onPointerMove={pointerMove} onPointerUp={pointerUp} onPointerCancel={pointerCancel} >
          {mapScaffold}
          {(() => {
            // The Dust (naming bible world.fog) keeps its secrets: one quiet label on the
            // sealed wedge nearest the camera, no sector numbers, no opening conditions.
            if (!sealedQuadrants.length) return null;
            const arcMid = [Math.PI * 1.25, Math.PI * 1.75, Math.PI * .75, Math.PI * .25];
            const labelRadius = world.config.circleReserveRadius + (worldRadius - world.config.circleReserveRadius) * .55;
            const spot = (quadrant: number) => ({ x: center.x + Math.cos(arcMid[quadrant]) * labelRadius, y: center.y + Math.sin(arcMid[quadrant]) * labelRadius });
            const camX = viewX + viewport.width / 2, camY = viewY + viewport.height / 2;
            const nearest = [...sealedQuadrants].sort((a, b) => Math.hypot(spot(a).x - camX, spot(a).y - camY) - Math.hypot(spot(b).x - camX, spot(b).y - camY))[0];
            const { x, y } = spot(nearest);
            const u = worldPerPx;
            return <g className="world-dust-label" onPointerDown={(event) => event.stopPropagation()}
              onClick={() => setResultNotice({ title: "The Dust", good: false, detail: "Scanners return nothing but dust. Whatever lies beyond has not been charted." })}>
              <text x={x} y={y} className="world-dust-title" style={{ fontSize: 20 * u }}>THE DUST</text>
              <text x={x} y={y + 18 * u} className="world-dust-sub" style={{ fontSize: 8 * u }}>UNCHARTED</text>
            </g>;
          })()}
          {gpuFallback && mapMarches.map((march) => <MarchLine key={march.id} march={march} now={now} zoom={zoom} quality={quality} signature={world.players[march.playerId]?.cosmetics?.marchSignature ?? null} />)}
          {mapClusters}
          {/* Target lock sits under the markers so the level plate stays readable. */}
          {selected && selected.kind !== "city" && <CelestialLock key={`lock-${selected.id}`} position={selected.position} worldPerPx={worldPerPx}
            radius={(CALM_MAP ? calmTargetRadiusPx : (detailZoom ? 7.2 : 4.2) * markerScale / Math.max(.0001, worldPerPx)) * SELECT_SCALE + 7}
            tone={selected.kind === "resource" ? selected.resource : selected.level > nextRogueLevel ? "locked" : "rogue"} />}
          {mapTargets}
          {mapRemotePlayers}
          <g className={`world-city ${voidSkinEquipped ? "world-city-void" : ""}`} onPointerDown={(event) => event.stopPropagation()} onClick={() => { setSelectedId(null); setHomeSelected(true); setRemoteSelectedId(null); playSelectSfx(); }}>
            {strategicZoom && gpuFallback ? <g transform={`translate(${playerCity.position.x} ${playerCity.position.y}) scale(${homeScale}) translate(${-playerCity.position.x} ${-playerCity.position.y})`}>
              <circle cx={playerCity.position.x} cy={playerCity.position.y} r="9" className="world-home-ring" />
              <rect x={playerCity.position.x - 4.5} y={playerCity.position.y - 4.5} width="9" height="9" rx="1" transform={`rotate(45 ${playerCity.position.x} ${playerCity.position.y})`} />
              <circle cx={playerCity.position.x} cy={playerCity.position.y} r="1.7" />
            </g> : !strategicZoom && gpuFallback ? <>
              {equippedPlanetHalo && <g transform={`translate(${playerCity.position.x} ${playerCity.position.y}) scale(${homeScale}) translate(${-playerCity.position.x} ${-playerCity.position.y})`}><WorldHaloFx cx={playerCity.position.x} cy={playerCity.position.y} r={9} halo={equippedPlanetHalo} half="back" /></g>}
              {equippedPlanetOrbit && <g transform={`translate(${playerCity.position.x} ${playerCity.position.y}) scale(${homeScale}) translate(${-playerCity.position.x} ${-playerCity.position.y})`}><WorldOrbitFx cx={playerCity.position.x} cy={playerCity.position.y} r={9} orbit={equippedPlanetOrbit} half="back" /></g>}
              {(!voidSkinEquipped || !voidShaderActive) && <g transform={`translate(${playerCity.position.x} ${playerCity.position.y}) scale(${homeScale}) translate(${-playerCity.position.x} ${-playerCity.position.y})`}>
                <WorldPlanetFx cx={playerCity.position.x} cy={playerCity.position.y} r={9} skin={equippedPlanetSkin} />
              </g>}
              {equippedPlanetOrbit && <g transform={`translate(${playerCity.position.x} ${playerCity.position.y}) scale(${homeScale}) translate(${-playerCity.position.x} ${-playerCity.position.y})`}><WorldOrbitFx cx={playerCity.position.x} cy={playerCity.position.y} r={9} orbit={equippedPlanetOrbit} half="front" /></g>}
              {equippedPlanetHalo && <g transform={`translate(${playerCity.position.x} ${playerCity.position.y}) scale(${homeScale}) translate(${-playerCity.position.x} ${-playerCity.position.y})`}><WorldHaloFx cx={playerCity.position.x} cy={playerCity.position.y} r={9} halo={equippedPlanetHalo} half="front" /></g>}
            </> : <g transform={`translate(${playerCity.position.x} ${playerCity.position.y}) scale(${homeScale}) translate(${-playerCity.position.x} ${-playerCity.position.y})`}><circle cx={playerCity.position.x} cy={playerCity.position.y} r="14" className="world-city-hit" /></g>}
            {gpuFallback && <g transform={`translate(${playerCity.position.x} ${playerCity.position.y}) scale(${homeTagScale}) translate(${-playerCity.position.x} ${-playerCity.position.y})`}>
              <CityIdentityTag x={playerCity.position.x} y={playerCity.position.y + homeIdentityOffset} level={viewGame.buildings.keep.lvl} name={`${profile.factionSymbol ? `[${profile.factionSymbol}] ` : ""}${profile.name}`} signal={equippedCosmetics.chatSignal} own relation="self" coord={playerCity.position} />
            </g>}
          </g>
          {warpOpen && warpDestination && <g className={`world-warp-ghost ${warpDestinationBlock ? "invalid" : "valid"}`} pointerEvents="none">
            <circle cx={warpDestination.x} cy={warpDestination.y} r={WARP_RULES.minCitySpacing} className="world-warp-spacing" />
            <circle cx={warpDestination.x} cy={warpDestination.y} r={world.config.cityFootprint} className="world-warp-footprint" />
          </g>}
          {tileMark && <g className="world-tile-mark" pointerEvents="none">
            <rect x={tileMark.x} y={tileMark.y} width="1" height="1" className="world-tile-cell" />
            <g transform={`translate(${tileMark.x + .5} ${tileMark.y + .5}) scale(${1 / zoom}) translate(${-(tileMark.x + .5)} ${-(tileMark.y + .5)})`}>
              <path d={`M ${tileMark.x + .5 - 6} ${tileMark.y + .5} h 3.5 M ${tileMark.x + .5 + 2.5} ${tileMark.y + .5} h 3.5 M ${tileMark.x + .5} ${tileMark.y + .5 - 6} v 3.5 M ${tileMark.x + .5} ${tileMark.y + .5 + 2.5} v 3.5`} className="world-tile-cross" />
              <text x={tileMark.x + .5} y={tileMark.y + .5 - 7.5} className="world-tile-coord">{tileMark.x.toString().padStart(3, "0")}:{tileMark.y.toString().padStart(3, "0")}</text>
            </g>
          </g>}
        </svg>
        <WorldVisualLayer viewportRef={liveViewportRef} cities={visualCities} wormhole={center} zoom={zoom} onReadyChange={setGpuVisualsReady} calm={CALM_MAP} />
        <WorldStrikeLayer world={world} viewportRef={liveViewportRef} zoom={zoom} gm={gm} stressCount={strikeStressCount} burstNonce={strikeBurstNonce} dprCap={quality.dprCap} />
        <HomeBeacon viewportRef={liveViewportRef} home={playerCity.position} onHome={() => setCamera({ ...playerCity.position })} />
        <WorldMarchLayer world={world} viewportRef={liveViewportRef} zoom={zoom} viewerId={session.playerId} quality={quality} />
        {gpuVisualsReady && <svg ref={overlayRef} className="world-map world-map-overlay world-map-pan-plane" viewBox={renderViewBox} style={{ transform: `translate3d(0,0,0) scale(${WORLD_PAN_OVERSCAN})` }} aria-hidden="true">
          {mapMarches.map((march) => <MarchLine key={`overlay-${march.id}`} march={march} now={now} zoom={zoom} quality={quality} signature={world.players[march.playerId]?.cosmetics?.marchSignature ?? null} />)}
          {/* Selection ring for cities: a full circle in screen-space with a
              constant thin stroke, wrapping outside the planet's cosmetics at
              every zoom. Resources/rogues keep the base SVG lock-ring. */}
          {selected?.kind === "city" && <CelestialLock key={`lock-${selected.id}`} position={selected.position} radius={selectionRadius(false, true)} worldPerPx={worldPerPx} />}
          {homeSelected && <CelestialLock position={playerCity.position} radius={selectionRadius(true, false)} worldPerPx={worldPerPx} own />}
          {marches.filter((m) => m.kind === "scout" && m.attacker === address && m.arriveAt > now).map((m) => <ScoutTrail key={m.id} march={m} scale={markerScale} />)}
          {remoteSelected && !strategicZoom && <CelestialLock key={`lock-rp-${remoteSelected.id}`} position={remoteSelected.coords} tone="rival"
            radius={selectionRadius(false, true)} worldPerPx={worldPerPx} />}
          <g className="world-wormhole-caption" transform={`translate(${center.x} ${center.y}) scale(${worldPerPx})`}>
            <text y={-worldWormholeRadius(zoom) * 1.7 - 22} className="world-circle-label">WORMHOLE</text>
            <text y={-worldWormholeRadius(zoom) * 1.7 - 8} className="world-circle-sub">GRAVITY ANCHOR · FRONTIER I</text>
          </g>
          {layers.city && detailZoom && cityEntities.filter((city) => city.ownerId !== session.playerId).map((city) => {
            const cosmetics = world.players[city.ownerId]?.cosmetics || ISSUED_WORLD_COSMETICS;
            return <g key={`overlay-${city.id}`} transform={`translate(${city.position.x} ${city.position.y}) scale(${markerScale}) translate(${-city.position.x} ${-city.position.y})`}>
              {selectedId === city.id
                ? <CityIdentityTag x={city.position.x} y={city.position.y + rivalIdentityOffset} level={city.townhallLevel} name={localWorldTargetName(world, city.id)} signal={cosmetics.chatSignal} relation={cityRelation(city.ownerId)} />
                : <WorldLevelBadge x={city.position.x} y={city.position.y} level={city.townhallLevel} />}
            </g>;
          })}
          <g transform={`translate(${playerCity.position.x} ${playerCity.position.y}) scale(${homeTagScale}) translate(${-playerCity.position.x} ${-playerCity.position.y})`}>
            <CityIdentityTag x={playerCity.position.x} y={playerCity.position.y + homeIdentityOffset} level={viewGame.buildings.keep.lvl} name={`${profile.factionSymbol ? `[${profile.factionSymbol}] ` : ""}${profile.name}`} signal={equippedCosmetics.chatSignal} own relation="self" coord={playerCity.position} />
          </g>
        </svg>}
        {gpuFallback && voidSkinEquipped && <VoidPlanetOverlay svgRef={svgRef} home={playerCity.position} zoom={zoom} strategic={strategicZoom} onActiveChange={setVoidShaderActive} />}
        {resultNotice && <div className={`world-event-toast ${resultNotice.good ? "good" : "bad"}`}><div><small>MISSION UPDATE</small><b>{resultNotice.title}</b><span>{resultNotice.detail}</span></div><button aria-label="Dismiss mission update" onClick={() => setResultNotice(null)}>×</button></div>}
        {remoteSelected && (() => {
          // Commander card: sits beside the selected planet and follows it while the map
          // pans/zooms. Identity (sigil, alliance tag, name, Core) plus recon rows while a
          // scout's intel is valid. SHARE relays this same card (with the planet's location,
          // a player's own choice). `data-frame` is the slot for a card-frame cosmetic.
          const col = REMOTE_FACTION_COLOR[String(remoteSelected.faction || "")] || "#7cc0ff";
          const cosmetics = remoteSelected.cosmetics as { chatSignal?: ChatSignalId | null; cardFrame?: string } | null;
          const frame = /^[a-z0-9-]{1,24}$/.test(String(cosmetics?.cardFrame || "")) ? cosmetics!.cardFrame : "standard";
          const launching = scoutingId === remoteSelected.id;
          const scoutFlight = marches.find((m) => m.kind === "scout" && m.attacker === address && m.defender === remoteSelected.id && m.arriveAt > now);
          const intel = recon[remoteSelected.id];
          const intelLeftMs = intel ? intel.expiresAt - now : 0;
          const snap = intelLeftMs > 0 ? intel.snapshot : null;
          return <WorldAnchor svgRef={svgRef} point={remoteSelected.coords} className="commander-card" data-frame={frame} style={{ "--commander": col } as CSSProperties}>
            <button className="commander-card-close" aria-label="Close commander card" onClick={() => setRemoteSelectedId(null)}>×</button>
            <CommanderCardView id={remoteSelected.id} name={remoteSelected.name || "Commander"} faction={remoteSelected.faction || null} avatar={remoteSelected.avatar}
              coreLevel={remoteSelected.keepLevel || 1} signal={cosmetics?.chatSignal} recon={intel} now={now}>
            <div className="commander-card-actions">
              <button className="scout" disabled={launching || !!scoutFlight} onMouseEnter={() => setCardHint("Reveals Might, troops and loot · they will see the scout")} onMouseLeave={() => setCardHint(null)}
                onClick={() => { setScoutingId(remoteSelected.id); rtRef.current?.sendScout(remoteSelected.id); }}>{scoutFlight ? `◎ EN ROUTE · ${clockLeft(scoutFlight.arriveAt - now)}` : launching ? "LAUNCHING…" : snap ? "◎ RESCOUT" : "◎ SCOUT"}</button>
              <button className="attack" onMouseEnter={() => setCardHint("They will see your fleet coming")} onMouseLeave={() => setCardHint(null)}
                onClick={() => { rtRef.current?.sendMarch(remoteSelected.id); setResultNotice({ title: "March launched", detail: `Your army is marching on ${remoteSelected.name || "the target"}.`, good: true }); }}>⚔ ATTACK</button>
              <button className="quiet" onClick={() => { queueDirectMessage(address, { id: remoteSelected.id, name: remoteSelected.name || "Commander" }); onMessages(); }}>✉ MESSAGE</button>
              <button className="quiet" onClick={() => { queueCommsShare(address, createCommanderShare(remoteSelected, intelLeftMs > 0 ? intel : null)); onMessages(); }}>⇪ SHARE</button>
            </div>
            </CommanderCardView>
            {cardHint && <p className="commander-card-hint">{cardHint}</p>}
          </WorldAnchor>;
        })()}
        <div className="world-map-legend"><button className={layers.city ? "active" : ""} onClick={() => toggleLayer("city")}><i className="city" />{detailZoom ? "CIVILIZATIONS" : "CIV SIGNALS · TAC LOCK"}</button><button className={layers.resource ? "active" : ""} onClick={() => toggleLayer("resource")}><i className="resource" />PLANETS</button><button className={layers.monster ? "active" : ""} onClick={() => toggleLayer("monster")}><i className="hostile" />ROGUES</button><span><i className="march" />FLEETS</span></div>
        <div className="world-map-hint">FRONTIER I · ROGUE L1–{rogueMaxLevel} · {world.config.width}×{world.config.height} · {Object.keys(world.players).length}/{world.config.maxPlayers} CIVILIZATIONS{renderStressCount ? ` · ${renderStressCount.toLocaleString()} FX PROBES` : ""}{strikeStressCount ? ` · ${strikeStressCount} STRIKES` : ""}</div>
      </div>
      <aside className={`world-side ${selected ? "target-open" : "signals-open"}`}>
        <div className="world-intel-header"><b>{selected ? "TARGET INTEL" : "NEARBY SIGNALS"}</b><span><i />LIVE</span>{selected && <button aria-label="Close target intel" onClick={() => { setSelectedId(null); setSelection(emptySelection()); }}>×</button>}</div>
        {!selected ? <>
          <div className="world-nearby-signals">
            <div className="world-side-section-title">WITHIN SENSOR RANGE</div>
            {nearbySignals.map((target) => <button key={target.id} className="world-nearby-signal" onClick={() => focusTarget(target.id)}>
              <span className={`world-nearby-icon ${target.kind}`}>{entitySignalIcon(target)}</span>
              <span><b>{localWorldTargetName(world, target.id)}</b><small>{entityState(target)} · {Math.round(target.position.x).toString().padStart(3, "0")}:{Math.round(target.position.y).toString().padStart(3, "0")}</small></span>
              <time>{fmtDuration(travelSecondsTo(target.position))}</time>
            </button>)}
          </div>
          <div className="world-sensor-feed">
            <div className="world-side-section-title">SENSOR FEED</div>
            {activeMarches[0] ? <div className="world-sensor-event active"><b>Fleet in transit</b><span>{localWorldTargetName(world, activeMarches[0].targetId)} · {fmtDuration(marchRemainingSec(activeMarches[0], now))}</span></div> : <div className="world-sensor-event"><b>Fleet channels idle</b><span>{player.marchSlots} routes available</span></div>}
            {latestReports[0] ? (() => { const copy = reportCopy(latestReports[0], world, now); return <div className={`world-sensor-event ${copy.good ? "good" : "danger"}`}><b>{copy.title}</b><span>{copy.detail}</span></div>; })() : <div className="world-sensor-event"><b>Sector synchronized</b><span>{filteredTargets.length} live signals indexed</span></div>}
          </div>
        </> : <>
          <div className="world-target-toolbar"><div className={`world-intel-ribbon ${selectedVerified ? "verified" : "public"}`}><span>{selected.kind === "resource" ? "LIVE" : selectedVerified ? `SCANNED · ${fmtDuration(selectedIntelRemainingSec)}` : "PUBLIC"}</span></div><div className="world-target-actions"><button className={bookmarks.includes(selected.id) ? "saved" : ""} onClick={() => toggleBookmark(selected.id)}>{bookmarks.includes(selected.id) ? "★ SAVED" : "☆ SAVE"}</button><button className="relay" onClick={shareSelected}>{selected.kind === "city" && selectedVerified ? "▤ RELAY INTEL" : "◈ RELAY"}</button></div></div>
          <div className="world-target-head"><span style={{ color: entityColor(selected) }}>{KIND_META[selected.kind].icon}</span><div><small>{KIND_META[selected.kind].label}</small><b>{localWorldTargetName(world, selected.id)}</b></div><em>L{entityLevel(selected)}</em></div>
          <div className="world-facts"><span>COORDS <b>{Math.round(selected.position.x).toString().padStart(3, "0")}:{Math.round(selected.position.y).toString().padStart(3, "0")}</b></span><span>DISTANCE <b>{distance(playerCity.position, selected.position).toFixed(1)} LU</b></span><span>ETA <b>{fmtDuration(oneWay)}</b></span>
            {selected.kind === "resource" && <><span>ASSET <b style={{ color: RESOURCE_COLORS[selected.resource] }}>{RES[selected.resource].label}</b></span><span>AVAILABLE <b className={activeGatherOnSelected ? "world-liquidity-draining" : ""}>{compact(displayResource(liveSelectedAmount))}</b></span>{selectedOccupation !== "neutral" && <span>OCCUPIED <b className={`world-occupation-copy ${selectedOccupation}`}>{selectedOccupation === "self" ? "YOUR FLEET" : selectedOccupation === "ally" ? "ALLIED FLEET" : "RIVAL FLEET"}</b></span>}</>}
            {selected.kind === "monster" && <><span>POWER <b>{compact(selected.power)}</b></span><span>TYPE <b>{TROOPS_META[selected.dominantArm].label}</b></span><span>STATUS <b style={{ color: rogueLocked ? "var(--warn)" : "var(--ok)" }}>{rogueLocked ? `DEFEAT L${nextRogueLevel} FIRST` : "READY"}</b></span></>}
            {selected.kind === "city" && <><span>CORE <b>{selectedCoreName}</b></span><span>HALO <b>{selectedHaloName}</b></span><span>ORBIT <b>{selectedOrbitName}</b></span><span>SHIELD <b>{cityShielded(selected, now, N) ? "ACTIVE" : "OPEN"}</b></span><span>WALL <b>{selectedVerified ? `${selected.wall.value}/${selected.wall.max}` : "SCAN TO REVEAL"}</b></span><span>MIGHT <b>{selectedVerified ? compact(selectedScoutSnapshot.might ?? 0) : "SCAN TO REVEAL"}</b></span><span>IN-CITY TROOPS <b>{selectedVerified ? compact(displayTroops(selectedScoutSnapshot.garrison ?? 0)) : "SCAN TO REVEAL"}</b></span></>}
          </div>
          {selected.kind === "city" && selectedVerified && selectedScoutSnapshot.manifest && (() => {
            const man = selectedScoutSnapshot.manifest as Record<TroopKey, Record<string, number>>;
            const armTotal = (arm: TroopKey) => Object.values(man[arm] ?? {}).reduce((s, c) => s + (Number(c) || 0), 0);
            const armRows = TROOP_ORDER.map((arm) => ({ arm, total: armTotal(arm) })).filter((r) => r.total > 0);
            const topArm = armRows.slice().sort((a, b) => b.total - a.total)[0]?.arm;
            const tierRows = TROOP_ORDER.flatMap((arm) => Object.entries(man[arm] ?? {}).filter(([, c]) => Number(c) > 0).map(([tier, c]) => ({ arm, tier, c: Number(c) }))).sort((a, b) => Number(b.tier) - Number(a.tier));
            const loot = (selectedScoutSnapshot.loot ?? {}) as Record<string, number>;
            return <div className="world-scout-report">
              <div className="world-intel-expiry"><span>RECON SEAL</span><b>{fmtDuration(selectedIntelRemainingSec)}</b></div>
              <div className="world-side-section-title">GARRISON BY ARM</div>
              <div className="world-scout-arms">{armRows.map(({ arm, total }) => <div key={arm} className={`world-scout-arm ${arm === topArm ? "top" : ""}`}><span>{TROOPS_META[arm].emoji}</span><small>{TROOPS_META[arm].label}</small><b>{compact(displayTroops(total))}</b></div>)}</div>
              <div className="world-side-section-title">GARRISON BY TIER</div>
              {tierRows.map(({ arm, tier, c }) => <div className="world-scout-trow" key={`${arm}-${tier}`}><span>{TROOPS_META[arm].emoji} {TROOPS_META[arm].label} <em>T{tier}</em></span><b>{compact(displayTroops(c))}</b></div>)}
              <div className="world-side-section-title">LOOTABLE RESOURCES</div>
              {RES_ORDER.map((r) => <div className="world-scout-trow res" key={r}><span><i style={{ background: RESOURCE_COLORS[r] }} />{RES[r].label}</span><b style={{ color: RESOURCE_COLORS[r] }}>{compact(displayResource(loot[r] ?? 0))}</b></div>)}
            </div>;
          })()}
          {selected.kind === "city" && <button className="world-scout" onClick={() => run("scout")}><span>{selectedVerified ? "RE-SCAN" : "SCAN"}</span><em>RECON · {fmtDuration(scoutOneWay)}</em></button>}
          <div className="world-force-title"><b>FLEET</b><span className="world-force-count"><b>{compact(displayTroops(sentCount))}</b> / {compact(displayTroops(forceLimit))}</span></div>
          {selected.kind === "resource" && <div className="world-gather-recommend"><div><small>LOAD</small><b>{compact(displayResource(selectedCarry))} / {compact(displayResource(selected.amount))}</b></div><button onClick={autoAssignGatherForce}>AUTO MIN</button></div>}
          <div className="world-force-list">
            {TROOP_ORDER.flatMap((arm) => Object.entries(viewGame.troops[arm] ?? {}).filter(([, qty]) => qty > 0).map(([tier, qty]) => {
              const sel = selection[arm][tier] ?? 0;
              const headcountMax = Math.min(qty, forceLimit - (sentCount - sel));
              const unit = emptySelection(); unit[arm][tier] = 1;
              const unitLoad = gatherCarryWithAccount(unit, player.accountModifiers, N);
              const otherCarry = Math.max(0, selectedCarry - sel * unitLoad);
              const usefulMax = selected.kind === "resource" && unitLoad > 0
                ? Math.min(headcountMax, Math.ceil(Math.max(0, selected.amount - otherCarry) / unitLoad))
                : headcountMax;
              const rowMax = Math.max(sel, usefulMax);
              return <div className="world-force-row" key={`${arm}-${tier}`}>
                <span>{TROOPS_META[arm].emoji} {TROOPS_META[arm].label} T{tier}<small><b>{compact(displayTroops(sel))}</b> / {compact(displayTroops(qty))}</small></span>
                <input type="range" min="0" max={rowMax} step="1" value={sel} onChange={(event) => setTroop(arm, tier, Number(event.target.value))} disabled={rowMax <= 0} />
                <button className="world-force-max" aria-label={`Fill ${TROOPS_META[arm].label} tier ${tier} to useful maximum`} onClick={() => maxTroop(arm, tier, usefulMax)}>FILL MAX</button>
              </div>;
            }))}
            {totalTroops(viewGame) === 0 && <div className="world-no-force">NO TROOPS</div>}
          </div>
          {selected.kind === "resource" && sentCount > 0 && <div className="world-harvest-estimate"><span>HAUL</span><b style={{ color: RESOURCE_COLORS[selected.resource] }}>{RESOURCE_EMOJI[selected.resource]} {compact(displayResource(expectedHarvest))} {RES[selected.resource].label}</b></div>}
          {selected.kind === "monster" && monsterPreview && <div className={`world-combat-preview ${monsterPreview.win ? "win" : "lose"}`}><span>ESTIMATE</span><b>{monsterPreview.win ? "VICTORY" : "DEFEAT"}</b><small>{compact(displayTroops(monsterPreview.attackerLosses.wounded))} wounded · {compact(displayTroops(monsterPreview.attackerLosses.dead))} dead</small></div>}
          {selected.kind === "resource" ? <button className="world-dispatch" disabled={sentCount <= 0 || selected.state !== "available"} onClick={() => run("gather")}>HARVEST PLANET →</button> : selected.kind === "monster" ? <button className="world-dispatch danger" disabled={sentCount <= 0 || selected.state !== "alive" || rogueLocked} onClick={() => run("attack_monster")}>{rogueLocked ? `LOCKED · DEFEAT L${nextRogueLevel} FIRST` : `ENGAGE ROGUE · ${world.config.monsterEnergyCost} STAMINA →`}</button> : <button className="world-dispatch danger" disabled={sentCount <= 0 || cityShielded(selected, now, N)} onClick={() => run("attack_city")}>ATTACK CIVILIZATION →</button>}
        </>}
        <div className="world-marches"><div className="world-force-title"><b>FLEETS</b><span>{activeMarches.length}/{player.marchSlots}</span></div>{activeMarches.map((march) => <div className="world-march" key={march.id}><button className="world-march-focus" onClick={() => focusTarget(march.targetId)}><span>{march.action === "scout" ? "◎" : march.action === "gather" ? "◇" : "△"}</span><div><b>{localWorldTargetName(world, march.targetId)}</b><small>{march.state === "outbound" ? (march.action === "gather" ? "EN ROUTE TO HARVEST" : march.action === "scout" ? "SCOUT EN ROUTE" : "STRIKE EN ROUTE") : march.state === "gathering" ? "HARVESTING" : "RETURNING"} · <b>{fmtDuration(marchRemainingSec(march, now))}</b></small></div></button>{["outbound", "gathering"].includes(march.state) && <button className="world-recall" onClick={() => recall(march.id)}>RECALL</button>}</div>)}{!activeMarches.length && <div className="world-no-force">IDLE</div>}</div>
        {!!bookmarkedTargets.length && <div className="world-bookmarks"><div className="world-force-title"><b>SAVED</b><span>{bookmarkedTargets.length}</span></div>{bookmarkedTargets.map((target) => <button key={target.id} onClick={() => focusTarget(target.id)}><span style={{ color: entityColor(target) }}>{KIND_META[target.kind].icon}</span><b>{localWorldTargetName(world, target.id)}</b><small>{Math.round(target.position.x).toString().padStart(3, "0")}:{Math.round(target.position.y).toString().padStart(3, "0")}</small></button>)}</div>}
        {!!latestReports.length && <div className="world-reports"><div className="world-force-title"><b>REPORTS</b></div>{latestReports.map((report) => { const copy = reportCopy(report, world, now); return <button onClick={() => focusTarget(report.targetId)} className={`world-report ${copy.good ? "good" : "bad"}`} key={report.id}><b>{copy.title}</b><span>{copy.detail}</span></button>; })}</div>}
      </aside>
    </div>
    <MiniComms address={address} profile={profile} onOpenMessages={onMessages} />
  </section>;
}

function CelestialLock({ position, radius, worldPerPx, own = false, tone }: { position: Point; radius: number; worldPerPx: number; own?: boolean; tone?: LockTone }) {
  const arc = (angle: number) => {
    const a = (angle - 13) * Math.PI / 180, b = (angle + 13) * Math.PI / 180;
    return `M ${Math.cos(a) * radius} ${Math.sin(a) * radius} A ${radius} ${radius} 0 0 1 ${Math.cos(b) * radius} ${Math.sin(b) * radius}`;
  };
  return <g className={`world-celestial-lock ${tone ?? (own ? "own" : "rival")}`} transform={`translate(${position.x} ${position.y}) scale(${worldPerPx})`} pointerEvents="none">
    <g className="lock-body">
      {[35, 145, 215, 325].map((angle) => <g key={angle}>
        <path className="lock-underlay" d={arc(angle)} />
        <path className="lock-arc" d={arc(angle)} />
        <path className="lock-tick" transform={`rotate(${angle})`} d={`M ${radius + 4} 0 h 5 M ${radius - 4} -2 v 4`} />
      </g>)}
      <path className="lock-diamond" d={`M 0 ${-radius - 5} l 3 -4 l -3 -4 l -3 4 Z`} />
    </g>
  </g>;
}

function MarchLine({ march, now, zoom, quality, signature }: { march: HeadlessMarch; now: number; zoom: number; quality: GraphicsQuality; signature: MarchSignatureId | null }) {
  const progress = marchMapProgress(march, now); const x = march.origin.x + (march.destination.x - march.origin.x) * progress; const y = march.origin.y + (march.destination.y - march.origin.y) * progress;
  const heading = march.state === "returning"
    ? Math.atan2(march.origin.y - march.destination.y, march.origin.x - march.destination.x)
    : Math.atan2(march.destination.y - march.origin.y, march.destination.x - march.origin.x);
  const cursorDeg = heading * 180 / Math.PI + 90; // Cursor geometry points north before rotation.
  const eta = fmtDuration(marchRemainingSec(march, now));
  // Once the fleet has arrived to harvest it stops moving — and the connecting
  // line must vanish so a parked gather does not draw a permanent arrow back to
  // the commander's home coordinates. Strikes have no gather state: they arrive,
  // the strike layer plays, then the fleet returns along the line.
  const gatheringAtSite = march.state === "gathering";
  const showPath = !gatheringAtSite;
  const detailed = zoom >= WORLD_TACTICAL_ZOOM;
  const cursorScale = worldMarchScreenScale(zoom);
  const fxTier = quality.marchFx; // "kite" | "lite" | "full"
  // Medium+ tiers render the rich fleet signature on WorldMarchLayer (a Canvas
  // twin of the Vault preview). Here the SVG only draws the route line, ETA, and
  // the settled harvest mark; the flying marker is SVG only in the kite tier.
  const canvasFleet = !gatheringAtSite && !!signature && fxTier !== "kite";
  const phase = gatheringAtSite ? "harvesting" : progress < 0.045 ? "departing" : progress > 0.955 ? "arriving" : "cruising";
  return <g className={`world-march-line ${march.action} state-${march.state} signature-${signature || "none"} signature-${detailed ? "field" : "strategic"} fx-${fxTier} ${phase}`}>
    {showPath && <line x1={march.origin.x} y1={march.origin.y} x2={march.destination.x} y2={march.destination.y} />}
    <g transform={`translate(${x} ${y}) scale(${cursorScale / zoom}) translate(${-x} ${-y})`}>
      {!canvasFleet && <circle cx={x} cy={y} r="8.4" className="world-march-pulse" />}
      {gatheringAtSite
        ? <g className="world-march-cursor"><HarvestMark x={x} y={y} /></g>
        : canvasFleet ? null
        : <g className="world-march-cursor" transform={`rotate(${cursorDeg} ${x} ${y})`}><FleetKite x={x} y={y} /></g>}
      <text x={x} y={y - 11.5} className="world-march-eta">{eta}</text>
    </g>
  </g>;
}

// Settled "harvesting" glyph shown at a resource once the fleet has arrived —
// a parked collector ring, not a flying hull, and with no route line home.
function HarvestMark({ x, y }: { x: number; y: number }) {
  return <g className="world-march-harvest">
    <circle cx={x} cy={y} r="6.6" className="harvest-ring" />
    <circle cx={x} cy={y} r="3.4" className="harvest-core" />
    <path d={`M ${x} ${y - 6.6} v -2.4 M ${x} ${y + 6.6} v 2.4 M ${x - 6.6} ${y} h -2.4 M ${x + 6.6} ${y} h 2.4`} className="harvest-tick" />
  </g>;
}

function FleetKite({ x, y }: { x: number; y: number }) {
  return <g className="world-march-hull">
    <path d={`M ${x} ${y - 9.4} L ${x + 6.4} ${y + 1.5} L ${x + 2.15} ${y + .45} L ${x} ${y + 6.25} L ${x - 2.15} ${y + .45} L ${x - 6.4} ${y + 1.5} Z`} />
    <path d={`M ${x - 5.1} ${y + .9} L ${x - 1.8} ${y - 1.7} M ${x + 5.1} ${y + .9} L ${x + 1.8} ${y - 1.7}`} className="world-march-wing-etch" />
    <path d={`M ${x} ${y - 6.1} L ${x + 2.35} ${y - .1} L ${x} ${y + 2.85} L ${x - 2.35} ${y - .1} Z`} className="world-march-cursor-core" />
    <path d={`M ${x - 2.25} ${y + 1.15} Q ${x} ${y + 3.45} ${x + 2.25} ${y + 1.15}`} className="world-march-engine" />
    <circle cx={x} cy={y - 2.05} r="1.12" className="world-march-hull-light" />
  </g>;
}

/** Keeps an HTML panel beside a world point while the map pans and zooms: reads the live
 *  SVG transform every frame (drag pans bypass React state), prefers the right side and
 *  flips left near the edge, clamped inside the map frame. */
function WorldAnchor({ svgRef, point, className, style, children, ...rest }: {
  svgRef: RefObject<SVGSVGElement>; point: { x: number; y: number }; className: string; style?: CSSProperties; children: ReactNode; "data-frame"?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    let frame = 0;
    const place = () => {
      const el = ref.current, svg = svgRef.current, parent = el?.offsetParent as HTMLElement | null;
      const ctm = svg?.getScreenCTM();
      if (el && svg && parent && ctm) {
        const probe = svg.createSVGPoint(); probe.x = point.x; probe.y = point.y;
        const screen = probe.matrixTransform(ctm);
        const box = parent.getBoundingClientRect();
        const x = screen.x - box.left, y = screen.y - box.top;
        const w = el.offsetWidth, h = el.offsetHeight, gap = 34, pad = 10;
        const right = x + gap + w <= box.width - pad;
        const left = right ? x + gap : Math.max(pad, x - gap - w);
        const top = Math.max(pad, Math.min(box.height - h - pad, y - 30));
        el.style.transform = `translate3d(${Math.round(left)}px,${Math.round(top)}px,0)`;
        el.dataset.side = right ? "right" : "left";
        el.style.setProperty("--notch-y", `${Math.round(Math.max(14, Math.min(h - 14, y - top)))}px`);
        el.style.visibility = x < -60 || y < -60 || x > box.width + 60 || y > box.height + 60 ? "hidden" : "visible";
      }
      frame = requestAnimationFrame(place);
    };
    place();
    return () => cancelAnimationFrame(frame);
  }, [svgRef, point.x, point.y]);
  return <div ref={ref} className={className} style={style} {...rest}>{children}</div>;
}

type ReconIntel = { name: string; snapshot: ScoutSnapshot; at: number; expiresAt: number };
/** A server "recon" report → [targetId, intel] (the snapshot taken when the scout arrived). */
function reconFromReport(report: ServerReport): [string, ReconIntel] | null {
  if (report.kind !== "recon") return null;
  const payload = report.payload as { targetId?: unknown; snapshot?: unknown; expiresAt?: unknown } | undefined;
  if (!payload || typeof payload.targetId !== "string" || !payload.snapshot || !Number.isFinite(payload.expiresAt)) return null;
  return [payload.targetId, { name: report.byName || "Commander", snapshot: payload.snapshot as ScoutSnapshot, at: report.ts, expiresAt: Number(payload.expiresAt) }];
}

function clockLeft(ms: number): string {
  const sec = Math.max(0, Math.ceil(ms / 1000));
  return `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, "0")}`;
}

/** Your recon fleet in flight: a faint dashed route and one small dot gliding to the target
 *  (deliberately plain — no march FX). Position comes from the server times, so a page
 *  opened mid-flight shows the scout where it really is. */
function ScoutTrail({ march, scale }: { march: LiveMarch; scale: number }) {
  const dotRef = useRef<SVGCircleElement>(null);
  useEffect(() => {
    let frame = 0;
    const span = Math.max(1, march.arriveAt - march.departAt);
    const step = () => {
      const t = Math.min(1, Math.max(0, (Date.now() - march.departAt) / span));
      dotRef.current?.setAttribute("transform", `translate(${march.from.x + (march.to.x - march.from.x) * t} ${march.from.y + (march.to.y - march.from.y) * t})`);
      if (t < 1) frame = requestAnimationFrame(step);
    };
    step();
    return () => cancelAnimationFrame(frame);
  }, [march]);
  return <g className="world-scout-trail" pointerEvents="none">
    <line x1={march.from.x} y1={march.from.y} x2={march.to.x} y2={march.to.y} vectorEffect="non-scaling-stroke" />
    <circle ref={dotRef} r={3 * scale} cx={0} cy={0} transform={`translate(${march.from.x} ${march.from.y})`} />
  </g>;
}

/** The last Star Map view per player (module scope, survives page switches). */
type ViewCache = { at: number; targets: Record<string, WorldEntity>; occupiers: Record<string, string>; clusters: SignalCluster[] | null; fieldClusters: SignalCluster[] | null; players: MapCity[] };
const VIEW_CACHE = new Map<string, ViewCache>();
const VIEW_CACHE_MS = 10 * 60_000;
function cachedView(address: string): ViewCache | null {
  const entry = VIEW_CACHE.get(address);
  return entry && Date.now() - entry.at < VIEW_CACHE_MS ? entry : null;
}
