import { useEffect, useMemo, useRef, useState } from "react";
import { Profile } from "./lib/profile";
import {
  GameState, RES, RES_ORDER, TROOP_ORDER, TROOPS_META, TroopKey,
  displayResource, displayTroops, mightBreakdown, project, totalTroops,
} from "./lib/game";
import { loadGame, saveGame, initGame } from "./lib/gamestore";
import { getN } from "./lib/numbers";
import { compact } from "./lib/format";
import { gmFillTroops, grantLocalGm, hasLocalGm, localGmRequested } from "./lib/gm";
import type {
  CityEntity, HeadlessMarch, MonsterEntity, Point, ResourceEntity, WorldReport,
} from "./lib/world-engine";
import { ISSUED_WORLD_COSMETICS, distance, energyAt, isInsidePlayableWorld, isScoutReportActive, scoutReportExpiresAt, worldCenter, worldPlayableRadius, worldRogueMaxLevel } from "./lib/world-engine";
import { carryCapacity, resolveCombat } from "./lib/expedition";
import type { LocalWorldSession } from "./lib/world-adapter";
import {
  advanceLocalWorldSession, dispatchLocalWorldMarch, finishLocalWorldMarches,
  localWorldTargetName, openLocalWorldSession, recallLocalWorldMarch, saveLocalWorldSession, scanLocalWorldRogue,
} from "./lib/world-adapter";
import GameNav from "./GameNav";
import MiniComms from "./MiniComms";
import CosmicBackdrop from "./CosmicBackdrop";
import VoidPlanetOverlay from "./VoidPlanet";
import WorldVisualLayer, { createWorldVisualStress, type WorldVisualCity } from "./WorldVisualLayer";
import {
  PLANET_HALOS, PLANET_ORBITS, PLANET_SKINS, loadCosmeticVault,
  type ChatSignalId, type MarchSignatureId, type PlanetHaloId, type PlanetOrbitId, type PlanetSkinId,
} from "./lib/player-account";
import { radiantCrownSvgPath } from "./planet-halo-shared";
import { createCoordinateShare, createScoutIntelShare, queueCommsShare, takeWorldFocus } from "./lib/shared-intel";

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
const RESOURCE_EMOJI = { cash: "💰", oil: "⛽", power: "⚡" };
const RESOURCE_GRADIENT = { cash: "url(#world-planet-cash)", oil: "url(#world-planet-oil)", power: "url(#world-planet-power)" };
// In-flight gather milestones (shown live in Live Fleets) are kept out of the results archive.
const ARCHIVE_HIDDEN_OUTCOMES = new Set(["gathering_started", "gathering_completed"]);

type SignalCluster = { id: string; kind: "resource" | "monster"; position: Point; count: number };
export const WORLD_MIN_ZOOM = 1;
export const WORLD_MAX_ZOOM = 16;
export const WORLD_TACTICAL_ZOOM = 3;

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

function steppedWorldZoom(value: number, direction: "in" | "out", factor: number): number {
  return Math.max(WORLD_MIN_ZOOM, Math.min(WORLD_MAX_ZOOM, direction === "in" ? value * factor : value / factor));
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

function WorldLevelBadge({ x, y, level }: { x: number; y: number; level: number }) {
  return <g className="world-level-badge"><circle cx={x + 6.5} cy={y + 6.2} r="3.25" /><text x={x + 6.5} y={y + 7.25}>{level}</text></g>;
}

function CityIdentityTag({ x, y, level, name, signal = "clear-channel", own = false }: { x: number; y: number; level: number; name: string; signal?: ChatSignalId; own?: boolean }) {
  const label = name.slice(0, 18);
  // Width fits the actual rendered text (~1.82 units/char at this font) plus the level pill,
  // so the plate hugs the name instead of trailing empty space; the name is centred in the
  // region right of the pill.
  const charW = 1.82, levelPad = 9, rightPad = 4.5;
  const textW = label.length * charW;
  const width = Math.max(20, levelPad + textW + rightPad);
  const left = x - width / 2;
  const textCx = left + levelPad + textW / 2;
  return <g className={`world-city-tag signal-${signal} ${own ? "own" : "rival"}`} pointerEvents="none">
    <rect x={left} y={y + 6.1} width={width} height="7.1" rx="2.2" />
    <circle cx={left} cy={y + 9.65} r="4.15" />
    <text className="world-city-level" x={left} y={y + 10.9} textAnchor="middle">{level}</text>
    <text className="world-city-player" x={textCx} y={y + 10.85} textAnchor="middle">{label}</text>
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
      <circle cx={x} cy={y} r={radius} fill={RESOURCE_GRADIENT[entity.resource]} />
      <ellipse cx={x} cy={y} rx={radius * 1.22} ry={radius * .35} transform={`rotate(-18 ${x} ${y})`} fill="none" stroke={color} strokeWidth=".55" opacity=".68" />
      <circle cx={x - radius * .3} cy={y - radius * .32} r={radius * .18} fill="#f3fdff" opacity=".68" />
      {detailZoom && <><path d={`M ${x - 5.5} ${y + 1.8}Q ${x} ${y + 4.7} ${x + 5.5} ${y + 1.1}`} className="world-planet-contour" /><WorldSurfaceMark x={x} y={y} kind={entity.resource} /></>}
      {detailZoom && <WorldLevelBadge x={x} y={y} level={entity.level} />}
    </g>;
  }
  if (entity.kind === "city") {
    return <polygon points={`${x},${y - 4.1} ${x + 3.6},${y - 2} ${x + 3.6},${y + 2} ${x},${y + 4.1} ${x - 3.6},${y + 2} ${x - 3.6},${y - 2}`} fill={color} />;
  }
  if (detailZoom) return <g className="world-rogue-glyph"><circle cx={x} cy={y} r="7.2" /><ellipse cx={x} cy={y} rx="8.5" ry="2.4" transform={`rotate(16 ${x} ${y})`} /><path d={`M ${x - 5.4} ${y + 1.7}Q ${x} ${y + 4.5} ${x + 5.4} ${y + 1}`} className="world-planet-contour" /><WorldSurfaceMark x={x} y={y} kind="rogue" /><WorldLevelBadge x={x} y={y} level={entity.level} /></g>;
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
  if (skin === "void-touched") return <VoidTouchedPlanet cx={cx} cy={cy} r={r} />;
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
  return <g className="world-planet-skin world-planet-civic-core">
    <circle className="world-civic-atmosphere" cx={cx} cy={cy} r={r * 1.2} />
    <circle className="world-civic-body" cx={cx} cy={cy} r={r} fill="url(#world-planet-civic)" />
    <path className="world-civic-grid" d={`M ${cx - r * .72} ${cy - r * .05} Q ${cx} ${cy - r * .42} ${cx + r * .72} ${cy - r * .05} M ${cx - r * .7} ${cy + r * .28} Q ${cx} ${cy + r * .58} ${cx + r * .7} ${cy + r * .28} M ${cx} ${cy - r * .82} V ${cy + r * .82}`} />
    <rect className="world-civic-core" x={cx - r * .2} y={cy - r * .2} width={r * .4} height={r * .4} transform={`rotate(45 ${cx} ${cy})`} />
    <circle className="world-civic-spec" cx={cx - r * .3} cy={cy - r * .31} r={r * .15} />
  </g>;
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
  monster_level_locked: "Defeat the previous monster level first.", insufficient_energy: "Not enough Energy for this hunt.",
  rogue_level_locked: "Defeat the previous Rogue level first.", frontier_complete: "Frontier I is complete. The Wormhole is ready for a future map.",
  rogue_unavailable: "No matching Rogue signal is currently available.",
  target_shielded: "That city is protected by a shield.",
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
    return { title: report.outcome === "target_unavailable" ? `${target} was claimed first` : `Gathering at ${target}`, detail: report.outcome === "gathering_completed" ? `${compact(displayResource(Number(report.payload.hauled ?? 0)))} supplies loaded for return.` : report.outcome.split("_").join(" "), good };
  }
  const wounded = Number(report.payload.wounded ?? (report.payload.attackerLosses as any)?.wounded ?? 0);
  const dead = Number(report.payload.dead ?? (report.payload.attackerLosses as any)?.dead ?? 0);
  return { title: `${report.outcome === "victory" ? "Victory" : report.outcome === "defeat" ? "Defeat" : "Battle result"} at ${target}`, detail: `${compact(displayTroops(wounded))} wounded · ${compact(displayTroops(dead))} dead.`, good };
}

export default function World({ address, profile, onBack, onMessages = () => {}, onProfile = () => {} }: { address: string; profile: Profile; onBack: () => void; onMessages?: () => void; onProfile?: () => void }) {
  const N = useMemo(() => getN(), []);
  const equippedCosmetics = useMemo(() => loadCosmeticVault(address).equipped, [address]);
  const equippedPlanetSkin = equippedCosmetics.planetBody;
  const equippedPlanetHalo = equippedCosmetics.halo;
  const equippedPlanetOrbit = equippedCosmetics.orbit;
  const voidSkinEquipped = equippedPlanetSkin === "void-touched";
  const initial = useMemo(() => openLocalWorldSession(address, loadGame(address) || initGame(address), Date.now(), N), [address, N]);
  const [game, setGame] = useState<GameState>(() => initial.game);
  const [session, setSession] = useState<LocalWorldSession>(() => initial.session);
  const gameRef = useRef(initial.game);
  const sessionRef = useRef(initial.session);
  const [now, setNow] = useState(Date.now());
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [selection, setSelection] = useState<Record<TroopKey, Record<string, number>>>(emptySelection);
  const [message, setMessage] = useState(initial.session.migratedLegacyAt ? "Old World marches were safely settled and migrated." : "");
  const [zoom, setZoom] = useState(1.8);
  const [layers, setLayers] = useState<Record<WorldLayer, boolean>>({ resource: true, monster: true, city: true });
  const [coordinateDraft, setCoordinateDraft] = useState({ x: "", y: "" });
  const [bookmarks, setBookmarks] = useState<string[]>(() => loadBookmarks(address));
  const [resultNotice, setResultNotice] = useState<ResultNotice | null>(null);
  const [tileMark, setTileMark] = useState<Point | null>(null);
  const playerCity = session.world.entities[session.world.players[session.playerId].cityId] as CityEntity;
  const [camera, setCamera] = useState<Point>(() => ({ ...playerCity.position }));
  const svgRef = useRef<SVGSVGElement>(null);
  const [gpuVisualsReady, setGpuVisualsReady] = useState(false);
  // True while the WebGL Void-Touched shader is actively covering the home planet;
  // when so, we hide the SVG skin underneath to avoid a doubled halo.
  const [voidShaderActive, setVoidShaderActive] = useState(false);
  const drag = useRef<{ x: number; y: number; camera: Point; moved: boolean } | null>(null);
  // Drag coalescing: a trackpad fires pointermove far faster than the screen
  // refreshes. We stash the latest target camera and apply at most once per
  // animation frame, so a drag re-renders ~60x/s instead of 120–200x/s.
  const dragRaf = useRef<number | null>(null);
  const pendingCamera = useRef<Point | null>(null);
  const dispatchSeq = useRef(0);
  const seenReportCount = useRef(initial.session.world.players[initial.session.playerId].reportIds.length);
  const gm = hasLocalGm(address) || localGmRequested();

  useEffect(() => { gameRef.current = game; }, [game]);
  useEffect(() => { sessionRef.current = session; }, [session]);
  useEffect(() => {
    if (localGmRequested()) grantLocalGm(address);
    const opened = openLocalWorldSession(address, loadGame(address) || initGame(address), Date.now(), N);
    opened.session.world.players[opened.session.playerId].allianceId = profile.faction;
    setGame(opened.game); gameRef.current = opened.game; setSession(opened.session); sessionRef.current = opened.session;
    const city = opened.session.world.entities[opened.session.world.players[opened.session.playerId].cityId] as CityEntity;
    const requestedFocus = takeWorldFocus(address);
    const focusedEntity = requestedFocus?.targetId ? opened.session.world.entities[requestedFocus.targetId] : null;
    if (requestedFocus) {
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
    const timer = window.setInterval(() => {
      const tick = Date.now(); setNow(tick);
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
  useEffect(() => () => { if (dragRaf.current != null) cancelAnimationFrame(dragRaf.current); }, []);

  const world = session.world;
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
  const selectedCoreName = selectedCityCosmetics ? PLANET_SKINS.find((skin) => skin.id === selectedCityCosmetics.planetBody)?.name || "Civic Core" : "";
  const selectedHaloName = selectedCityCosmetics ? PLANET_HALOS.find((halo) => halo.id === selectedCityCosmetics.halo)?.name || "Faint Corona" : "";
  const selectedOrbitName = selectedCityCosmetics ? PLANET_ORBITS.find((orbit) => orbit.id === selectedCityCosmetics.orbit)?.name || "Survey Ring" : "";
  const allActiveMarches = Object.values(world.marches).filter((march) => !["completed", "failed"].includes(march.state));
  const activeMarches = allActiveMarches.filter((march) => march.playerId === session.playerId);
  const mapMarches = allActiveMarches.filter((march) => worldMarchObservable(march.playerId, session.playerId, zoom));
  const sentCount = TROOP_ORDER.reduce((sum, arm) => sum + Object.values(selection[arm]).reduce((subtotal, qty) => subtotal + (qty || 0), 0), 0);
  const viewport = { width: world.config.width / zoom, height: world.config.width * .655 / zoom };
  // The camera may look beyond a State edge. This is intentional: a node near
  // the rim must still be able to occupy the true visual center of the screen.
  const viewX = camera.x - viewport.width / 2;
  const viewY = camera.y - viewport.height / 2;
  const viewBox = `${viewX} ${viewY} ${viewport.width} ${viewport.height}`;
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
  const importantScale = (strategicZoom ? 1.6 : 1.18) / zoom;
  // The home planet must read as clearly the biggest body on the map at every
  // zoom. importantScale is a flat 1/zoom shrink, so in deep Tactical view it
  // fell BELOW a resource planet (whose worldMarkerScale grows via tacticalBoost).
  // Track that same growth curve and stay ~1.35x above it.
  const homeScale = strategicZoom ? 2 / zoom : worldMarkerScale(zoom) * 1.35;
  const filteredTargets = useMemo(() => targets.filter((entity) => layers[entity.kind]
    && worldTargetObservable(entity.kind, zoom)
    && !(entity.kind === "resource" && entity.state === "depleted")
    && !(entity.kind === "monster" && entity.state === "defeated")), [layers, targets, zoom]);
  const nearbySignals = useMemo(() => filteredTargets.slice()
    .sort((left, right) => distance(playerCity.position, left.position) - distance(playerCity.position, right.position))
    .slice(0, 3), [filteredTargets, playerCity.position.x, playerCity.position.y]);
  const signalClusters = useMemo(() => clusterWorldSignals(filteredTargets, 72), [filteredTargets]);
  const bookmarkedTargets = bookmarks.map((id) => targets.find((target) => target.id === id)).filter((target): target is SelectableEntity => !!target);
  const scoutIntelTtlMs = world.config.scoutIntelTtlSec * 1000;
  const scoutedTargetIds = useMemo(() => new Set(player.reportIds.map((id) => world.reports[id]).filter((report): report is WorldReport => !!report && isScoutReportActive(report, now, scoutIntelTtlMs)).map((report) => report.targetId)), [now, player.reportIds, scoutIntelTtlMs, world.reports]);
  const selectedScoutReport = selected ? player.reportIds.slice().reverse().map((id) => world.reports[id]).find((report) => report?.targetId === selected.id && isScoutReportActive(report, now, scoutIntelTtlMs)) : undefined;
  const selectedScoutSnapshot = (selectedScoutReport?.payload.snapshot ?? {}) as Record<string, any>;
  const selectedVerified = !!selected && (selected.kind === "resource" || scoutedTargetIds.has(selected.id));
  const selectedIntelRemainingSec = selectedScoutReport ? Math.max(0, Math.ceil((scoutReportExpiresAt(selectedScoutReport, scoutIntelTtlMs) - now) / 1000)) : 0;
  const selectedOccupation = selected?.kind === "resource"
    ? resourceOccupationDisposition(selected, world.marches, world.players, session.playerId, profile.faction)
    : "neutral";
  const zoomLabel = strategicZoom ? "STRATEGIC" : detailZoom ? "TACTICAL" : "FIELD";
  const renderStressCount = gm
    ? Math.max(0, Math.min(50_000, Math.floor(Number(new URLSearchParams(window.location.search).get("stress")) || 0)))
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
        const cosmetics = world.players[city.ownerId]?.cosmetics || ISSUED_WORLD_COSMETICS;
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
    return live.concat(detailZoom ? stressVisuals : []);
  }, [cityEntities, detailZoom, layers.city, selectedId, session.playerId, stressVisuals, world.players]);
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
      <radialGradient id="world-planet-cash" cx="32%" cy="27%"><stop offset="0" stopColor="#f3fff9"/><stop offset=".13" stopColor="#82ffc5"/><stop offset=".52" stopColor="#237756"/><stop offset="1" stopColor="#07140f"/></radialGradient>
      <radialGradient id="world-planet-oil" cx="32%" cy="27%"><stop offset="0" stopColor="#fff8e9"/><stop offset=".13" stopColor="#ffd08a"/><stop offset=".52" stopColor="#815528"/><stop offset="1" stopColor="#160e07"/></radialGradient>
      <radialGradient id="world-planet-power" cx="32%" cy="27%"><stop offset="0" stopColor="#f2fdff"/><stop offset=".13" stopColor="#89e7ff"/><stop offset=".52" stopColor="#226b91"/><stop offset="1" stopColor="#07131b"/></radialGradient>
      <radialGradient id="world-planet-civic" cx="34%" cy="28%"><stop offset="0" stopColor="#e9fdff"/><stop offset=".16" stopColor="#6fe8ff"/><stop offset=".56" stopColor="#17627b"/><stop offset="1" stopColor="#03101c"/></radialGradient>
      <radialGradient id="world-planet-void" cx="36%" cy="30%"><stop offset="0" stopColor="#3a3f63"/><stop offset=".32" stopColor="#1a2038"/><stop offset=".7" stopColor="#0a0e1e"/><stop offset="1" stopColor="#02040b"/></radialGradient>
      <radialGradient id="world-planet-solar" cx="34%" cy="27%"><stop offset="0" stopColor="#fffbea"/><stop offset=".15" stopColor="#ffe09a"/><stop offset=".5" stopColor="#dc7b26"/><stop offset="1" stopColor="#291007"/></radialGradient>
      <linearGradient id="world-void-tail" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stopColor="#8a3cff" stopOpacity=".55"/><stop offset=".55" stopColor="#7a2cff" stopOpacity=".18"/><stop offset="1" stopColor="#7a2cff" stopOpacity="0"/></linearGradient>
      <filter id="signal-glow" x="-200%" y="-200%" width="400%" height="400%"><feGaussianBlur stdDeviation="1.6" result="blur"/><feMerge><feMergeNode in="blur"/><feMergeNode in="SourceGraphic"/></feMerge></filter>
    </defs>
    <rect x={-world.config.width} y={-world.config.height} width={world.config.width * 3} height={world.config.height * 3} fill="url(#world-ground)" />
    <rect x={-world.config.width} y={-world.config.height} width={world.config.width * 3} height={world.config.height * 3} fill="url(#world-nebula)" />
    <g className="world-starfield">
      <rect x={-world.config.width} y={-world.config.height} width={world.config.width * 3} height={world.config.height * 3} fill="url(#world-stars)" />
      <animateTransform attributeName="transform" type="rotate" from={`0 ${center.x} ${center.y}`} to={`360 ${center.x} ${center.y}`} dur="420s" repeatCount="indefinite" />
    </g>
    <rect x={-world.config.width} y={-world.config.height} width={world.config.width * 3} height={world.config.height * 3} fill="url(#world-micro-grid)" />
    <rect x={-world.config.width} y={-world.config.height} width={world.config.width * 3} height={world.config.height * 3} fill="url(#world-grid)" />
    {Array.from({ length: 5 }, (_, index) => index + 1).map((ring) => <circle key={ring} cx={center.x} cy={center.y} r={worldRadius * ring / 5} className="world-sector-ring" opacity={ring === 5 ? .9 : .34} />)}
    <circle cx={center.x} cy={center.y} r={world.config.circleReserveRadius * 1.55} fill="url(#circle-core)" />
    <circle cx={center.x} cy={center.y} r={world.config.circleReserveRadius} className="world-core-ring" />
    <circle cx={center.x} cy={center.y} r={world.config.circleReserveRadius * .62} className="world-core-ring inner" />
    <path d={`M ${center.x - world.config.circleReserveRadius - 8} ${center.y} H ${center.x + world.config.circleReserveRadius + 8} M ${center.x} ${center.y - world.config.circleReserveRadius - 8} V ${center.y + world.config.circleReserveRadius + 8}`} className="world-core-cross" />
    <g transform={`translate(${center.x} ${center.y}) scale(${importantScale}) translate(${-center.x} ${-center.y})`} className="world-core-marker" onPointerDown={(event) => event.stopPropagation()} onClick={() => setCamera(center)}><circle cx={center.x} cy={center.y} r="32" className="world-core-hit" /></g>
  </>, [zoom, world.config, center.x, center.y, worldRadius, importantScale]);

  // LAYER 2a — strategic clusters. Depends on the signal set + zoom, not the camera.
  const mapClusters = useMemo(() => strategicZoom ? signalClusters.map((cluster) => <g key={cluster.id} transform={`translate(${cluster.position.x} ${cluster.position.y}) scale(${markerScale * 1.1}) translate(${-cluster.position.x} ${-cluster.position.y})`} className={`world-cluster ${cluster.kind}`} onPointerDown={(event) => event.stopPropagation()} onClick={() => { setCamera(cluster.position); setZoom(1.8); }}>
    <circle cx={cluster.position.x} cy={cluster.position.y} r="6.5" /><circle cx={cluster.position.x} cy={cluster.position.y} r="3.7" /><text x={cluster.position.x} y={cluster.position.y + 1.3}>{cluster.count}</text>
  </g>) : null, [strategicZoom, signalClusters, markerScale]);

  // LAYER 2b — planet / rogue / rival-city markers. Rebuilt only when the entities
  // themselves change (spawn / deplete / occupation), when zoom changes the marker
  // scale/detail, when the selection or bookmarks change, or when the coarse cull
  // cell changes — NOT on every drag frame and NOT on the 1s clock tick.
  const mapTargets = useMemo(() => {
    if (strategicZoom) return null;
    const cx = cullQX * cullCell, cy = cullQY * cullCell;
    const minX = cx - viewport.width * 1.5, maxX = cx + viewport.width * 1.5;
    const minY = cy - viewport.height * 1.5, maxY = cy + viewport.height * 1.5;
    return filteredTargets.filter((entity) => entity.position.x >= minX && entity.position.x <= maxX && entity.position.y >= minY && entity.position.y <= maxY)
      .map((entity) => {
        const color = entityColor(entity); const unavailable = (entity.kind === "resource" && entity.state !== "available") || (entity.kind === "monster" && entity.state !== "alive"); const selectedTarget = selectedId === entity.id; const verified = entity.kind === "resource" || scoutedTargetIds.has(entity.id);
        const occupation = entity.kind === "resource" ? resourceOccupationDisposition(entity, world.marches, world.players, session.playerId, profile.faction) : "neutral";
        const publicCosmetics = entity.kind === "city" ? world.players[entity.ownerId]?.cosmetics || ISSUED_WORLD_COSMETICS : null;
        return <g key={entity.id} transform={`translate(${entity.position.x} ${entity.position.y}) scale(${markerScale}) translate(${-entity.position.x} ${-entity.position.y})`} className={`world-target ${entity.kind} state-${entity.state} occupation-${occupation} ${selectedTarget ? "selected" : ""} ${verified ? "verified" : "public"} ${bookmarks.includes(entity.id) ? "bookmarked" : ""} ${unavailable ? "depleted" : ""}`} onPointerDown={(event) => event.stopPropagation()} onClick={() => { setSelectedId(entity.id); setSelection(emptySelection()); setMessage(""); setTileMark(null); }}>
          {selectedTarget && <><circle cx={entity.position.x} cy={entity.position.y} r="9" className="world-lock-ring" /><path d={`M ${entity.position.x - 12} ${entity.position.y} h 6 M ${entity.position.x + 6} ${entity.position.y} h 6 M ${entity.position.x} ${entity.position.y - 12} v 6 M ${entity.position.x} ${entity.position.y + 6} v 6`} className="world-lock-cross" /></>}
          {(!gpuVisualsReady || entity.kind !== "city") && <circle cx={entity.position.x} cy={entity.position.y} r={entity.kind === "city" ? 4.5 : 3.6} fill={color} className="world-signal-halo" />}
          {entity.kind === "city" && publicCosmetics ? <>
            {gpuVisualsReady ? <circle cx={entity.position.x} cy={entity.position.y} r="14" className="world-city-hit" /> : <>
              <WorldHaloFx cx={entity.position.x} cy={entity.position.y} r={9} halo={publicCosmetics.halo} half="back" />
              <WorldOrbitFx cx={entity.position.x} cy={entity.position.y} r={9} orbit={publicCosmetics.orbit} half="back" />
              <WorldPlanetFx cx={entity.position.x} cy={entity.position.y} r={9} skin={publicCosmetics.planetBody} />
              <WorldOrbitFx cx={entity.position.x} cy={entity.position.y} r={9} orbit={publicCosmetics.orbit} half="front" />
              <WorldHaloFx cx={entity.position.x} cy={entity.position.y} r={9} halo={publicCosmetics.halo} half="front" />
            </>}
          </> : <WorldEntityGlyph entity={entity} detailZoom={detailZoom} occupation={occupation} />}
          {!gpuVisualsReady && entity.kind === "city" && detailZoom && (selectedId === entity.id
            ? <CityIdentityTag x={entity.position.x} y={entity.position.y} level={entity.townhallLevel} name={localWorldTargetName(world, entity.id)} signal={publicCosmetics?.chatSignal} />
            : <WorldLevelBadge x={entity.position.x} y={entity.position.y} level={entity.townhallLevel} />)}
          {verified && entity.kind !== "resource" && <circle cx={entity.position.x + 4.5} cy={entity.position.y - 4.5} r="1.2" className="world-verified-dot" />}
          {bookmarks.includes(entity.id) && <text x={entity.position.x + 7} y={entity.position.y - 6} className="world-bookmark-star">★</text>}
        </g>;
      });
  }, [filteredTargets, strategicZoom, detailZoom, markerScale, selectedId, bookmarks, scoutedTargetIds, world.marches, world.players, world.entities, session.playerId, profile.faction, viewport.width, viewport.height, cullQX, cullQY, cullCell, gpuVisualsReady]);

  function commit(result: ReturnType<typeof advanceLocalWorldSession>) {
    sessionRef.current = result.session; setSession(result.session); setGame(result.game); gameRef.current = result.game; saveLocalWorldSession(result.session); saveGame(result.game);
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
  function run(action: "scout" | "gather" | "attack_monster" | "attack_city") {
    if (!selected) return;
    // Scouting occupies a march slot but does not quietly reserve whatever force
    // the player happened to have selected for a later attack.
    const force = action === "scout" ? emptySelection() : selection;
    const result = dispatchLocalWorldMarch(session, viewGame, { targetId: selected.id, action, force, idempotencyKey: `ui:${Date.now()}:${dispatchSeq.current++}` }, Date.now(), N);
    if (result.error) { setMessage(ERROR_COPY[result.error] || result.error.split("_").join(" ")); return; }
    commit(result); setSelection(emptySelection());
    setMessage(`${action === "scout" ? "Survey probe" : action === "gather" ? "Harvest fleet" : "Strike fleet"} launched toward ${localWorldTargetName(result.session.world, selected.id)}.`);
  }
  function finishMarches() {
    const result = finishLocalWorldMarches(session, viewGame, Date.now(), N); commit(result);
    revealLatestReport(result.session);
    setMessage("GM: all active marches completed through the headless engine.");
  }
  function fillTroops() {
    const result = advanceLocalWorldSession(session, gmFillTroops(viewGame), Date.now(), N); commit(result);
    setMessage("GM: standing troops filled to current training-building capacity.");
  }
  function focusTarget(targetId: string) {
    const target = targets.find((entity) => entity.id === targetId);
    if (!target) { setMessage("That signal has left the current sector."); return; }
    setSelectedId(target.id); setCamera({ ...target.position }); setZoom((value) => Math.max(value, target.kind === "city" ? 3.2 : 2.1)); setMessage("");
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
  function findNextRogue() {
    if (frontierComplete) { setCamera(center); setMessage("Frontier I complete. Hold the Wormhole to enter the next map when it opens."); return; }
    const result = scanLocalWorldRogue(session, viewGame, nextRogueLevel, Date.now(), N);
    if (result.error || !result.targetId) { setMessage(ERROR_COPY[result.error || "rogue_unavailable"] || "No Rogue signal found."); return; }
    commit(result);
    const target = result.session.world.entities[result.targetId];
    if (!target || target.kind !== "monster") return;
    setSelectedId(target.id); setSelection(emptySelection()); setCamera({ ...target.position });
    setZoom((value) => Math.max(value, 2.1)); setTileMark(null);
    setMessage(result.spawned
      ? `Deep Scan discovered an uncharted L${target.level} Rogue signal.`
      : `Tracking the nearest L${target.level} Rogue signal.`);
  }
  function toggleLayer(layer: WorldLayer) {
    setLayers((current) => ({ ...current, [layer]: !current[layer] }));
    if (selected?.kind === layer) setSelectedId(null);
  }
  function toggleBookmark(targetId: string) {
    setBookmarks((current) => current.includes(targetId) ? current.filter((id) => id !== targetId) : [...current, targetId]);
  }
  function viewCoordinates() {
    const x = Number(coordinateDraft.x); const y = Number(coordinateDraft.y);
    if (!Number.isFinite(x) || !Number.isFinite(y)) { setMessage("Enter a valid X and Y coordinate."); return; }
    const point = { x, y };
    if (!isInsidePlayableWorld(point, world.config, 0)) { setMessage("Those coordinates are outside the circular Frontier."); return; }
    setCamera(point); setSelectedId(null); setMessage(`Viewing sector ${Math.round(point.x).toString().padStart(3, "0")}:${Math.round(point.y).toString().padStart(3, "0")}. Your civilization has not moved.`);
  }
  function recall(marchId: string) {
    // gameRef is updated synchronously by commit; the projected render value can
    // lag one frame behind a dispatch during fast GM/browser interactions.
    const result = recallLocalWorldMarch(session, gameRef.current, marchId, Date.now(), N);
    if (result.error) { setMessage("That fleet can no longer be recalled."); return; }
    commit(result); setMessage("Fleet recalled. It is returning along its traveled route.");
  }
  function flushCamera() {
    dragRaf.current = null;
    if (pendingCamera.current) { setCamera(pendingCamera.current); pendingCamera.current = null; }
  }
  function pointerDown(event: React.PointerEvent<SVGSVGElement>) { drag.current = { x: event.clientX, y: event.clientY, camera, moved: false }; event.currentTarget.setPointerCapture(event.pointerId); }
  function pointerMove(event: React.PointerEvent<SVGSVGElement>) {
    if (!drag.current) return;
    if (!drag.current.moved && Math.hypot(event.clientX - drag.current.x, event.clientY - drag.current.y) > 3) drag.current.moved = true;
    const scale = viewport.width / Math.max(1, event.currentTarget.clientWidth);
    pendingCamera.current = {
      x: Math.max(0, Math.min(world.config.width, drag.current.camera.x - (event.clientX - drag.current.x) * scale)),
      y: Math.max(0, Math.min(world.config.height, drag.current.camera.y - (event.clientY - drag.current.y) * scale)),
    };
    if (dragRaf.current == null) dragRaf.current = requestAnimationFrame(flushCamera);
  }
  function pointerUp(event: React.PointerEvent<SVGSVGElement>) {
    const state = drag.current; drag.current = null;
    if (dragRaf.current != null) { cancelAnimationFrame(dragRaf.current); flushCamera(); }
    // A press with no drag on empty space = inspect that tile's coordinate (Kingshot-style).
    if (!state || state.moved) return;
    const svg = event.currentTarget; const ctm = svg.getScreenCTM(); if (!ctm) return;
    const pt = svg.createSVGPoint(); pt.x = event.clientX; pt.y = event.clientY;
    const local = pt.matrixTransform(ctm.inverse());
    const tx = Math.max(0, Math.min(world.config.width - 1, Math.floor(local.x)));
    const ty = Math.max(0, Math.min(world.config.height - 1, Math.floor(local.y)));
    setTileMark({ x: tx, y: ty }); setSelectedId(null);
  }

  return <section className="world world-crypto world-cosmos">
    <CosmicBackdrop />
    <div className="world-page-black-hole" aria-hidden="true"><i className="world-page-hole-glow" /><i className="world-page-accretion" /><i className="world-page-hole-core" /></div>
    <GameNav view="world" profile={profile} townhallLevel={viewGame.buildings.keep.lvl}
      location={`SECTOR ${world.stateId.slice(-6).toUpperCase()} · HOME ${Math.round(playerCity.position.x).toString().padStart(3, "0")}:${Math.round(playerCity.position.y).toString().padStart(3, "0")}`}
      resources={viewGame.res}
      energy={energy} energyCap={world.config.energyCap} activeFleets={activeMarches.length} fleetCap={player.marchSlots}
      standing={totalTroops(viewGame)} wounded={viewGame.wounded} might={mightBreakdown(viewGame).total}
      onCity={onBack} onWorld={() => {}} onMessages={onMessages} onProfile={onProfile} />
    {gm && <div className="world-gm-strip"><span>LOCAL GM</span><button onClick={fillTroops}>FILL TROOPS</button><button onClick={finishMarches} disabled={!activeMarches.length}>RESOLVE FLEETS</button></div>}
    {message && <div className="world-message">{message}</div>}
    <div className="world-layout">
      <div className="world-map-shell">
        <div className="world-map-status"><b>{zoomLabel}</b><em>{Math.round(zoom * 100)}%</em></div>
        <div className="world-map-tools"><button onClick={() => setCamera({ ...playerCity.position })}>HOME</button><button onClick={() => setCamera(center)}>WORMHOLE</button><button onClick={findNextRogue}>{frontierComplete ? "CORE READY" : `NEXT ROGUE · L${nextRogueLevel}`}</button><button aria-label="Zoom in" onClick={() => setZoom((value) => steppedWorldZoom(value, "in", 1.35))}>＋</button><button aria-label="Zoom out" onClick={() => setZoom((value) => steppedWorldZoom(value, "out", 1.35))}>－</button></div>
        <form className="world-coordinate-jump" onSubmit={(event) => { event.preventDefault(); viewCoordinates(); }}><label>X<input aria-label="X coordinate" value={coordinateDraft.x} onChange={(event) => setCoordinateDraft((value) => ({ ...value, x: event.target.value }))} inputMode="numeric" /></label><label>Y<input aria-label="Y coordinate" value={coordinateDraft.y} onChange={(event) => setCoordinateDraft((value) => ({ ...value, y: event.target.value }))} inputMode="numeric" /></label><button>GO</button><button type="button" className="world-warp-locked" onClick={() => setMessage("Relocation requires a Warp Engine consumable. Warp travel is not enabled in this MVP build.")}>WARP 🔒</button></form>
        <div className="world-coordinate world-coordinate-x">X {Math.round(viewX).toString().padStart(3, "0")} — {Math.round(viewX + viewport.width).toString().padStart(3, "0")}</div>
        <div className="world-coordinate world-coordinate-y">Y {Math.round(viewY).toString().padStart(3, "0")} — {Math.round(viewY + viewport.height).toString().padStart(3, "0")}</div>
        <svg ref={svgRef} className="world-map world-map-v2" viewBox={viewBox} onPointerDown={pointerDown} onPointerMove={pointerMove} onPointerUp={pointerUp} onPointerCancel={() => { drag.current = null; }} onWheel={(event) => { event.preventDefault(); setZoom((value) => steppedWorldZoom(value, event.deltaY < 0 ? "in" : "out", 1.14)); }}>
          {mapScaffold}
          {!gpuVisualsReady && mapMarches.map((march) => <MarchLine key={march.id} march={march} now={now} zoom={zoom} signature={world.players[march.playerId]?.cosmetics?.marchSignature || "ion-wake"} />)}
          {mapClusters}
          {mapTargets}
          <g className={`world-city ${voidSkinEquipped ? "world-city-void" : ""}`} onPointerDown={(event) => event.stopPropagation()} onClick={() => setCamera({ ...playerCity.position })}>
            {strategicZoom && !gpuVisualsReady ? <g transform={`translate(${playerCity.position.x} ${playerCity.position.y}) scale(${homeScale}) translate(${-playerCity.position.x} ${-playerCity.position.y})`}>
              <circle cx={playerCity.position.x} cy={playerCity.position.y} r="9" className="world-home-ring" />
              <rect x={playerCity.position.x - 4.5} y={playerCity.position.y - 4.5} width="9" height="9" rx="1" transform={`rotate(45 ${playerCity.position.x} ${playerCity.position.y})`} />
              <circle cx={playerCity.position.x} cy={playerCity.position.y} r="1.7" />
            </g> : !strategicZoom && !gpuVisualsReady ? <>
              <g transform={`translate(${playerCity.position.x} ${playerCity.position.y}) scale(${homeScale}) translate(${-playerCity.position.x} ${-playerCity.position.y})`}><WorldHaloFx cx={playerCity.position.x} cy={playerCity.position.y} r={9} halo={equippedPlanetHalo} half="back" /></g>
              <g transform={`translate(${playerCity.position.x} ${playerCity.position.y}) scale(${homeScale}) translate(${-playerCity.position.x} ${-playerCity.position.y})`}><WorldOrbitFx cx={playerCity.position.x} cy={playerCity.position.y} r={9} orbit={equippedPlanetOrbit} half="back" /></g>
              {(!voidSkinEquipped || !voidShaderActive) && <g transform={`translate(${playerCity.position.x} ${playerCity.position.y}) scale(${homeScale}) translate(${-playerCity.position.x} ${-playerCity.position.y})`}>
                <WorldPlanetFx cx={playerCity.position.x} cy={playerCity.position.y} r={9} skin={equippedPlanetSkin} />
              </g>}
              <g transform={`translate(${playerCity.position.x} ${playerCity.position.y}) scale(${homeScale}) translate(${-playerCity.position.x} ${-playerCity.position.y})`}><WorldOrbitFx cx={playerCity.position.x} cy={playerCity.position.y} r={9} orbit={equippedPlanetOrbit} half="front" /></g>
              <g transform={`translate(${playerCity.position.x} ${playerCity.position.y}) scale(${homeScale}) translate(${-playerCity.position.x} ${-playerCity.position.y})`}><WorldHaloFx cx={playerCity.position.x} cy={playerCity.position.y} r={9} halo={equippedPlanetHalo} half="front" /></g>
            </> : <g transform={`translate(${playerCity.position.x} ${playerCity.position.y}) scale(${homeScale}) translate(${-playerCity.position.x} ${-playerCity.position.y})`}><circle cx={playerCity.position.x} cy={playerCity.position.y} r="14" className="world-city-hit" /></g>}
            {!gpuVisualsReady && <g transform={`translate(${playerCity.position.x} ${playerCity.position.y}) scale(${importantScale}) translate(${-playerCity.position.x} ${-playerCity.position.y})`}>
              <CityIdentityTag x={playerCity.position.x} y={playerCity.position.y} level={viewGame.buildings.keep.lvl} name={profile.name} signal={equippedCosmetics.chatSignal} own />
              <text x={playerCity.position.x} y={playerCity.position.y + 18} className="world-city-coordinate">{Math.round(playerCity.position.x).toString().padStart(3, "0")}:{Math.round(playerCity.position.y).toString().padStart(3, "0")}</text>
            </g>}
          </g>
          {tileMark && <g className="world-tile-mark" pointerEvents="none">
            <rect x={tileMark.x} y={tileMark.y} width="1" height="1" className="world-tile-cell" />
            <g transform={`translate(${tileMark.x + .5} ${tileMark.y + .5}) scale(${1 / zoom}) translate(${-(tileMark.x + .5)} ${-(tileMark.y + .5)})`}>
              <path d={`M ${tileMark.x + .5 - 6} ${tileMark.y + .5} h 3.5 M ${tileMark.x + .5 + 2.5} ${tileMark.y + .5} h 3.5 M ${tileMark.x + .5} ${tileMark.y + .5 - 6} v 3.5 M ${tileMark.x + .5} ${tileMark.y + .5 + 2.5} v 3.5`} className="world-tile-cross" />
              <text x={tileMark.x + .5} y={tileMark.y + .5 - 7.5} className="world-tile-coord">{tileMark.x.toString().padStart(3, "0")}:{tileMark.y.toString().padStart(3, "0")}</text>
            </g>
          </g>}
        </svg>
        <WorldVisualLayer svgRef={svgRef} cities={visualCities} wormhole={center} zoom={zoom} onReadyChange={setGpuVisualsReady} />
        {gpuVisualsReady && <svg className="world-map world-map-overlay" viewBox={viewBox} aria-hidden="true">
          {mapMarches.map((march) => <MarchLine key={`overlay-${march.id}`} march={march} now={now} zoom={zoom} signature={world.players[march.playerId]?.cosmetics?.marchSignature || "ion-wake"} />)}
          <g transform={`translate(${center.x} ${center.y}) scale(${importantScale}) translate(${-center.x} ${-center.y})`}>
            <text x={center.x} y={center.y - 47} className="world-circle-label">WORMHOLE</text>
            <text x={center.x} y={center.y - 39} className="world-circle-sub">GRAVITY ANCHOR · FRONTIER I</text>
          </g>
          {layers.city && detailZoom && cityEntities.filter((city) => city.ownerId !== session.playerId).map((city) => {
            const cosmetics = world.players[city.ownerId]?.cosmetics || ISSUED_WORLD_COSMETICS;
            return <g key={`overlay-${city.id}`} transform={`translate(${city.position.x} ${city.position.y}) scale(${markerScale}) translate(${-city.position.x} ${-city.position.y})`}>
              {selectedId === city.id
                ? <CityIdentityTag x={city.position.x} y={city.position.y + 32} level={city.townhallLevel} name={localWorldTargetName(world, city.id)} signal={cosmetics.chatSignal} />
                : <WorldLevelBadge x={city.position.x} y={city.position.y} level={city.townhallLevel} />}
            </g>;
          })}
          <g transform={`translate(${playerCity.position.x} ${playerCity.position.y}) scale(${importantScale}) translate(${-playerCity.position.x} ${-playerCity.position.y})`}>
            <CityIdentityTag x={playerCity.position.x} y={playerCity.position.y + 32} level={viewGame.buildings.keep.lvl} name={profile.name} signal={equippedCosmetics.chatSignal} own />
            <text x={playerCity.position.x} y={playerCity.position.y + 51} className="world-city-coordinate">{Math.round(playerCity.position.x).toString().padStart(3, "0")}:{Math.round(playerCity.position.y).toString().padStart(3, "0")}</text>
          </g>
        </svg>}
        {!gpuVisualsReady && voidSkinEquipped && <VoidPlanetOverlay svgRef={svgRef} home={playerCity.position} zoom={zoom} strategic={strategicZoom} onActiveChange={setVoidShaderActive} />}
        {resultNotice && <div className={`world-event-toast ${resultNotice.good ? "good" : "bad"}`}><div><small>MISSION UPDATE</small><b>{resultNotice.title}</b><span>{resultNotice.detail}</span></div><button aria-label="Dismiss mission update" onClick={() => setResultNotice(null)}>×</button></div>}
        <div className="world-map-legend"><button className={layers.city ? "active" : ""} onClick={() => toggleLayer("city")} title={detailZoom ? "Civilization signatures resolved" : "Civilization signatures resolve inside Tactical range"}><i className="city" />{detailZoom ? "CIVILIZATIONS" : "CIV SIGNALS · TAC LOCK"}</button><button className={layers.resource ? "active" : ""} onClick={() => toggleLayer("resource")}><i className="resource" />PLANETS</button><button className={layers.monster ? "active" : ""} onClick={() => toggleLayer("monster")}><i className="hostile" />ROGUES</button><span><i className="march" />FLEETS</span></div>
        <div className="world-map-hint">FRONTIER I · ROGUE L1–{rogueMaxLevel} · {world.config.width}×{world.config.height} · {Object.keys(world.players).length}/{world.config.maxPlayers} CIVILIZATIONS{renderStressCount ? ` · ${renderStressCount.toLocaleString()} FX PROBES` : ""}</div>
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
                <button className="world-force-max" title={selected.kind === "resource" ? "Add only the troops whose load this planet can use" : `Fill ${TROOPS_META[arm].label} T${tier} to its maximum`} aria-label={`Fill ${TROOPS_META[arm].label} tier ${tier} to useful maximum`} onClick={() => maxTroop(arm, tier, usefulMax)}>FILL MAX</button>
              </div>;
            }))}
            {totalTroops(viewGame) === 0 && <div className="world-no-force">NO TROOPS</div>}
          </div>
          {selected.kind === "resource" && sentCount > 0 && <div className="world-harvest-estimate"><span>HAUL</span><b style={{ color: RESOURCE_COLORS[selected.resource] }}>{RESOURCE_EMOJI[selected.resource]} {compact(displayResource(expectedHarvest))} {RES[selected.resource].label}</b></div>}
          {selected.kind === "monster" && monsterPreview && <div className={`world-combat-preview ${monsterPreview.win ? "win" : "lose"}`}><span>ESTIMATE</span><b>{monsterPreview.win ? "VICTORY" : "DEFEAT"}</b><small>{compact(displayTroops(monsterPreview.attackerLosses.wounded))} wounded · {compact(displayTroops(monsterPreview.attackerLosses.dead))} dead</small></div>}
          {selected.kind === "resource" ? <button className="world-dispatch" disabled={sentCount <= 0 || selected.state !== "available"} onClick={() => run("gather")}>HARVEST PLANET →</button> : selected.kind === "monster" ? <button className="world-dispatch danger" disabled={sentCount <= 0 || selected.state !== "alive" || rogueLocked} onClick={() => run("attack_monster")}>{rogueLocked ? `LOCKED · DEFEAT L${nextRogueLevel} FIRST` : `ENGAGE ROGUE · ${world.config.monsterEnergyCost} ENERGY →`}</button> : <button className="world-dispatch danger" disabled={sentCount <= 0 || cityShielded(selected, now, N)} onClick={() => run("attack_city")}>ATTACK CIVILIZATION →</button>}
        </>}
        <div className="world-marches"><div className="world-force-title"><b>FLEETS</b><span>{activeMarches.length}/{player.marchSlots}</span></div>{activeMarches.map((march) => <div className="world-march" key={march.id}><button className="world-march-focus" onClick={() => focusTarget(march.targetId)}><span>{march.action === "scout" ? "◎" : march.action === "gather" ? "◇" : "△"}</span><div><b>{localWorldTargetName(world, march.targetId)}</b><small>{march.state === "outbound" ? (march.action === "gather" ? "EN ROUTE TO HARVEST" : march.action === "scout" ? "SCOUT EN ROUTE" : "STRIKE EN ROUTE") : march.state === "gathering" ? "HARVESTING" : "RETURNING"} · <b>{fmtDuration(marchRemainingSec(march, now))}</b></small></div></button>{["outbound", "gathering"].includes(march.state) && <button className="world-recall" onClick={() => recall(march.id)}>RECALL</button>}</div>)}{!activeMarches.length && <div className="world-no-force">IDLE</div>}</div>
        {!!bookmarkedTargets.length && <div className="world-bookmarks"><div className="world-force-title"><b>SAVED</b><span>{bookmarkedTargets.length}</span></div>{bookmarkedTargets.map((target) => <button key={target.id} onClick={() => focusTarget(target.id)}><span style={{ color: entityColor(target) }}>{KIND_META[target.kind].icon}</span><b>{localWorldTargetName(world, target.id)}</b><small>{Math.round(target.position.x).toString().padStart(3, "0")}:{Math.round(target.position.y).toString().padStart(3, "0")}</small></button>)}</div>}
        {!!latestReports.length && <div className="world-reports"><div className="world-force-title"><b>REPORTS</b></div>{latestReports.map((report) => { const copy = reportCopy(report, world, now); return <button onClick={() => focusTarget(report.targetId)} className={`world-report ${copy.good ? "good" : "bad"}`} key={report.id}><b>{copy.title}</b><span>{copy.detail}</span></button>; })}</div>}
      </aside>
    </div>
    <MiniComms address={address} profile={profile} onOpenMessages={onMessages} />
  </section>;
}

function MarchLine({ march, now, zoom, signature }: { march: HeadlessMarch; now: number; zoom: number; signature: MarchSignatureId }) {
  const progress = marchMapProgress(march, now); const x = march.origin.x + (march.destination.x - march.origin.x) * progress; const y = march.origin.y + (march.destination.y - march.origin.y) * progress;
  const heading = march.state === "returning"
    ? Math.atan2(march.origin.y - march.destination.y, march.origin.x - march.destination.x)
    : Math.atan2(march.destination.y - march.origin.y, march.destination.x - march.origin.x);
  const cursorDeg = heading * 180 / Math.PI + 90; // Cursor geometry points north before rotation.
  const eta = fmtDuration(marchRemainingSec(march, now));
  const detailed = zoom >= 1.45;
  // Fleet signatures stay screen-sized. Tactical inspection gets enough room
  // for braids, sails and particle tails to read as distinct cosmetics.
  const cursorScale = zoom >= 3 ? 1.72 : detailed ? 1.45 : 1;
  const phase = progress < 0.045 ? "departing" : progress > 0.955 ? "arriving" : "cruising";
  return <g className={`world-march-line ${march.action} state-${march.state} signature-${signature} signature-${detailed ? "field" : "strategic"} ${phase}`}>
    <line x1={march.origin.x} y1={march.origin.y} x2={march.destination.x} y2={march.destination.y} />
    <g transform={`translate(${x} ${y}) scale(${cursorScale / zoom}) translate(${-x} ${-y})`}>
      <circle cx={x} cy={y} r="8.4" className="world-march-pulse" />
      <g className="world-march-cursor" transform={`rotate(${cursorDeg} ${x} ${y})`}>
        {detailed ? <MarchSignatureFx x={x} y={y} signature={signature} /> : <FleetKite x={x} y={y} />}
      </g>
      <text x={x} y={y - 11.5} className="world-march-eta">{eta}</text>
    </g>
  </g>;
}

function FleetKite({ x, y }: { x: number; y: number }) {
  return <g className="world-march-hull">
    <path d={`M ${x} ${y - 8.5} L ${x + 5.8} ${y + 1} L ${x} ${y + 5.7} L ${x - 5.8} ${y + 1} Z`} />
    <path d={`M ${x} ${y - 4.9} L ${x + 2.2} ${y + 0.5} L ${x} ${y + 2.4} L ${x - 2.2} ${y + 0.5} Z`} className="world-march-cursor-core" />
    <circle cx={x} cy={y - 1.2} r="1.05" className="world-march-hull-light" />
  </g>;
}

function MarchSignatureFx({ x, y, signature }: { x: number; y: number; signature: MarchSignatureId }) {
  if (signature === "ion-wake") return <g className="world-march-signature world-signature-ion">
    <path className="ion-trail ion-trail-a" d={`M ${x} ${y + 3} Q ${x - 1.5} ${y + 10} ${x - 3.8} ${y + 20}`} />
    <path className="ion-trail ion-trail-b" d={`M ${x + 1.2} ${y + 3} Q ${x + 3} ${y + 9} ${x + 2.4} ${y + 15}`} />
    <circle className="signature-mote mote-one" cx={x - 3.5} cy={y + 12} r="1.2" />
    <circle className="signature-mote mote-two" cx={x + 2.8} cy={y + 18} r="0.75" />
    <FleetKite x={x} y={y} />
  </g>;

  if (signature === "warp-thread") return <g className="world-march-signature world-signature-warp">
    <path className="warp-rail rail-left" d={`M ${x - 1.5} ${y + 2} Q ${x - 6.5} ${y + 12} ${x - 3.2} ${y + 22}`} />
    <path className="warp-rail rail-right" d={`M ${x + 1.5} ${y + 2} Q ${x + 6.5} ${y + 12} ${x + 3.2} ${y + 22}`} />
    <path className="warp-braid braid-violet" d={`M ${x} ${y + 2} C ${x - 6} ${y + 7}, ${x + 6} ${y + 11}, ${x} ${y + 15} S ${x - 4} ${y + 20}, ${x} ${y + 23}`} />
    <path className="warp-braid braid-cyan" d={`M ${x} ${y + 2} C ${x + 6} ${y + 7}, ${x - 6} ${y + 11}, ${x} ${y + 15} S ${x + 4} ${y + 20}, ${x} ${y + 23}`} />
    <path className="warp-fold fold-one" d={`M ${x - 4} ${y - 5} Q ${x} ${y - 10} ${x + 4} ${y - 5}`} />
    <path className="warp-fold fold-two" d={`M ${x - 6} ${y - 7} Q ${x} ${y - 14} ${x + 6} ${y - 7}`} />
    <path className="warp-fold fold-three" d={`M ${x - 8} ${y - 9} Q ${x} ${y - 18} ${x + 8} ${y - 9}`} />
    <circle className="warp-ring ring-one" cx={x} cy={y} r="5" />
    <circle className="warp-ring ring-two" cx={x} cy={y} r="8" />
    <circle className="warp-lens warp-lens-cyan" cx={x - 1} cy={y} r="2.6" />
    <circle className="warp-lens warp-lens-violet" cx={x + 1} cy={y} r="2.6" />
    <circle className="warp-core" cx={x} cy={y} r="1.8" />
  </g>;

  if (signature === "aurora-sail") return <g className="world-march-signature world-signature-aurora">
    <path className="aurora-glow" d={`M ${x} ${y + 2} C ${x - 11} ${y + 7}, ${x + 10} ${y + 12}, ${x - 5} ${y + 18} C ${x + 5} ${y + 20}, ${x - 9} ${y + 24}, ${x} ${y + 27} C ${x + 6} ${y + 22}, ${x + 13} ${y + 18}, ${x + 5} ${y + 14} C ${x + 12} ${y + 9}, ${x + 5} ${y + 5}, ${x} ${y + 2} Z`} />
    <path className="aurora-ribbon" d={`M ${x} ${y + 2} C ${x - 7} ${y + 8}, ${x + 8} ${y + 11}, ${x - 3} ${y + 17} S ${x + 7} ${y + 23}, ${x} ${y + 27} C ${x + 3} ${y + 21}, ${x - 4} ${y + 18}, ${x + 3} ${y + 14} S ${x + 4} ${y + 7}, ${x} ${y + 2} Z`} />
    <path className="aurora-shimmer" d={`M ${x} ${y + 2} C ${x - 5} ${y + 7}, ${x + 6} ${y + 12}, ${x - 2} ${y + 17} S ${x + 5} ${y + 23}, ${x} ${y + 27}`} />
    <FleetKite x={x} y={y} />
  </g>;

  return <g className="world-march-signature world-signature-comet">
    <circle className="comet-tail tail-four" cx={x} cy={y + 21} r="1.4" />
    <circle className="comet-tail tail-three" cx={x - 1.2} cy={y + 16} r="2.1" />
    <circle className="comet-tail tail-two" cx={x + 0.8} cy={y + 11} r="2.8" />
    <circle className="comet-tail tail-one" cx={x} cy={y + 6} r="3.8" />
    <circle className="comet-ember ember-one" cx={x - 4.5} cy={y + 11} r="0.9" />
    <circle className="comet-ember ember-two" cx={x + 4} cy={y + 17} r="0.7" />
    <circle className="comet-head-glow" cx={x} cy={y} r="8.5" />
    <circle className="comet-head" cx={x} cy={y} r="3.2" />
    <circle className="comet-core" cx={x} cy={y} r="1.45" />
  </g>;
}
