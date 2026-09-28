import { describe, expect, it } from "vitest";
import {
  distance, initHeadlessWorld, nearestWarpPoint, relocateCity, spawnPlayer, warpBlockReason, worldCenter,
  type CityEntity, type HeadlessWorld,
} from "./world-engine";

function cityOf(world: HeadlessWorld, playerId: string): CityEntity {
  return world.entities[world.players[playerId].cityId] as CityEntity;
}

function base() {
  let world = spawnPlayer(initHeadlessWorld("warp", 1000), { id: "mover" }, 1000);
  world = spawnPlayer(world, { id: "neighbour" }, 1000);
  return world;
}

describe("warp (city relocation)", () => {
  it("moves the city to a valid chosen coordinate and records it in the feed", () => {
    const world = base();
    const center = worldCenter(world.config);
    const target = { x: center.x + world.config.circleReserveRadius + 150, y: center.y };
    expect(warpBlockReason(world, "mover", target)).toBeNull();
    const result = relocateCity(world, "mover", { mode: "precision", target }, 2000);
    expect(result.error).toBeUndefined();
    expect(cityOf(result.world, "mover").position).toEqual(target);
    expect(result.world.feed[result.world.feed.length - 1]?.type).toBe("city_relocated");
    expect(cityOf(world, "mover").position).not.toEqual(target); // source untouched
  });

  it("rejects the Wormhole reserve, the rim and a spot next to another city", () => {
    const world = base();
    const center = worldCenter(world.config);
    expect(relocateCity(world, "mover", { mode: "precision", target: center }).error).toBe("reserve_zone");
    expect(relocateCity(world, "mover", { mode: "precision", target: { x: 0, y: 0 } }).error).toBe("outside_frontier");
    const other = cityOf(world, "neighbour").position;
    expect(relocateCity(world, "mover", { mode: "precision", target: { x: other.x + 2, y: other.y } }).error).toBe("too_close_city");
  });

  it("is blocked while a fleet is away", () => {
    const world = base();
    world.marches["m1"] = { id: "m1", playerId: "mover", state: "outbound" } as any;
    const center = worldCenter(world.config);
    expect(relocateCity(world, "mover", { mode: "precision", target: { x: center.x + world.config.circleReserveRadius + 150, y: center.y } }).error).toBe("fleets_away");
  });

  it("suggests the nearest tile a Precision Warp would accept", () => {
    const world = base();
    const other = cityOf(world, "neighbour").position;
    const blocked = { x: Math.floor(other.x) + 1.5, y: Math.floor(other.y) + .5 };
    expect(warpBlockReason(world, "mover", blocked)).toBe("too_close_city");
    const hint = nearestWarpPoint(world, "mover", blocked)!;
    expect(hint).not.toBeNull();
    expect(warpBlockReason(world, "mover", hint)).toBeNull();
    const reach = distance(hint, blocked);
    // No accepted tile centre is strictly closer than the suggestion.
    for (let dy = -12; dy <= 12; dy += 1) for (let dx = -12; dx <= 12; dx += 1) {
      const point = { x: blocked.x + dx, y: blocked.y + dy };
      if (distance(point, blocked) < reach - 1e-9) expect(warpBlockReason(world, "mover", point)).not.toBeNull();
    }
    // A valid tile suggests itself.
    const center = worldCenter(world.config);
    const open = { x: Math.floor(center.x + world.config.circleReserveRadius + 150) + .5, y: Math.floor(center.y) + .5 };
    expect(nearestWarpPoint(world, "mover", open)).toEqual(open);
  });

  it("Drift Jump lands on a valid tile away from other cities", () => {
    const world = base();
    let seed = 7;
    const random = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
    const result = relocateCity(world, "mover", { mode: "random" }, 2000, undefined, random);
    expect(result.error).toBeUndefined();
    const moved = cityOf(result.world, "mover").position;
    expect(distance(moved, cityOf(result.world, "neighbour").position)).toBeGreaterThanOrEqual(6);
    expect(warpBlockReason(result.world, "mover", moved)).toBeNull();
  });
});
