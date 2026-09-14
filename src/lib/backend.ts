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

export function saveBackendSession(session: BackendSession): void {
  try { localStorage.setItem(sessionKey(session.player.id), JSON.stringify(session)); } catch {}
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
