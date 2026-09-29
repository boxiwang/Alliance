// Local end-to-end check that one speedup order can use several items (skipped unless
// E2E_URL is set; see shared-world.e2e.test.ts for starting `wrangler dev`).
import { describe, expect, it } from "vitest";
import { initGame } from "./gamestore";
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

describe.runIf(process.env.E2E_URL)("speedup orders with a quantity (local wrangler dev)", () => {
  it("refuses more than owned, then uses N speedups in one command: debits N, removes N x duration", async () => {
    const playerId = `0x${hex(40)}`;
    const { data: auth } = await call("/auth/guest", null, { method: "POST", body: JSON.stringify({ guestId: `guest:${hex(24)}`, playerId }) });
    const token = auth.token as string;
    const g = initGame(playerId);
    g.res = { cash: 1e9, oil: 1e9, power: 1e9 };
    const n: any = structuredClone(getN());
    n.world.population.localNpcCities = 0;
    const local = createLocalWorldSession(playerId, g, Date.now(), n);
    const me = await call("/game", token);
    expect((await call("/game/authority/enable", token, { method: "POST", body: JSON.stringify({ game: local.game, world: local.session, revision: me.data.revision ?? 0 }) })).status).toBe(200);

    const owned = (inv: any) => (inv.inventory || []).find((entry: any) => entry.itemId === "speedup.construction.1m")?.quantity ?? 0;
    const before = owned((await call("/inventory", token)).data);
    expect(before).toBeGreaterThanOrEqual(3);

    const build = await command(token, "build.start", { building: "keep" });
    expect(build.data.reason ?? build.data.error ?? "ok").toBe("ok");
    const finishBefore = build.data.game.buildings.keep.finishAt as number;

    // More than owned is refused as a whole (nothing debited, no time removed).
    const tooMany = await command(token, "speedup.use", { itemId: "speedup.construction.1m", target: { kind: "construction", key: "keep" }, quantity: 999 });
    expect(tooMany.status).toBe(409);
    expect(owned((await call("/inventory", token)).data)).toBe(before);

    const use = await command(token, "speedup.use", { itemId: "speedup.construction.1m", target: { kind: "construction", key: "keep" }, quantity: 3 });
    expect(use.data.reason ?? use.data.error ?? "ok").toBe("ok");
    expect(use.data.inventory.quantity).toBe(before - 3);
    expect(finishBefore - use.data.game.buildings.keep.finishAt).toBeGreaterThanOrEqual(179_000);
    expect(owned((await call("/inventory", token)).data)).toBe(before - 3);
  }, 60_000);
});
