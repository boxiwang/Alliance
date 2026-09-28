// Chunked persistence for the shared world (docs/MAP-2048.md). The WorldRoom writes only
// the chunks whose serialized content changed since the last save, so one command costs
// a few KB of writes instead of the whole world. Pure: no storage API here.
import { sharedClusters, type SharedCluster, type SharedWorldState } from "./shared-world";
import type { HeadlessWorld, WorldEntity } from "./world-engine";

/** Entity sectors are square blocks of this many tiles. */
export const STORE_SECTOR = 128;
const PLAYER_BUCKETS = 16;
export const STORE_PREFIX = "sw2:";

function bucketOf(id: string, buckets: number): number {
  let hash = 0;
  for (let index = 0; index < id.length; index += 1) hash = (hash * 31 + id.charCodeAt(index)) >>> 0;
  return hash % buckets;
}

const sectorKey = (entity: WorldEntity) => `${Math.floor(entity.position.x / STORE_SECTOR)}:${Math.floor(entity.position.y / STORE_SECTOR)}`;

function grouped<T>(record: Record<string, T>, keyOf: (id: string, value: T) => string): Map<string, Record<string, T>> {
  const groups = new Map<string, Record<string, T>>();
  for (const [id, value] of Object.entries(record)) {
    const key = keyOf(id, value);
    let group = groups.get(key);
    if (!group) groups.set(key, (group = {}));
    group[id] = value;
  }
  return groups;
}

/** Serialize the shared world into storage chunks (key → JSON string). */
export function sharedChunks(state: SharedWorldState): Map<string, string> {
  const { entities, players, marches, reports, scheduledEvents, feed, dispatchKeys, ...meta } = state.world;
  const chunks = new Map<string, string>();
  chunks.set(`${STORE_PREFIX}meta`, JSON.stringify({ version: state.version, world: meta }));
  for (const [key, group] of grouped(state.synced, (id) => String(bucketOf(id, PLAYER_BUCKETS)))) chunks.set(`${STORE_PREFIX}s:${key}`, JSON.stringify(group));
  for (const [key, group] of grouped(players, (id) => String(bucketOf(id, PLAYER_BUCKETS)))) chunks.set(`${STORE_PREFIX}p:${key}`, JSON.stringify(group));
  for (const [key, group] of grouped(marches, (_, march) => String(bucketOf(march.playerId, PLAYER_BUCKETS)))) chunks.set(`${STORE_PREFIX}m:${key}`, JSON.stringify(group));
  for (const [key, group] of grouped(reports, (_, report) => String(bucketOf(report.playerId, PLAYER_BUCKETS)))) chunks.set(`${STORE_PREFIX}r:${key}`, JSON.stringify(group));
  for (const [key, group] of grouped(entities, (_, entity) => sectorKey(entity))) chunks.set(`${STORE_PREFIX}e:${key}`, JSON.stringify(group));
  chunks.set(`${STORE_PREFIX}events`, JSON.stringify(scheduledEvents));
  // Derived, read-only: Strategic clusters, so a hibernated WorldRoom can answer without
  // loading the whole world. Never merged back by assembleShared.
  chunks.set(`${STORE_PREFIX}x:clusters`, JSON.stringify(sharedClusters(state)));
  chunks.set(`${STORE_PREFIX}feed`, JSON.stringify(feed));
  chunks.set(`${STORE_PREFIX}keys`, JSON.stringify(dispatchKeys));
  return chunks;
}

/** Rebuild the shared world from its chunks; null when there is no complete save. */
export function assembleShared(chunks: Map<string, string>): SharedWorldState | null {
  const metaRaw = chunks.get(`${STORE_PREFIX}meta`);
  if (!metaRaw) return null;
  const meta = JSON.parse(metaRaw) as { version: 1; world: Omit<HeadlessWorld, "entities" | "players" | "marches" | "reports" | "scheduledEvents" | "feed" | "dispatchKeys"> };
  const merge = (prefix: string) => {
    const out: Record<string, any> = {};
    for (const [key, value] of chunks) if (key.startsWith(`${STORE_PREFIX}${prefix}:`)) Object.assign(out, JSON.parse(value));
    return out;
  };
  const world = {
    ...meta.world,
    entities: merge("e"), players: merge("p"), marches: merge("m"), reports: merge("r"),
    scheduledEvents: JSON.parse(chunks.get(`${STORE_PREFIX}events`) || "[]"),
    feed: JSON.parse(chunks.get(`${STORE_PREFIX}feed`) || "[]"),
    dispatchKeys: JSON.parse(chunks.get(`${STORE_PREFIX}keys`) || "{}"),
  } as HeadlessWorld;
  return { version: meta.version, world, synced: merge("s") };
}

/** What to write and delete to move storage from `saved` to `next`. */
export function chunkDelta(saved: Map<string, string>, next: Map<string, string>): { put: Map<string, string>; remove: string[] } {
  const put = new Map<string, string>();
  for (const [key, value] of next) if (saved.get(key) !== value) put.set(key, value);
  const remove = [...saved.keys()].filter((key) => !next.has(key));
  return { put, remove };
}

/** Storage keys of the entity sectors a view rect touches. */
export function sectorKeysForRect(rect: { x0: number; y0: number; x1: number; y1: number }): string[] {
  const keys: string[] = [];
  for (let sy = Math.floor(rect.y0 / STORE_SECTOR); sy <= Math.floor(rect.y1 / STORE_SECTOR); sy += 1) {
    for (let sx = Math.floor(rect.x0 / STORE_SECTOR); sx <= Math.floor(rect.x1 / STORE_SECTOR); sx += 1) keys.push(`${STORE_PREFIX}e:${sx}:${sy}`);
  }
  return keys;
}

/** Public targets inside a rect, read from sector chunks only (no full world load). */
export function targetsFromSectorChunks(chunks: Iterable<string | undefined>, rect: { x0: number; y0: number; x1: number; y1: number }): WorldEntity[] {
  const out: WorldEntity[] = [];
  for (const raw of chunks) {
    if (!raw) continue;
    for (const entity of Object.values(JSON.parse(raw) as Record<string, WorldEntity>)) {
      if ((entity.kind === "resource" || entity.kind === "monster")
        && entity.position.x >= rect.x0 && entity.position.x <= rect.x1 && entity.position.y >= rect.y0 && entity.position.y <= rect.y1) out.push(entity);
    }
  }
  return out;
}

export function clustersFromChunk(raw: string | undefined): SharedCluster[] {
  return raw ? JSON.parse(raw) as SharedCluster[] : [];
}

