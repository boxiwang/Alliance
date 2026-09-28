export type WorldCoord = { x: number; y: number };

// Map 2048 (docs/MAP-2048.md). Spacing grew with the map: alliances get room to settle.
const WORLD_SIZE = 2048;
const CENTER = WORLD_SIZE / 2;
const PLAYABLE_RADIUS = WORLD_SIZE / 2 - 3;
const OUTER_SPAWN_RADIUS = PLAYABLE_RADIUS * 0.9;
const CENTRAL_RESERVE_RADIUS = 280;
const MIN_RADIUS = CENTRAL_RESERVE_RADIUS + 48;
const RING_STEP = 16;
const MIN_ARC_SPACING = 20;

/** Quadrant of a coordinate: 0 NW, 1 NE, 2 SW, 3 SE (same rule as the World engine). */
export function quadrantOfCoord(coord: WorldCoord): number {
  return (coord.y < CENTER ? 0 : 2) + (coord.x < CENTER ? 0 : 1);
}

/** Opening order (clockwise from NW) and cities per quadrant before the next one opens. */
export const QUADRANT_ORDER = [0, 1, 3, 2];
export const QUADRANT_CAPACITY = 256;

/**
 * Where the next new player spawns: the first open quadrant (in order) below capacity; when
 * every open quadrant is full, the next unopened one opens. `opens` names a quadrant to open.
 */
export function spawnQuadrant(counts: number[], open: number[], capacity = QUADRANT_CAPACITY): { quadrant: number; opens: number | null } {
  for (const quadrant of QUADRANT_ORDER) if (open.includes(quadrant) && (counts[quadrant] || 0) < capacity) return { quadrant, opens: null };
  const next = QUADRANT_ORDER.find((quadrant) => !open.includes(quadrant));
  if (next !== undefined) return { quadrant: next, opens: next };
  const least = [...QUADRANT_ORDER].sort((a, b) => (counts[a] || 0) - (counts[b] || 0))[0];
  return { quadrant: least, opens: null };
}

function roundCoord(value: number): number {
  return Math.round(value * 100) / 100;
}

/**
 * Stable slot order for a frontier that grows from the rim inward. Each ring is
 * evenly spaced and rotated relative to its neighbours so radial lanes do not
 * stack. The capacity is intentionally above the 1,024-player State limit.
 */
export function outerRingSlots(): WorldCoord[] {
  const slots: WorldCoord[] = [];
  let ring = 0;
  for (let radius = OUTER_SPAWN_RADIUS; radius >= MIN_RADIUS; radius -= RING_STEP, ring += 1) {
    const count = Math.max(8, Math.floor((Math.PI * 2 * radius) / MIN_ARC_SPACING));
    const offset = (ring * 0.38196601125) % 1;
    for (let index = 0; index < count; index += 1) {
      const angle = Math.PI * 2 * (index / count + offset);
      slots.push({
        x: roundCoord(CENTER + Math.cos(angle) * radius),
        y: roundCoord(CENTER + Math.sin(angle) * radius),
      });
    }
  }
  return slots;
}

const SLOTS = outerRingSlots();

const radiusOf = (coord: WorldCoord): number => Math.hypot(coord.x - CENTER, coord.y - CENTER);

/**
 * Assign a spawn on the outer ring at a RANDOM angle — not by join order — so a
 * player's location can't be inferred from when they joined (owner rule). Still
 * outer-first: pick randomly among the free slots on the current outermost ring
 * that has space, and only step inward once a ring fills. Coords stay stable
 * because the DO persists each player's assigned slot.
 */
export function assignOuterRingCoord(taken: WorldCoord[], rand: () => number = Math.random, quadrant?: number): WorldCoord {
  const occupied = new Set(taken.map((coord) => `${coord.x},${coord.y}`));
  const free = SLOTS.filter((coord) => !occupied.has(`${coord.x},${coord.y}`) && (quadrant === undefined || quadrantOfCoord(coord) === quadrant));
  if (!free.length) return SLOTS[taken.length % SLOTS.length];
  // SLOTS are ordered outermost-ring first, so free[0] is on the current
  // outermost ring with space; take that whole ring and pick a random slot.
  const outerRadius = radiusOf(free[0]);
  const ring = free.filter((coord) => radiusOf(coord) >= outerRadius - RING_STEP * 0.5);
  return ring[Math.floor(rand() * ring.length)] || free[0];
}

export const WORLD_COORD_LIMITS = {
  center: CENTER,
  reserveRadius: CENTRAL_RESERVE_RADIUS,
  outerSpawnRadius: OUTER_SPAWN_RADIUS,
  slotCount: SLOTS.length,
} as const;

// Map cleanup (docs/BETA-P0.md P0-3): small cities abandoned for two weeks leave the
// map. Only the map slot is released — the account and progress stay in D1.
export const DORMANT_MAX_CORE = 5;
export const DORMANT_AFTER_MS = 14 * 24 * 60 * 60 * 1000;

/** Players whose map slot may be released (offline, stale, small by presence Core level). */
export function dormantCandidates<T extends { id: string; lastSeen?: number; keepLevel?: number }>(players: T[], live: Set<string>, now: number): T[] {
  return players.filter((player) => !live.has(player.id)
    && now - (player.lastSeen || 0) >= DORMANT_AFTER_MS && (player.keepLevel || 1) <= DORMANT_MAX_CORE);
}

// Location privacy (docs/BETA-P0.md P0-4): a client may only ask for the cities in
// one map view at a time — a Field-zoom viewport plus margin, in tiles.
export type ViewRect = { x0: number; y0: number; x1: number; y1: number };
export const VIEW_MAX_SPAN = 420;

export function clampViewRect(raw: unknown): ViewRect | null {
  const r = raw as Partial<ViewRect> | null;
  const values = [r?.x0, r?.y0, r?.x1, r?.y1].map(Number);
  if (!r || values.some((value) => !Number.isFinite(value))) return null;
  let [x0, y0, x1, y1] = values;
  if (x1 < x0) [x0, x1] = [x1, x0];
  if (y1 < y0) [y0, y1] = [y1, y0];
  const shrink = (lo: number, hi: number): [number, number] => {
    if (hi - lo <= VIEW_MAX_SPAN) return [lo, hi];
    const mid = (lo + hi) / 2;
    return [mid - VIEW_MAX_SPAN / 2, mid + VIEW_MAX_SPAN / 2];
  };
  [x0, x1] = shrink(x0, x1); [y0, y1] = shrink(y0, y1);
  return { x0, y0, x1, y1 };
}
