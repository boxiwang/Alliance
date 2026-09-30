// Local end-to-end check of the Game Settings "Filter messages from new commanders" rule (skipped
// unless E2E_URL is set; see shared-world.e2e.test.ts for starting `wrangler dev`).
import { describe, expect, it } from "vitest";

const URL_BASE = process.env.E2E_URL || "http://127.0.0.1:8799";
const hex = (n: number) => Array.from({ length: n }, () => Math.floor(Math.random() * 16).toString(16)).join("");
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function commander(presence: Record<string, unknown>) {
  const res = await fetch(`${URL_BASE}/auth/guest`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ guestId: `guest:${hex(24)}`, playerId: `0x${hex(40)}` }) });
  const auth = await res.json() as { token: string; player: { id: string } };
  const ws = new (WebSocket as any)(`${URL_BASE.replace(/^http/, "ws")}/ws?token=${encodeURIComponent(auth.token)}`, { headers: { origin: "http://localhost:5173" } }) as WebSocket;
  const inbox: { type: string; [key: string]: unknown }[] = [];
  await new Promise<void>((resolve) => { ws.onmessage = (event) => { const message = JSON.parse(String(event.data)); inbox.push(message); if (message.type === "snapshot") resolve(); }; });
  ws.send(JSON.stringify({ type: "presence", name: `T${hex(4)}`, ...presence }));
  await sleep(250);
  const dm = (to: string, text: string) => ws.send(JSON.stringify({ type: "dm", to, text }));
  const got = (type: string, predicate: (message: any) => boolean = () => true) => inbox.some((message) => message.type === type && predicate(message));
  return { id: auth.player.id, ws, inbox, dm, got, presence: (p: Record<string, unknown>) => ws.send(JSON.stringify({ type: "presence", ...p })) };
}

describe.runIf(process.env.E2E_URL)("DM filter for new commanders (local wrangler dev)", () => {
  it("lets alliance members, Core 10+ and replies through; blocks other new commanders", async () => {
    const recipient = await commander({ faction: "ORBT", keepLevel: 3, dmFilter: true });
    const stranger = await commander({ faction: "RUGZ", keepLevel: 1 });
    const veteran = await commander({ faction: "RUGZ", keepLevel: 12 });
    const ally = await commander({ faction: "ORBT", keepLevel: 1 });

    stranger.dm(recipient.id, "free airdrop, dm me");
    veteran.dm(recipient.id, "gg last night");
    ally.dm(recipient.id, "rally at 9");
    await sleep(600);
    expect(stranger.got("dm_blocked", (m) => m.to === recipient.id)).toBe(true);
    expect(recipient.got("dm", (m) => m.msg?.pid === stranger.id)).toBe(false);
    expect(recipient.got("dm", (m) => m.msg?.pid === veteran.id)).toBe(true);
    expect(recipient.got("dm", (m) => m.msg?.pid === ally.id)).toBe(true);

    // Once the recipient writes first, the low-level commander may reply.
    recipient.dm(stranger.id, "who are you?");
    await sleep(300);
    stranger.dm(recipient.id, "just a new player");
    await sleep(500);
    expect(recipient.got("dm", (m) => m.msg?.pid === stranger.id && m.msg?.text === "just a new player")).toBe(true);

    // Filter off: anyone can open a chat again.
    const other = await commander({ faction: null, keepLevel: 1 });
    recipient.presence({ dmFilter: false });
    await sleep(300);
    other.dm(recipient.id, "hello");
    await sleep(500);
    expect(recipient.got("dm", (m) => m.msg?.pid === other.id)).toBe(true);
    for (const c of [recipient, stranger, veteran, ally, other]) c.ws.close();
  }, 60_000);
});
