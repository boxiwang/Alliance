// Local end-to-end check of the server GM tools (skipped unless E2E_URL and E2E_AUTH_SECRET
// are set; the secret is the one `wrangler dev` runs with, used to mint a GM session):
//   E2E_URL=http://127.0.0.1:8799 E2E_AUTH_SECRET=<secret> npx vitest run src/lib/gm-commands.e2e.test.ts
import { describe, expect, it } from "vitest";
import { issueSession } from "../../worker/auth";
import { capacity } from "./game";
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

describe.runIf(process.env.E2E_URL && process.env.E2E_AUTH_SECRET)("server GM tools (local wrangler dev)", () => {
  it("refuses gm.* for a player and applies them for a GM on their own account", async () => {
    const playerId = `0x${hex(40)}`;
    const { data: auth } = await call("/auth/guest", null, { method: "POST", body: JSON.stringify({ guestId: `guest:${hex(24)}`, playerId }) });
    const token = auth.token as string;
    const n: any = structuredClone(getN());
    n.world.population.localNpcCities = 0;
    const local = createLocalWorldSession(auth.player.id, initGame(auth.player.id), Date.now(), n);
    const me = await call("/game", token);
    expect((await call("/game/authority/enable", token, { method: "POST", body: JSON.stringify({ game: local.game, world: local.session, revision: me.data.revision ?? 0 }) })).status).toBe(200);

    const refused = await command(token, "gm.fill_resources");
    expect(refused.data.ok).toBe(false);
    expect(refused.data.reason).toBe("gm_required");

    const gm = await issueSession(process.env.E2E_AUTH_SECRET!, { sub: auth.player.id, method: "guest", role: "gm" } as any, 600);
    const filled = await command(gm, "gm.fill_resources");
    expect(filled.data.ok).toBe(true);
    expect(filled.data.game.res.cash).toBe(capacity(filled.data.game));

    const raised = await command(gm, "gm.raise_townhall");
    expect(raised.data.ok).toBe(true);
    expect(raised.data.game.buildings.keep.lvl).toBe(2);

    const building = await command(gm, "gm.raise_building", { building: "academy" });
    expect(building.data.game.buildings.academy.lvl).toBeGreaterThanOrEqual(1);
    expect((await command(gm, "gm.nope")).data.reason).toBe("Unknown GM command");
  }, 60_000);

  it("turns a permanent shield on and off for the GM's own city", async () => {
    const playerId = `0x${hex(40)}`;
    const { data: auth } = await call("/auth/guest", null, { method: "POST", body: JSON.stringify({ guestId: `guest:${hex(24)}`, playerId }) });
    // Join the room once so the city is on the roster.
    const ws = new (WebSocket as any)(`${URL_BASE.replace(/^http/, "ws")}/ws?token=${encodeURIComponent(auth.token)}`, { headers: { origin: "http://localhost:5173" } }) as WebSocket;
    await new Promise((resolve) => { ws.onopen = resolve; });
    await new Promise((resolve) => setTimeout(resolve, 400));
    const gm = await issueSession(process.env.E2E_AUTH_SECRET!, { sub: auth.player.id, method: "guest", role: "gm" } as any, 600);
    const shield = (mode: "on" | "off") => call("/gm/world/shield", gm, { method: "POST", body: JSON.stringify({ ids: [auth.player.id], mode }) });
    const rosterShield = async () => ((await call("/gm/world/roster", gm)).data.players.find((p: any) => p.id === auth.player.id)?.shieldUntil ?? -1) as number;

    expect((await shield("on")).data.granted[0].shieldUntil).toBeGreaterThan(Date.now() + 50 * 365 * 86_400_000);
    expect(await rosterShield()).toBeGreaterThan(Date.now() + 50 * 365 * 86_400_000);
    expect((await shield("off")).data.granted[0].shieldUntil).toBe(0);
    expect(await rosterShield()).toBe(0);
    ws.close();
  }, 60_000);
});
