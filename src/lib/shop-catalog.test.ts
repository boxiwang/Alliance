import { describe, expect, it } from "vitest";
import { MVP_ITEM_BY_ID } from "./mvp-items";
import { DAILY_SUPPLY, SHOP_OFFERS, TOPUP_PACKS } from "./shop-catalog";

describe("shop catalog", () => {
  it("only sells items with active gameplay effects", () => {
    const active = SHOP_OFFERS.filter((offer) => offer.status === "active");
    expect(active.length).toBeGreaterThan(0);
    for (const offer of active) {
      const item = offer.itemId ? MVP_ITEM_BY_ID.get(offer.itemId) : null;
      expect(item?.status).toBe("active");
      expect(offer.price).toBeGreaterThan(0);
      expect(offer.quantity).toBeGreaterThan(0);
    }
  });

  it("keeps offer and pack identifiers unique", () => {
    expect(new Set(SHOP_OFFERS.map((offer) => offer.id)).size).toBe(SHOP_OFFERS.length);
    expect(new Set(TOPUP_PACKS.map((pack) => pack.id)).size).toBe(TOPUP_PACKS.length);
  });

  it("only grants implemented inventory in the daily supply", () => {
    for (const [itemId, quantity] of Object.entries(DAILY_SUPPLY)) {
      expect(MVP_ITEM_BY_ID.get(itemId)?.status).toBe("active");
      expect(quantity).toBeGreaterThan(0);
    }
  });
});
