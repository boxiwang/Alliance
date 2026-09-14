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

export function assignOuterRingCoord(taken: WorldCoord[]): WorldCoord {
  const occupied = new Set(taken.map((coord) => `${coord.x},${coord.y}`));
  return SLOTS.find((coord) => !occupied.has(`${coord.x},${coord.y}`)) || SLOTS[taken.length % SLOTS.length];
}

export const WORLD_COORD_LIMITS = {
  center: CENTER,
  reserveRadius: CENTRAL_RESERVE_RADIUS,
  outerSpawnRadius: OUTER_SPAWN_RADIUS,
  slotCount: SLOTS.length,
} as const;
