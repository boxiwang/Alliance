// Local end-to-end check of account deletion (skipped unless E2E_URL and E2E_AUTH_SECRET are set;
// see shared-world.e2e.test.ts for starting `wrangler dev`). Covers: typed Commander ID, the
// freeze (hidden + disconnected), cancel-by-sign-in, and the purge after the grace period.
import { execSync } from "node:child_process";
import { describe, expect, it } from "vitest";
import { issueSession } from "../../worker/auth";
import { commanderIdOf } from "./profile";

const URL_BASE = process.env.E2E_URL || "http://127.0.0.1:8799";
const hex = (n: number) => Array.from({ length: n }, () => Math.floor(Math.random() * 16).toString(16)).join("");
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const call = async (path: string, token: string | null, init: RequestInit = {}) => {
  const res = await fetch(URL_BASE + path, { ...init, headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}) } });
  return { status: res.status, data: await res.json().catch(() => ({})) as any };
};
const guest = (guestId: string, playerId: string, secret?: string) => call("/auth/guest", null, { method: "POST", body: JSON.stringify({ guestId, playerId, ...(secret ? { secret } : {}) }) });
function socket(token: string) {
  const ws = new (WebSocket as any)(`${URL_BASE.replace(/^http/, "ws")}/ws?token=${encodeURIComponent(token)}`, { headers: { origin: "http://localhost:5173" } }) as WebSocket;
  const inbox: any[] = []; let closed: number | null = null;
  const ready = new Promise<void>((resolve) => { ws.onmessage = (event) => { const m = JSON.parse(String(event.data)); inbox.push(m); if (m.type === "snapshot") resolve(); }; });
  ws.onclose = (event) => { closed = event.code; };
  return { ws, inbox, ready, closed: () => closed };
}

describe.runIf(process.env.E2E_URL && process.env.E2E_AUTH_SECRET)("account deletion (local wrangler dev)", () => {
  it("freezes on request, cancels on sign-in, purges after the grace period", async () => {
    const guestId = `guest:${hex(24)}`, playerId = `0x${hex(40)}`;
    const first = await guest(guestId, playerId);
    const { token, guestSecret } = first.data;
    const id = first.data.player.id as string;
    const me = socket(token); await me.ready;
    me.ws.send(JSON.stringify({ type: "presence", name: "Doomed" }));
    const observer = socket((await guest(`guest:${hex(24)}`, `0x${hex(40)}`)).data.token); await observer.ready;
    await sleep(300);

    expect((await call("/account/delete", token, { method: "POST", body: JSON.stringify({ confirm: "IV-WRONG-0000" }) })).data.error).toBe("confirm_mismatch");
    const requested = await call("/account/delete", token, { method: "POST", body: JSON.stringify({ confirm: commanderIdOf(id).toLowerCase() }) });
    expect(requested.status).toBe(200);
    await sleep(500);
    expect(observer.inbox.some((m) => m.type === "player_removed" && m.id === id)).toBe(true);
    expect(me.closed()).toBe(4003);
    expect((await call("/me", token)).status).toBe(403);

    // Signing in during the grace period cancels the deletion.
    const back = await guest(guestId, playerId, guestSecret);
    expect(back.data.deletionCancelled).toBe(true);
    expect((await call("/me", back.data.token)).status).toBe(200);

    // Request again, age the request past the grace period, and purge.
    expect((await call("/account/delete", back.data.token, { method: "POST", body: JSON.stringify({ confirm: commanderIdOf(id) }) })).status).toBe(200);
    const db = process.env.E2E_D1_ARGS;
    if (db) {
      execSync(`npx wrangler d1 execute ${db} --command "UPDATE players SET deletion_requested_at = 1 WHERE id = '${id}'"`, { cwd: "worker", stdio: "ignore" });
      const gm = await issueSession(process.env.E2E_AUTH_SECRET!, { sub: id, method: "guest", role: "gm" } as any, 600);
      const purged = await call("/gm/world/purge-deleted", gm, { method: "POST", body: "{}" });
      expect(purged.data.purged).toContain(id);
      // Identities are gone: the old guest proof no longer opens anything; the id starts fresh.
      const again = await guest(guestId, playerId, guestSecret);
      expect(again.data.deletionCancelled).toBeUndefined();
      expect(again.data.player.displayName).not.toBe("Doomed");
      expect((await call("/inventory", again.data.token)).status).toBe(200);
    }
    observer.ws.close();
  }, 90_000);
});
