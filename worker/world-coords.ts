export type WorldCoord = { x: number; y: number };

const WORLD_SIZE = 512;
const CENTER = WORLD_SIZE / 2;
const PLAYABLE_RADIUS = WORLD_SIZE / 2 - 3;
const OUTER_SPAWN_RADIUS = PLAYABLE_RADIUS * 0.9;
const CENTRAL_RESERVE_RADIUS = 70;
const MIN_RADIUS = CENTRAL_RESERVE_RADIUS + 12;
const RING_STEP = 10.5;
const MIN_ARC_SPACING = 13;

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
export function assignOuterRingCoord(taken: WorldCoord[], rand: () => number = Math.random): WorldCoord {
  const occupied = new Set(taken.map((coord) => `${coord.x},${coord.y}`));
  const free = SLOTS.filter((coord) => !occupied.has(`${coord.x},${coord.y}`));
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
