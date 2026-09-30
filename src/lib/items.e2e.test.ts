// Local end-to-end check of Warehouse items (skipped unless E2E_URL and E2E_AUTH_SECRET are
// set; the secret is the one `wrangler dev` runs with, used to mint a GM session that stocks
// the test account). See shared-world.e2e.test.ts for starting `wrangler dev`.
import { describe, expect, it } from "vitest";
import { issueSession } from "../../worker/auth";
import { initGame } from "./gamestore";
import { MVP_ITEMS, UNLIMITED_ITEM_QUANTITY } from "./mvp-items";
import { getN } from "./numbers";
import { createLocalWorldSession } from "./world-adapter";

const URL_BASE = process.env.E2E_URL || "http://127.0.0.1:8799";
const hex = (n: number) => Array.from({ length: n }, () => Math.floor(Math.random() * 16).toString(16)).join("");

async function call(path: string, token: string | null, init: RequestInit = {}) {
  const res = await fetch(URL_BASE + path, { ...init, headers: { "content-type": "application/json", origin: "http://localhost:5173", ...(token ? { authorization: `Bearer ${token}` } : {}), ...(init.headers || {}) } });
  return { status: res.status, data: await res.json().catch(() => ({})) as any };
}
const command = (token: string, type: string, args: Record<string, unknown> = {}) =>
  call("/command", token, { method: "POST", body: JSON.stringify({ type, args, idempotencyKey: `e2e:${hex(16)}` }) });

describe.runIf(process.env.E2E_URL && process.env.E2E_AUTH_SECRET)("Warehouse items (local wrangler dev)", () => {
  it("resource crates, chests, Stamina, shields and March Boosts all apply and debit", async () => {
    const playerId = `0x${hex(40)}`;
    const { data: auth } = await call("/auth/guest", null, { method: "POST", body: JSON.stringify({ guestId: `guest:${hex(24)}`, playerId }) });
    const token = auth.token as string;
    const id = auth.player.id as string;
    const n: any = structuredClone(getN());
    n.world.population.localNpcCities = 0;
    const local = createLocalWorldSession(id, initGame(id), Date.now(), n);
    const me = await call("/game", token);
    await call("/game/authority/enable", token, { method: "POST", body: JSON.stringify({ game: local.game, world: local.session, revision: me.data.revision ?? 0 }) });
    await call("/game", token); // cutover into the shared world
    const ws = new (WebSocket as any)(`${URL_BASE.replace(/^http/, "ws")}/ws?token=${encodeURIComponent(token)}`, { headers: { origin: "http://localhost:5173" } }) as WebSocket;
    await new Promise((resolve) => { ws.onopen = resolve; });
    await new Promise((resolve) => setTimeout(resolve, 400));
    const gm = await issueSession(process.env.E2E_AUTH_SECRET!, { sub: id, method: "guest", role: "gm" } as any, 600);
    expect((await call("/inventory/grant-alpha", gm, { method: "POST", body: JSON.stringify({ idempotencyKey: `e2e:${hex(8)}` }) })).status).toBe(200);
    const owned = async (itemId: string) => ((await call("/inventory", token)).data.inventory || []).find((entry: any) => entry.itemId === itemId)?.quantity ?? 0;

    // Resource crate: 2 x 1M Cash crate -> +2,000 internal Cash, 2 debited.
    const cashBefore = (await call("/game", token)).data.game.res.cash as number;
    const crate = await command(token, "item.use", { itemId: "resource.cash.small", quantity: 2 });
    expect(crate.data.reason ?? "ok").toBe("ok");
    expect(crate.data.game.res.cash - cashBefore).toBeGreaterThanOrEqual(2_000);
    expect(await owned("resource.cash.small")).toBe(97);

    // Chest: 2 chests -> 2 debited, loot lands in the inventory.
    const chest = await command(token, "item.use", { itemId: "chest.supply", quantity: 2 });
    expect(chest.data.reason ?? "ok").toBe("ok");
    expect(await owned("chest.supply")).toBe(97);
    const [lootId, lootQty] = Object.entries(chest.data.loot as Record<string, number>)[0];
    expect(await owned(lootId)).toBeGreaterThanOrEqual(99 + lootQty - (lootId === "resource.cash.small" ? 2 : 0));

    // Stamina Pack: can go above the cap.
    const stamina = await command(token, "item.use", { itemId: "energy.cell.50", quantity: 2 });
    expect(stamina.data.reason ?? "ok").toBe("ok");
    expect(stamina.data.effect.stamina).toBeGreaterThan(100);

    // Shield: public roster expiry ~24h ahead.
    const shield = await command(token, "item.use", { itemId: "war.shield.24h", quantity: 1 });
    expect(shield.data.reason ?? "ok").toBe("ok");
    expect(shield.data.effect.shieldUntil).toBeGreaterThan(Date.now() + 23 * 3_600_000);

    // March Boost: 2 x 1h stacks to ~2h.
    const boost = await command(token, "item.use", { itemId: "boost.march.1h", quantity: 2 });
    expect(boost.data.reason ?? "ok").toBe("ok");
    expect(boost.data.effect.marchBoostUntil).toBeGreaterThan(Date.now() + 119 * 60_000);

    // Warp and rename items are spent on their own screens.
    expect((await command(token, "item.use", { itemId: "identity.rename" })).data.reason).toBe("use_elsewhere");
    ws.close();
  }, 60_000);

  it("the first rename is free; later renames need a Rename Signal, which is spent", async () => {
    const playerId = `0x${hex(40)}`;
    const { data: auth } = await call("/auth/guest", null, { method: "POST", body: JSON.stringify({ guestId: `guest:${hex(24)}`, playerId }) });
    const token = auth.token as string;
    const gm = await issueSession(process.env.E2E_AUTH_SECRET!, { sub: auth.player.id, method: "guest", role: "gm" } as any, 600);
    await call("/inventory/grant-alpha", gm, { method: "POST", body: JSON.stringify({ idempotencyKey: `e2e:${hex(8)}` }) });
    const rename = (name: string, useItem = false) => call("/profile/name", token, { method: "POST", body: JSON.stringify({ name, useItem }) });
    expect((await rename(`first${hex(6)}`)).status).toBe(200);
    const refused = await rename(`second${hex(6)}`);
    expect(refused.status).toBe(409);
    expect(refused.data.error).toBe("rename_signal_required");
    const signal = await rename(`third${hex(6)}`, true);
    expect(signal.status).toBe(200);
    const inventory = (await call("/inventory", token)).data.inventory as any[];
    expect(inventory.find((entry) => entry.itemId === "identity.rename")?.quantity).toBe(98);
  }, 60_000);
  it("GM accounts hold every item without limit and are never debited", async () => {
    const playerId = `0x${hex(40)}`;
    const { data: auth } = await call("/auth/guest", null, { method: "POST", body: JSON.stringify({ guestId: `guest:${hex(24)}`, playerId }) });
    const player = await call("/game", auth.token);
    const gm = await issueSession(process.env.E2E_AUTH_SECRET!, { sub: auth.player.id, method: "guest", role: "gm" } as any, 600);
    const n: any = structuredClone(getN());
    n.world.population.localNpcCities = 0;
    const local = createLocalWorldSession(auth.player.id, initGame(auth.player.id), Date.now(), n);
    await call("/game/authority/enable", gm, { method: "POST", body: JSON.stringify({ game: local.game, world: local.session, revision: player.data.revision ?? 0 }) });
    const inventory = (await call("/inventory", gm)).data.inventory as any[];
    expect(inventory.find((entry) => entry.itemId === "chest.supply")?.quantity).toBe(UNLIMITED_ITEM_QUANTITY);
    expect(inventory.length).toBe(MVP_ITEMS.filter((item) => item.status === "active").length);
    const crate = await command(gm, "item.use", { itemId: "resource.oil.large", quantity: 5 });
    expect(crate.data.reason ?? "ok").toBe("ok");
    expect(crate.data.inventory.quantity).toBe(UNLIMITED_ITEM_QUANTITY);
    expect(((await call("/inventory", gm)).data.inventory as any[]).find((entry) => entry.itemId === "resource.oil.large")?.quantity).toBe(UNLIMITED_ITEM_QUANTITY);
  }, 60_000);
});
