import type { Eip1193Provider } from "../global";

export const BACKEND_HTTP = "https://alliance-realtime.blockwick.workers.dev";
export const BACKEND_WS = "wss://alliance-realtime.blockwick.workers.dev/ws";

export type BackendPlayer = {
  id: string;
  displayName: string;
  role: "player" | "gm";
  authMethod: "wallet" | "google" | "guest";
  walletAddress: string | null;
};

export type BackendSession = {
  token: string;
  expiresAt: number;
  player: BackendPlayer;
};

const sessionKey = (address: string) => `alliance:backend-session:${address.toLowerCase()}`;
const LAST_SESSION_KEY = "alliance:backend-session:last-player";
const guestSecretKey = (guestId: string) => `alliance:guest-proof:${guestId}`;

async function post<T>(path: string, payload: unknown, token?: string): Promise<T> {
  const response = await fetch(`${BACKEND_HTTP}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify(payload),
  });
  const data = await response.json().catch(() => ({})) as T & { error?: string };
  if (!response.ok) throw new Error(data.error || `backend_${response.status}`);
  return data;
}

async function get<T>(path: string, token?: string): Promise<T> {
  const response = await fetch(`${BACKEND_HTTP}${path}`, {
    headers: token ? { authorization: `Bearer ${token}` } : undefined,
  });
  const data = await response.json().catch(() => ({})) as T & { error?: string };
  if (!response.ok) throw new Error(data.error || `backend_${response.status}`);
  return data;
}

export function saveBackendSession(session: BackendSession): void {
  try {
    localStorage.setItem(sessionKey(session.player.id), JSON.stringify(session));
    localStorage.setItem(LAST_SESSION_KEY, session.player.id.toLowerCase());
  } catch {}
}

export function loadBackendSession(address: string): BackendSession | null {
  try {
    const session = JSON.parse(localStorage.getItem(sessionKey(address)) || "null") as BackendSession | null;
    if (!session?.token || session.player.id.toLowerCase() !== address.toLowerCase() || session.expiresAt <= Date.now() + 30_000) return null;
    return session;
  } catch {
    return null;
  }
}

/** Find the last usable session without trusting it. Call resumeBackendSession
 * before entering the game so the backend remains the authority for role and
 * account status. The prefix scan lets sessions created before the pointer was
 * introduced resume on their first refresh after this release. */
export function loadLastBackendSession(): BackendSession | null {
  try {
    const lastPlayer = localStorage.getItem(LAST_SESSION_KEY);
    if (lastPlayer) {
      const pointed = loadBackendSession(lastPlayer);
      if (pointed) return pointed;
    }
    let newest: BackendSession | null = null;
    for (let index = 0; index < localStorage.length; index += 1) {
      const key = localStorage.key(index);
      if (!key?.startsWith("alliance:backend-session:") || key === LAST_SESSION_KEY) continue;
      const candidate = loadBackendSession(key.slice("alliance:backend-session:".length));
      if (candidate && (!newest || candidate.expiresAt > newest.expiresAt)) newest = candidate;
    }
    if (newest) localStorage.setItem(LAST_SESSION_KEY, newest.player.id.toLowerCase());
    return newest;
  } catch {
    return null;
  }
}

export async function resumeBackendSession(): Promise<BackendSession | null> {
  const stored = loadLastBackendSession();
  if (!stored) return null;
  try {
    const verified = await get<{ player: BackendPlayer }>("/me", stored.token);
    const session = { ...stored, player: verified.player };
    saveBackendSession(session);
    return session;
  } catch {
    clearBackendSession(stored.player.id);
    return null;
  }
}

export function clearBackendSession(address: string): void {
  try {
    localStorage.removeItem(sessionKey(address));
    if (localStorage.getItem(LAST_SESSION_KEY)?.toLowerCase() === address.toLowerCase()) localStorage.removeItem(LAST_SESSION_KEY);
  } catch {}
}

export async function authenticateWallet(provider: Eip1193Provider, address: string): Promise<BackendSession> {
  const challenge = await post<{ nonce: string; message: string }>("/auth/wallet/challenge", { address });
  const signature = await provider.request({ method: "personal_sign", params: [challenge.message, address] }) as string;
  const session = await post<BackendSession>("/auth/wallet/verify", { address, nonce: challenge.nonce, signature });
  saveBackendSession(session);
  return session;
}

export async function authenticateGoogle(idToken: string): Promise<BackendSession> {
  const session = await post<BackendSession>("/auth/google", { idToken });
  saveBackendSession(session);
  return session;
}

export async function authenticateGuest(guestId: string, playerId: string, displayName = ""): Promise<BackendSession> {
  let secret = "";
  try { secret = localStorage.getItem(guestSecretKey(guestId)) || ""; } catch {}
  const result = await post<BackendSession & { guestSecret?: string }>("/auth/guest", { guestId, playerId, displayName, secret });
  if (result.guestSecret) {
    try { localStorage.setItem(guestSecretKey(guestId), result.guestSecret); } catch {}
  }
  saveBackendSession(result);
  return result;
}

export type PlayerEvent = {
  name: string;
  version?: number;
  page?: string;
  clientTs?: number;
  properties?: Record<string, unknown>;
};

export async function trackEvents(address: string, events: PlayerEvent[]): Promise<void> {
  const session = loadBackendSession(address);
  if (!session || !events.length) return;
  await post("/events", { events: events.map((event) => ({ ...event, clientTs: event.clientTs || Date.now() })) }, session.token);
}

const pendingEvents = new Map<string, PlayerEvent[]>();
const eventTimers = new Map<string, ReturnType<typeof setTimeout>>();

function scheduleEventFlush(key: string): void {
  if (eventTimers.has(key)) return;
  eventTimers.set(key, setTimeout(() => {
    eventTimers.delete(key);
    const batch = pendingEvents.get(key)?.splice(0, 50) || [];
    if (batch.length) void trackEvents(key, batch).catch(() => {});
    if (pendingEvents.get(key)?.length) scheduleEventFlush(key);
  }, 650));
}

/** Non-blocking, batched telemetry. Gameplay must never wait for analytics. */
export function queuePlayerEvent(address: string, event: PlayerEvent): void {
  if (!address) return;
  const key = address.toLowerCase();
  const queue = pendingEvents.get(key) || [];
  queue.push({ ...event, clientTs: event.clientTs || Date.now() });
  pendingEvents.set(key, queue.slice(-100));
  scheduleEventFlush(key);
}

export type InventoryBalance = { itemId: string; quantity: number; updatedAt: number };

export async function loadInventory(address: string): Promise<InventoryBalance[]> {
  const session = loadBackendSession(address);
  if (!session) return [];
  return (await get<{ inventory: InventoryBalance[] }>("/inventory", session.token)).inventory;
}

export async function consumeInventoryItem(address: string, itemId: string, referenceId: string): Promise<{ itemId: string; quantity: number; effect: Record<string, unknown> }> {
  const session = loadBackendSession(address);
  if (!session) throw new Error("session_required");
  return post("/inventory/consume", { itemId, quantity: 1, referenceId, idempotencyKey: referenceId }, session.token);
}

export async function grantGmInventory(address: string): Promise<InventoryBalance[]> {
  const session = loadBackendSession(address);
  if (!session) throw new Error("session_required");
  return (await post<{ inventory: InventoryBalance[] }>("/inventory/grant-alpha", { idempotencyKey: crypto.randomUUID() }, session.token)).inventory;
}

export async function updatePlayerName(address: string, name: string): Promise<{ displayName: string; lastRenamedAt?: number; nextFreeRenameAt: number }> {
  const session = loadBackendSession(address);
  if (!session) throw new Error("session_required");
  const result = await post<{ displayName: string; lastRenamedAt?: number; nextFreeRenameAt: number }>("/profile/name", { name }, session.token);
  const updated = { ...session, player: { ...session.player, displayName: result.displayName } };
  saveBackendSession(updated);
  return result;
}

export async function submitAlphaFeedback(address: string, input: { category: "bug" | "ux" | "balance" | "other"; page: string; message: string }): Promise<void> {
  const session = loadBackendSession(address);
  if (!session) throw new Error("session_required");
  await post("/feedback", { ...input, context: {
    userAgent: navigator.userAgent.slice(0, 300),
    viewport: `${window.innerWidth}x${window.innerHeight}`,
    online: navigator.onLine,
  } }, session.token);
}

/**
 * Pull the mirrored save back down (new device / cleared cache). Returns the last
 * snapshot the backend holds, or null if none / no session. The caller decides
 * whether to write it into local storage (only when local is empty, so active
 * progress is never clobbered).
 */
export async function restorePlayerState(address: string): Promise<{ profile?: unknown; game?: unknown; account?: unknown; revision?: number } | null> {
  const session = loadBackendSession(address);
  if (!session) return null;
  try {
    const res = await get<{ state?: Record<string, unknown> | null }>("/state", session.token);
    const s = res.state;
    if (!s) return null;
    // The backend stores these as JSON strings in *_json columns; accept plain
    // keys too for forward-compat.
    const parse = (v: unknown) => {
      if (v == null) return undefined;
      if (typeof v === "string") { try { return JSON.parse(v); } catch { return undefined; } }
      return v;
    };
    const profile = parse(s.profile_json ?? s.profile);
    const game = parse(s.game_json ?? s.game);
    const account = parse(s.account_json ?? s.account);
    if (!profile && !game && !account) return null;
    return { profile, game, account, revision: Number(s.revision) || 0 };
  } catch {
    return null;
  }
}

/**
 * Step 1 (docs/ECONOMY-SERVER.md): read the server's authoritative game state,
 * projected to now with the shared engine. Read-only for now — used to confirm
 * server/client parity before the write surface moves to commands.
 */
export type ServerGame = { game: unknown; world: unknown; revision: number; authorityVersion: number };

export async function fetchServerGame(address: string): Promise<ServerGame | null> {
  const session = loadBackendSession(address);
  if (!session) return null;
  try {
    const res = await get<{ game?: unknown; world?: unknown; revision?: number; authorityVersion?: number }>("/game", session.token);
    return { game: res.game ?? null, world: res.world ?? null, revision: Number(res.revision) || 0, authorityVersion: Number(res.authorityVersion) || 0 };
  } catch {
    return null;
  }
}

export async function enableGameAuthority(address: string, game: unknown, world: unknown, revision: number): Promise<ServerGame> {
  const session = loadBackendSession(address);
  if (!session) throw new Error("session_required");
  const res = await post<{ game?: unknown; world?: unknown; revision?: number; authorityVersion?: number }>("/game/authority/enable", { game, world, revision }, session.token);
  return { game: res.game ?? null, world: res.world ?? null, revision: Number(res.revision) || 0, authorityVersion: Number(res.authorityVersion) || 0 };
}

/**
 * Step 2 (docs/ECONOMY-SERVER.md): issue one authoritative game command. The
 * server runs the shared reducer and returns the new state (ok), or the current
 * state + a reason (rejected). The idempotency key belongs to the caller so the
 * exact same command can be retried after an uncertain network response.
 */
export type GameCommandResponse = { ok: boolean; reason?: string; game: unknown; world: unknown; revision: number; replayed: boolean; inventory?: { itemId: string; quantity: number }; targetId?: string; spawned?: boolean };

export async function sendGameCommand(address: string, type: string, args: Record<string, unknown>, idempotencyKey: string): Promise<GameCommandResponse> {
  const session = loadBackendSession(address);
  if (!session) throw new Error("session_required");
  const res = await post<{ ok?: boolean; reason?: string; game?: unknown; world?: unknown; revision?: number; replayed?: boolean; inventory?: { itemId: string; quantity: number }; targetId?: string; spawned?: boolean }>("/command", { type, args, idempotencyKey }, session.token);
  return { ok: !!res.ok, reason: res.reason, game: res.game ?? null, world: res.world ?? null, revision: Number(res.revision) || 0, replayed: !!res.replayed, inventory: res.inventory, targetId: res.targetId, spawned: res.spawned };
}

/**
 * Private-alpha recovery mirror. This is deliberately not called authoritative:
 * the client still produced these values, so combat/economy validation must move
 * to server commands before purchases or tradable inventory depend on them.
 */
export async function mirrorPlayerState(address: string, snapshot: { profile?: unknown; game?: unknown; account?: unknown }): Promise<void> {
  const session = loadBackendSession(address);
  if (!session) return;
  const headers = { authorization: `Bearer ${session.token}`, "content-type": "application/json" };
  const currentResponse = await fetch(`${BACKEND_HTTP}/state`, { headers });
  if (!currentResponse.ok) return;
  const current = await currentResponse.json().catch(() => ({})) as { state?: { revision?: number } | null };
  const revision = Math.max(0, Math.floor(Number(current.state?.revision) || 0));
  await fetch(`${BACKEND_HTTP}/state`, {
    method: "PUT",
    headers,
    body: JSON.stringify({ revision, ...snapshot }),
  });
}
