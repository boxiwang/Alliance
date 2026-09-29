// Local end-to-end check of the paid scout (skipped unless E2E_URL is set; see
// shared-world.e2e.test.ts for starting `wrangler dev`).
import { describe, expect, it } from "vitest";
import { initGame } from "./gamestore";
import { getN } from "./numbers";
import { createLocalWorldSession } from "./world-adapter";

const URL_BASE = process.env.E2E_URL || "http://127.0.0.1:8799";
const WS_BASE = URL_BASE.replace(/^http/, "ws");
const hex = (n: number) => Array.from({ length: n }, () => Math.floor(Math.random() * 16).toString(16)).join("");

async function call(path: string, token: string | null, init: RequestInit = {}) {
  const res = await fetch(URL_BASE + path, { ...init, headers: { "content-type": "application/json", origin: "http://localhost:5173", ...(token ? { authorization: `Bearer ${token}` } : {}), ...(init.headers || {}) } });
  return { status: res.status, data: await res.json().catch(() => ({})) as any };
}
const command = (token: string, type: string, args: Record<string, unknown> = {}) =>
  call("/command", token, { method: "POST", body: JSON.stringify({ type, args, idempotencyKey: `e2e:${hex(16)}` }) });

async function commander(oil: number) {
  const playerId = `0x${hex(40)}`;
  const { data: auth } = await call("/auth/guest", null, { method: "POST", body: JSON.stringify({ guestId: `guest:${hex(24)}`, playerId }) });
  const token = auth.token as string;
  const g = initGame(auth.player.id);
  g.res = { ...g.res, oil };
  const n: any = structuredClone(getN());
  n.world.population.localNpcCities = 0;
  const local = createLocalWorldSession(auth.player.id, g, Date.now(), n);
  const me = await call("/game", token);
  await call("/game/authority/enable", token, { method: "POST", body: JSON.stringify({ game: local.game, world: local.session, revision: me.data.revision ?? 0 }) });
  // Joining the room places the city on the shared map (roster row with coordinates).
  const inbox: any[] = [];
  const ws = new (WebSocket as any)(`${WS_BASE}/ws?token=${encodeURIComponent(token)}`, { headers: { origin: "http://localhost:5173" } }) as WebSocket;
  ws.onmessage = (event) => inbox.push(JSON.parse(String(event.data)));
  await new Promise((resolve) => { ws.onopen = resolve; });
  await new Promise((resolve) => setTimeout(resolve, 500));
  return { id: auth.player.id as string, token, ws, inbox };
}

describe.runIf(process.env.E2E_URL)("paid scout (local wrangler dev)", () => {
  it("debits Oil, launches one scout per target, and refuses when Oil is short", async () => {
    const target = await commander(1_000);
    const scout = await commander(50_000);
    const oilBefore = (await call("/game", scout.token)).data.game.res.oil as number;

    const sent = await command(scout.token, "world.scout_player", { target: target.id });
    expect(sent.data.reason ?? "ok").toBe("ok");
    const paid = oilBefore - sent.data.game.res.oil;
    expect(paid).toBeGreaterThanOrEqual(30);
    expect(paid).toBeLessThan(oilBefore);
    await new Promise((resolve) => setTimeout(resolve, 400));
    expect(scout.inbox.some((msg) => msg.type === "march" && msg.march.kind === "scout" && msg.march.defender === target.id && msg.march.cost === paid)).toBe(true);

    const again = await command(scout.token, "world.scout_player", { target: target.id });
    expect(again.data.reason).toBe("scout_en_route");
    expect((await call("/game", scout.token)).data.game.res.oil).toBe(sent.data.game.res.oil);

    const poor = await commander(0);
    const refused = await command(poor.token, "world.scout_player", { target: target.id });
    expect(refused.data.reason).toBe("not_enough_oil");
    expect((await call("/game", poor.token)).data.game.res.oil).toBeLessThan(30);

    for (const socket of [target.ws, scout.ws, poor.ws]) socket.close();
  }, 60_000);
});
