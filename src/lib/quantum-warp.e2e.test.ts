// Local end-to-end check of Quantum Warp (skipped unless E2E_URL and E2E_AUTH_SECRET are set;
// see shared-world.e2e.test.ts for starting `wrangler dev`): fleets away block the normal jumps,
// Quantum Warp recalls them instantly, escapes an attack on its way and spends its item.
import { describe, expect, it } from "vitest";
import { issueSession } from "../../worker/auth";
import { initGame } from "./gamestore";
import { getN } from "./numbers";
import { createLocalWorldSession } from "./world-adapter";
import { nearestWarpPoint } from "./world-engine";

const URL_BASE = process.env.E2E_URL || "http://127.0.0.1:8799";
const hex = (n: number) => Array.from({ length: n }, () => Math.floor(Math.random() * 16).toString(16)).join("");
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const call = async (path: string, token: string | null, init: RequestInit = {}) => {
  const res = await fetch(URL_BASE + path, { ...init, headers: { "content-type": "application/json", origin: "http://localhost:5173", ...(token ? { authorization: `Bearer ${token}` } : {}) } });
  return { status: res.status, data: await res.json().catch(() => ({})) as any };
};
const command = (token: string, type: string, args: Record<string, unknown> = {}) =>
  call("/command", token, { method: "POST", body: JSON.stringify({ type, args, idempotencyKey: `qw:${hex(16)}` }) });

async function commander() {
  const { data: auth } = await call("/auth/guest", null, { method: "POST", body: JSON.stringify({ guestId: `guest:${hex(24)}`, playerId: `0x${hex(40)}` }) });
  const id = auth.player.id as string;
  const n: any = structuredClone(getN()); n.world.population.localNpcCities = 0;
  const local = createLocalWorldSession(id, initGame(id), Date.now(), n);
  const me = await call("/game", auth.token);
  await call("/game/authority/enable", auth.token, { method: "POST", body: JSON.stringify({ game: local.game, world: local.session, revision: me.data.revision ?? 0 }) });
  await call("/game", auth.token);
  const gm = await issueSession(process.env.E2E_AUTH_SECRET!, { sub: id, method: "guest", role: "gm" } as any, 600);
  await command(gm, "gm.fill_troops");
  const ws = new (WebSocket as any)(`${URL_BASE.replace(/^http/, "ws")}/ws?token=${encodeURIComponent(auth.token)}`, { headers: { origin: "http://localhost:5173" } }) as WebSocket;
  const inbox: any[] = [];
  await new Promise<void>((resolve) => { ws.onmessage = (event) => { const m = JSON.parse(String(event.data)); inbox.push(m); if (m.type === "snapshot") resolve(); }; });
  await sleep(300);
  return { id, token: auth.token as string, gm, ws, inbox };
}

describe.runIf(process.env.E2E_URL && process.env.E2E_AUTH_SECRET)("Quantum Warp (local wrangler dev)", () => {
  it("recalls fleets, escapes an attack on its way and spends the item", async () => {
    const a = await commander();
    for (let i = 0; i < 11; i += 1) await command(a.gm, "gm.raise_townhall"); // past the new-city shield
    await call("/inventory/grant-alpha", a.gm, { method: "POST", body: JSON.stringify({ idempotencyKey: `qw:${hex(8)}` }) });
    // A sends a fleet out.
    const game = await call("/game", a.token);
    const world = game.data.world.world;
    const home = world.entities[world.players[a.id].cityId].position;
    const scan = await command(a.token, "world.scan", { requestedLevel: 1 });
    expect(scan.data.targetId, "rogue found").toBeTruthy();
    const troops = (scan.data.world?.world ?? world).players[a.id].troops as Record<string, Record<string, number>>;
    const [kind, tiers] = Object.entries(troops).find(([, t]) => Object.values(t).some((n) => n > 0))!;
    const [tier, have] = Object.entries(tiers).find(([, n]) => n > 0)!;
    const sent = await command(a.token, "world.dispatch", { targetId: scan.data.targetId, action: "attack_monster", force: { [kind]: { [tier]: Math.min(have, 50) } }, dispatchKey: `qw:${hex(8)}` });
    expect(sent.data.reason ?? "ok").toBe("ok");
    const spot = nearestWarpPoint(sent.data.world.world, a.id, { x: home.x + 18, y: home.y }, getN())!;
    expect((await command(a.token, "world.warp", { mode: "precision", x: spot.x, y: spot.y })).data.reason).toBe("fleets_away");

    // B attacks A: the attack is on its way.
    const b = await commander();
    b.ws.send(JSON.stringify({ type: "march", to: a.id }));
    await sleep(800);
    const attack = b.inbox.find((m) => m.type === "march" && m.march?.defender === a.id)?.march;
    expect(attack, "attack launched").toBeTruthy();
    expect(attack.arriveAt).toBeGreaterThan(Date.now() + 5_000);

    // Quantum Warp: fleets home, attack called off, one item spent.
    const before = ((await call("/inventory", a.token)).data.inventory as any[]).find((e) => e.itemId === "war.relocator.quantum")?.quantity;
    const warped = await command(a.token, "world.warp", { mode: "quantum", x: spot.x, y: spot.y });
    expect(warped.data.reason ?? "ok").toBe("ok");
    expect(Object.values(warped.data.world.world.marches).filter((m: any) => m.playerId === a.id && !["completed", "failed", "recalled"].includes(m.state))).toHaveLength(0);
    await sleep(600);
    expect(b.inbox.some((m) => m.type === "march_done" && m.id === attack.id)).toBe(true);
    expect(b.inbox.some((m) => m.type === "report" && /Quantum Warp/.test(m.report?.payload?.summary || ""))).toBe(true);
    const after = ((await call("/inventory", a.token)).data.inventory as any[]).find((e) => e.itemId === "war.relocator.quantum")?.quantity;
    expect(after).toBe(before - 1);
    a.ws.close(); b.ws.close();
  }, 90_000);
});
