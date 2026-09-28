// Local end-to-end check of the shared world against `wrangler dev` (skipped unless E2E_URL is set):
//   cd worker && npx wrangler d1 migrations apply alliance-player-data --local --persist-to <dir>
//   cd worker && npx wrangler dev --local --port 8799 --persist-to <dir> --var AUTH_SECRET:<any-local-secret>
//   E2E_URL=http://127.0.0.1:8799 npx vitest run src/lib/shared-world.e2e.test.ts
// The client can be pointed at the same worker in dev: localStorage["alliance:dev-backend"] = "http://127.0.0.1:8799".
import { describe, expect, it } from "vitest";
import { initGame } from "./gamestore";
import { getN } from "./numbers";
import { createLocalWorldSession } from "./world-adapter";

const URL_BASE = process.env.E2E_URL || "http://127.0.0.1:8799";
const WS_BASE = URL_BASE.replace(/^http/, "ws");
const hex = (n: number) => Array.from({ length: n }, () => Math.floor(Math.random() * 16).toString(16)).join("");

async function call(path: string, token: string | null, init: RequestInit = {}) {
  const res = await fetch(URL_BASE + path, { ...init, headers: { "content-type": "application/json", origin: "http://localhost:5173", ...(token ? { authorization: `Bearer ${token}` } : {}), ...(init.headers || {}) } });
  const data: any = await res.json().catch(() => ({}));
  return { status: res.status, data };
}

async function guest() {
  const playerId = `0x${hex(40)}`;
  const { data } = await call("/auth/guest", null, { method: "POST", body: JSON.stringify({ guestId: `guest:${hex(24)}`, playerId }) });
  return { token: data.token as string, playerId };
}

async function enable(token: string, playerId: string, army = 60) {
  const n: any = structuredClone(getN());
  n.world.population.localNpcCities = 0;
  const g = initGame(playerId);
  g.troops.army["1"] = army;
  const local = createLocalWorldSession(playerId, g, Date.now(), n);
  const me = await call("/game", token);
  return call("/game/authority/enable", token, { method: "POST", body: JSON.stringify({ game: local.game, world: local.session, revision: me.data.revision ?? 0 }) });
}

const command = (token: string, type: string, args: Record<string, unknown> = {}) =>
  call("/command", token, { method: "POST", body: JSON.stringify({ type, args, idempotencyKey: `e2e:${hex(16)}` }) });

function socket(token: string): Promise<{ ws: WebSocket; next: (type: string) => Promise<any> }> {
  return new Promise((resolve, reject) => {
    const ws = new (WebSocket as any)(`${WS_BASE}/ws?token=${encodeURIComponent(token)}`, { headers: { origin: "http://localhost:5173" } }) as WebSocket;
    const waiters: { type: string; resolve: (v: any) => void }[] = [];
    const inbox: any[] = [];
    ws.onmessage = (event) => {
      const msg = JSON.parse(String(event.data));
      const i = waiters.findIndex((w) => w.type === msg.type);
      if (i >= 0) waiters.splice(i, 1)[0].resolve(msg); else inbox.push(msg);
    };
    ws.onerror = reject;
    ws.onopen = () => resolve({
      ws,
      next: (type) => {
        const i = inbox.findIndex((m) => m.type === type);
        if (i >= 0) return Promise.resolve(inbox.splice(i, 1)[0]);
        return new Promise((res) => waiters.push({ type, resolve: res }));
      },
    });
  });
}

describe.runIf(process.env.E2E_URL)("shared world end-to-end (local wrangler dev)", () => {
  it("cuts over, dispatches, recalls and delivers without losing troops", async () => {
    const a = await guest(), b = await guest();
    expect((await enable(a.token, a.playerId)).status).toBe(200);
    expect((await enable(b.token, b.playerId)).status).toBe(200);

    // First world command triggers the cutover into the shared world.
    const first = await command(a.token, "world.advance");
    expect(first.status).toBe(200);
    expect(first.data.ok).toBe(true);
    expect(Object.keys(first.data.world.world.players)).toEqual([a.playerId]);
    const gameA = await call("/game", a.token);
    expect(gameA.data.authorityVersion).toBe(2);
    expect(gameA.data.game.troops.army["1"]).toBe(60);
    await command(b.token, "world.advance");

    // A sees public targets (and B's city if nearby) only through the view query.
    const sa = await socket(a.token);
    const snap = await sa.next("snapshot");
    expect(snap.players.filter((p: any) => p.id !== a.playerId && p.coords).length).toBe(0);
    const home = snap.players.find((p: any) => p.id === a.playerId).coords;
    sa.ws.send(JSON.stringify({ type: "view", rect: { x0: home.x - 60, y0: home.y - 60, x1: home.x + 60, y1: home.y + 60 } }));
    const view = await sa.next("view_players");
    expect(Array.isArray(view.targets)).toBe(true);
    // Search returns the nearest free L1 cash planet from home.
    sa.ws.send(JSON.stringify({ type: "search", kind: "cash", level: 1, index: 0 }));
    const found = await sa.next("search_result");
    expect(found.total).toBeGreaterThan(0);
    const target = found.target;

    const sent = await command(a.token, "world.dispatch", { targetId: target.id, action: "gather", force: { army: { "1": 20 } }, dispatchKey: `d:${hex(8)}` });
    expect(sent.data.ok).toBe(true);
    expect(sent.data.game.troops.army["1"]).toBe(40);
    const march: any = Object.values(sent.data.world.world.marches)[0];
    expect(march.state).toBe("outbound");
    // B's slice never contains A's march or city.
    const sliceB = await command(b.token, "world.advance");
    expect(Object.values(sliceB.data.world.world.marches).length).toBe(0);
    expect(sliceB.data.world.world.entities[`city.${a.playerId}`]).toBeUndefined();

    const recalled = await command(a.token, "world.recall", { marchId: march.id });
    expect(recalled.data.ok).toBe(true);
    // The DO alarm processes the return; the next read delivers the troops.
    await new Promise((r) => setTimeout(r, 2500));
    const after = await call("/game", a.token);
    expect(after.data.game.troops.army["1"]).toBe(60);
    sa.ws.close();
  }, 60_000);
});
