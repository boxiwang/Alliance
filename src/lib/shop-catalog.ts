import { MVP_ITEM_BY_ID, type MvpItem } from "./mvp-items";

export type ShopCategory = "daily" | "speedups" | "cosmetics";

export type ShopOffer = {
  id: string;
  category: ShopCategory;
  name: string;
  description: string;
  price: number;
  itemId?: string;
  quantity: number;
  status: "active" | "planned";
  tag?: string;
};

const speedupOffer = (itemId: string, price: number, quantity = 1): ShopOffer => {
  const item = MVP_ITEM_BY_ID.get(itemId);
  if (!item) throw new Error(`Unknown shop item ${itemId}`);
  return {
    id: `offer.${itemId}`,
    category: "speedups",
    name: item.name.replace(/ Speedup$/, ""),
    description: item.description,
    price,
    itemId,
    quantity,
    status: "active",
  };
};

/**
 * Server-authoritative alpha catalog. Only inventory whose gameplay effect is
 * implemented may be active. Planned cards are intentionally non-purchasable.
 */
export const SHOP_OFFERS: readonly ShopOffer[] = [
  speedupOffer("speedup.universal.5m", 8),
  speedupOffer("speedup.universal.1h", 72),
  speedupOffer("speedup.universal.3h", 190),
  speedupOffer("speedup.universal.8h", 460),
  speedupOffer("speedup.universal.24h", 1_250),
  speedupOffer("speedup.construction.1h", 58),
  speedupOffer("speedup.research.1h", 58),
  speedupOffer("speedup.training.1h", 58),
  speedupOffer("speedup.healing.1h", 58),
  {
    id: "planned.production.24h", category: "daily", name: "Production Surge", quantity: 1,
    description: "+25% Cash, Oil and Power production for 24 hours.", price: 150, status: "planned",
  },
  {
    id: "planned.shield.8h", category: "daily", name: "Peace Shield · 8H", quantity: 1,
    description: "Keeps hostile fleets away until it expires or you attack.", price: 200, status: "planned",
  },
  {
    id: "planned.cosmetic.core", category: "cosmetics", name: "Core Relics", quantity: 1,
    description: "New civilization cores will rotate through the Relic Vault.", price: 0, status: "planned", tag: "VAULT",
  },
  {
    id: "planned.cosmetic.march", category: "cosmetics", name: "Fleet Signatures", quantity: 1,
    description: "March and strike signatures will arrive as named releases.", price: 0, status: "planned", tag: "VAULT",
  },
] as const;

export const SHOP_OFFER_BY_ID = new Map(SHOP_OFFERS.map((offer) => [offer.id, offer]));

export const DAILY_SUPPLY: Readonly<Record<string, number>> = {
  "speedup.universal.5m": 2,
};

export const TOPUP_PACKS = [
  { id: "credits.80", usdCents: 99, credits: 80 },
  { id: "credits.450", usdCents: 499, credits: 450 },
  { id: "credits.1000", usdCents: 999, credits: 1_000 },
  { id: "credits.2200", usdCents: 1_999, credits: 2_200 },
  { id: "credits.6000", usdCents: 4_999, credits: 6_000 },
  { id: "credits.13000", usdCents: 9_999, credits: 13_000 },
] as const;

export const TOPUP_PACK_BY_ID = new Map(TOPUP_PACKS.map((pack) => [pack.id, pack]));

export function shopItem(offer: ShopOffer): MvpItem | null {
  return offer.itemId ? MVP_ITEM_BY_ID.get(offer.itemId) || null : null;
}
