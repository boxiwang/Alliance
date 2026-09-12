import type { Point, WorldReport } from "./world-engine";
import { scoutReportExpiresAt } from "./world-engine";

export type SharedTargetKind = "city" | "resource" | "monster";

interface SharedTarget {
  id: string;
  targetId: string;
  targetName: string;
  targetLevel: number;
  targetKind: SharedTargetKind;
  position: Point;
  createdAt: number;
}

export interface SharedCoordinate extends SharedTarget {
  kind: "coordinate";
}

export interface SharedScoutIntel extends SharedTarget {
  kind: "scout-intel";
  reportId: string;
  expiresAt: number;
  snapshot: Record<string, unknown>;
}

export type SharedWorldIntel = SharedCoordinate | SharedScoutIntel;

export interface PendingWorldFocus {
  targetId: string | null;
  position: Point;
  requestedAt: number;
}

const shareKey = (address: string) => `ruglands:comms-share:${address.toLowerCase()}`;
const focusKey = (address: string) => `ruglands:world-focus:${address.toLowerCase()}`;

function validPoint(value: unknown): value is Point {
  const point = value as Point | null;
  return !!point && Number.isFinite(point.x) && Number.isFinite(point.y);
}

function readJson(key: string): unknown {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function writeJson(key: string, value: unknown): void {
  try { localStorage.setItem(key, JSON.stringify(value)); } catch {}
}

function targetKind(value: unknown): SharedTargetKind {
  return value === "resource" || value === "monster" ? value : "city";
}

export function createCoordinateShare(target: { id: string; name: string; level: number; kind?: SharedTargetKind; position: Point }, createdAt = Date.now()): SharedCoordinate {
  return {
    kind: "coordinate",
    id: `coordinate:${target.id}:${createdAt}`,
    targetId: target.id,
    targetName: target.name,
    targetLevel: target.level,
    targetKind: targetKind(target.kind),
    position: { ...target.position },
    createdAt,
  };
}

export function createScoutIntelShare(
  target: { id: string; name: string; level: number; kind?: SharedTargetKind; position: Point },
  report: WorldReport,
  fallbackTtlMs?: number,
): SharedScoutIntel {
  return {
    kind: "scout-intel",
    id: `scout-intel:${report.id}`,
    targetId: target.id,
    targetName: target.name,
    targetLevel: target.level,
    targetKind: "city",
    position: { ...target.position },
    createdAt: report.createdAt,
    reportId: report.id,
    expiresAt: scoutReportExpiresAt(report, fallbackTtlMs),
    snapshot: (report.payload.snapshot ?? {}) as Record<string, unknown>,
  };
}

export function sharedIntelIsActive(share: SharedWorldIntel, now = Date.now()): boolean {
  return share.kind === "coordinate" || now < share.expiresAt;
}

export function queueCommsShare(address: string, share: SharedWorldIntel): void {
  writeJson(shareKey(address), share);
}

export function loadQueuedCommsShare(address: string): SharedWorldIntel | null {
  const value = readJson(shareKey(address)) as Partial<SharedWorldIntel> | null;
  if (!value || !validPoint(value.position) || typeof value.targetId !== "string" || typeof value.targetName !== "string") return null;
  if (value.kind === "coordinate" && typeof value.id === "string" && Number.isFinite(value.createdAt)) {
    return { ...value, targetKind: targetKind(value.targetKind) } as SharedCoordinate;
  }
  if (value.kind === "scout-intel" && typeof value.id === "string" && typeof value.reportId === "string"
    && Number.isFinite(value.createdAt) && Number.isFinite(value.expiresAt) && value.snapshot && typeof value.snapshot === "object") {
    return { ...value, targetKind: "city" } as SharedScoutIntel;
  }
  return null;
}

export function clearQueuedCommsShare(address: string): void {
  try { localStorage.removeItem(shareKey(address)); } catch {}
}

export function queueWorldFocus(address: string, targetId: string | null, position: Point, requestedAt = Date.now()): void {
  writeJson(focusKey(address), { targetId, position, requestedAt });
}

export function takeWorldFocus(address: string): PendingWorldFocus | null {
  const key = focusKey(address);
  const value = readJson(key) as Partial<PendingWorldFocus> | null;
  try { localStorage.removeItem(key); } catch {}
  if (!value || !validPoint(value.position) || (value.targetId !== null && typeof value.targetId !== "string") || !Number.isFinite(value.requestedAt)) return null;
  return value as PendingWorldFocus;
}
