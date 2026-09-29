import { describe, expect, it } from "vitest";
import { CHEST_TABLES, MVP_ITEM_BY_ID, MVP_ITEMS, rollChest, warehouseCategoryOf } from "./mvp-items";

describe("MVP item catalog (docs/ITEMS.md)", () => {
  it("every active item does something: a speedup or an effect", () => {
    for (const item of MVP_ITEMS.filter((entry) => entry.status === "active")) {
      expect(Boolean(item.speedupSeconds) || Boolean(item.effect), item.id).toBe(true);
    }
  });

  it("ids are unique and every active item has a Warehouse category", () => {
    expect(new Set(MVP_ITEMS.map((item) => item.id)).size).toBe(MVP_ITEMS.length);
    for (const item of MVP_ITEMS.filter((entry) => entry.status === "active")) expect(warehouseCategoryOf(item)).toBeTruthy();
  });

  it("chests only contain active items", () => {
    for (const table of Object.values(CHEST_TABLES)) {
      for (const entry of table.entries) expect(MVP_ITEM_BY_ID.get(entry.itemId)?.status, entry.itemId).toBe("active");
    }
  });

  it("opening N chests rolls N x rolls rewards", () => {
    let seed = 1;
    const random = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
    const loot = rollChest("supply", 4, random);
    const rolls = Object.entries(loot).reduce((sum, [itemId, quantity]) => {
      const entry = CHEST_TABLES.supply.entries.find((candidate) => candidate.itemId === itemId)!;
      return sum + quantity / entry.quantity;
    }, 0);
    expect(rolls).toBe(4 * CHEST_TABLES.supply.rolls);
  });
});
