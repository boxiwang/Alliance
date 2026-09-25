import {
  bearerToken,
  hashSecret,
  issueSession,
  normalizedWallet,
  randomSecret,
  synthAddress,
  verifyFirebaseToken,
  verifySession,
  verifyWalletSignature,
  type AuthMethod,
  type PlayerRole,
  type SessionClaims,
} from "./auth";
import { ALPHA_STARTER_ITEMS, MVP_ITEM_BY_ID, MVP_ITEMS } from "../src/lib/mvp-items";
import { gameStateBelongsToPlayer, projectGameJson } from "./economy";
import { applyCommand } from "./commands";
import { applySpeedup, speedupCompatible, type SpeedupTarget } from "../src/lib/speedups";
import { BUILDING_ORDER, TROOP_ORDER, type BKey, type TroopKey } from "../src/lib/game";
import { defaultN } from "../src/lib/numbers";
import {
  applyWorldAuthorityCommand, isWorldAuthoritySession,
  type WorldAuthorityCommand, type WorldAuthoritySession,
} from "../src/lib/world-authority";

export interface BackendEnv {
  DB: D1Database;
  WORLD_ROOM?: DurableObjectNamespace;
  AUTH_SECRET: string;
  FIREBASE_PROJECT_ID: string;
  GM_WALLETS?: string;
  GM_EMAILS?: string;
}

async function sharedWorldCoord(env: BackendEnv, playerId: string): Promise<{ x: number; y: number } | null> {
  if (!env.WORLD_ROOM) return null;
  try {
    const id = env.WORLD_ROOM.idFromName("frontier-1");
    const res = await env.WORLD_ROOM.get(id).fetch(`https://world.internal/coordinate?player=${encodeURIComponent(playerId)}`);
    if (!res.ok) return null;
    const data = await res.json() as { coord?: { x?: number; y?: number } };
    const x = Number(data.coord?.x); const y = Number(data.coord?.y);
    return Number.isFinite(x) && Number.isFinite(y) ? { x, y } : null;
  } catch { return null; }
}

type PlayerRow = {
  id: string;
  auth_method: AuthMethod;
  wallet_address: string | null;
  display_name: string;
  role: PlayerRole;
  status: string;
  created_at: number;
  last_seen_at: number;
  last_login_at: number;
  name_key: string | null;
  last_renamed_at: number | null;
};

const MAX_BODY_BYTES = 600_000;
const SESSION_SECONDS = 24 * 60 * 60;
const CHALLENGE_MS = 10 * 60 * 1000;
const FREE_RENAME_MS = 30 * 24 * 60 * 60 * 1000;
const COMMAND_ARGS_BYTES = 8_000;
const WORLD_STATE_BYTES = 450_000;
const IDEMPOTENCY_KEY = /^[A-Za-z0-9:_-]{8,128}$/;

function response(data: unknown, status = 200): Response {
  return Response.json(data, { status, headers: { "cache-control": "no-store" } });
}

async function body(request: Request): Promise<Record<string, unknown> | null> {
  const length = Number(request.headers.get("content-length") || 0);
  if (length > MAX_BODY_BYTES) return null;
  try {
    const text = await request.text();
    if (text.length > MAX_BODY_BYTES) return null;
    const parsed = JSON.parse(text);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function listed(value: string | undefined, candidate: string | null): boolean {
  if (!candidate) return false;
  return (value || "").split(",").map((item) => item.trim().toLowerCase()).filter(Boolean).includes(candidate.toLowerCase());
}

function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value) ?? "null";
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`).join(",")}}`;
}

async function commandFingerprint(type: string, args: Record<string, unknown>): Promise<string> {
  const bytes = new TextEncoder().encode(canonicalJson({ type, args }));
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function validPlayerName(value: unknown): { name: string; key: string } | null {
  const name = String(value || "").replace(/[\u0000-\u001f\u007f]/g, "").trim().normalize("NFKC");
  const length = Array.from(name).length;
  if (length < 3 || length > 24 || !/^[\p{L}\p{N}_.-]+$/u.test(name)) return null;
  return { name, key: name.toLocaleLowerCase("en-US") };
}

function generatedName(playerId: string, preferred?: string): { name: string; key: string } {
  const clean = validPlayerName(preferred);
  const suffix = playerId.replace(/^0x/, "").slice(-10).toLowerCase();
  if (clean && clean.name !== "Commander") {
    const stem = Array.from(clean.name).slice(0, 13).join("");
    const name = `${stem}-${suffix}`;
    return { name, key: name.toLocaleLowerCase("en-US") };
  }
  const name = `Ruglord${suffix}`;
  return { name, key: name.toLowerCase() };
}

async function findPlayer(env: BackendEnv, id: string): Promise<PlayerRow | null> {
  return env.DB.prepare("SELECT * FROM players WHERE id = ?").bind(id).first<PlayerRow>();
}

async function savePlayer(env: BackendEnv, input: {
  id: string; method: AuthMethod; provider: string; subject: string;
  wallet?: string | null; displayName?: string; role?: PlayerRole; secretHash?: string | null;
}): Promise<PlayerRow> {
  const now = Date.now();
  const initialName = generatedName(input.id, input.displayName);
  const displayName = initialName.name;
  await env.DB.batch([
    env.DB.prepare(`INSERT INTO players (id, auth_method, wallet_address, display_name, name_key, role, status, created_at, last_seen_at, last_login_at)
      VALUES (?, ?, ?, ?, ?, ?, 'active', ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET auth_method = excluded.auth_method,
        wallet_address = COALESCE(excluded.wallet_address, players.wallet_address),
        display_name = CASE WHEN players.display_name = 'Commander' THEN excluded.display_name ELSE players.display_name END,
        name_key = CASE WHEN players.name_key IS NULL THEN excluded.name_key ELSE players.name_key END,
        role = excluded.role, last_seen_at = excluded.last_seen_at, last_login_at = excluded.last_login_at`)
      .bind(input.id, input.method, input.wallet || null, displayName, initialName.key, input.role || "player", now, now, now),
    env.DB.prepare(`INSERT INTO player_identities (provider, provider_subject, player_id, secret_hash, created_at, last_verified_at)
      VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(provider, provider_subject) DO UPDATE SET player_id = excluded.player_id,
        secret_hash = COALESCE(player_identities.secret_hash, excluded.secret_hash), last_verified_at = excluded.last_verified_at`)
      .bind(input.provider, input.subject, input.id, input.secretHash || null, now, now),
    env.DB.prepare("INSERT INTO player_state (player_id, revision, updated_at) VALUES (?, 0, ?) ON CONFLICT(player_id) DO NOTHING")
      .bind(input.id, now),
    ...Object.entries(ALPHA_STARTER_ITEMS).flatMap(([itemId, quantity]) => [
      env.DB.prepare(`INSERT INTO inventory_balances (player_id, item_id, quantity, updated_at)
        VALUES (?, ?, ?, ?) ON CONFLICT(player_id, item_id) DO NOTHING`).bind(input.id, itemId, quantity, now),
      env.DB.prepare(`INSERT INTO inventory_transactions
        (id, player_id, item_id, delta, balance_after, reason, idempotency_key, status, created_at, committed_at)
        VALUES (?, ?, ?, ?, ?, 'alpha_starter', ?, 'committed', ?, ?)
        ON CONFLICT(player_id, idempotency_key) DO NOTHING`)
        .bind(crypto.randomUUID(), input.id, itemId, quantity, quantity, `starter:${itemId}`, now, now),
    ]),
  ]);
  const player = await findPlayer(env, input.id);
  if (!player) throw new Error("player upsert failed");
  return player;
}

function inventoryRows(env: BackendEnv, playerId: string) {
  return env.DB.prepare(`SELECT item_id AS itemId, quantity, updated_at AS updatedAt
    FROM inventory_balances WHERE player_id = ? ORDER BY item_id`).bind(playerId).all<{ itemId: string; quantity: number; updatedAt: number }>();
}

async function inventory(request: Request, env: BackendEnv, claims: SessionClaims): Promise<Response> {
  if (request.method !== "GET") return response({ error: "method_not_allowed" }, 405);
  return response({ inventory: (await inventoryRows(env, claims.sub)).results });
}

async function inventoryHistory(request: Request, env: BackendEnv, claims: SessionClaims): Promise<Response> {
  if (request.method !== "GET") return response({ error: "method_not_allowed" }, 405);
  const rows = await env.DB.prepare(`SELECT id, item_id AS itemId, delta, balance_after AS balanceAfter,
    reason, reference_id AS referenceId, status, created_at AS createdAt
    FROM inventory_transactions WHERE player_id = ? ORDER BY created_at DESC LIMIT 100`).bind(claims.sub).all();
  return response({ transactions: rows.results });
}

async function consumeInventory(request: Request, env: BackendEnv, claims: SessionClaims): Promise<Response> {
  const data = await body(request);
  const itemId = String(data?.itemId || "");
  const quantity = Math.max(1, Math.min(99, Math.floor(Number(data?.quantity) || 1)));
  const idempotencyKey = String(data?.idempotencyKey || "").slice(0, 128);
  const referenceId = String(data?.referenceId || "").slice(0, 128) || null;
  const item = MVP_ITEM_BY_ID.get(itemId);
  if (!item || item.status !== "active" || !idempotencyKey) return response({ error: "invalid_item" }, 400);

  const prior = await env.DB.prepare(`SELECT status, balance_after AS balanceAfter FROM inventory_transactions
    WHERE player_id = ? AND idempotency_key = ?`).bind(claims.sub, idempotencyKey)
    .first<{ status: string; balanceAfter: number | null }>();
  if (prior?.status === "committed") return response({ itemId, quantity: prior.balanceAfter, effect: { speedupSeconds: item.speedupSeconds, speedupQueue: item.speedupQueue }, replayed: true });
  if (prior) return response({ error: "operation_pending" }, 409);

  const now = Date.now();
  const txId = crypto.randomUUID();
  await env.DB.prepare(`INSERT INTO inventory_transactions
    (id, player_id, item_id, delta, reason, reference_id, idempotency_key, status, metadata_json, created_at)
    VALUES (?, ?, ?, ?, 'item_used', ?, ?, 'pending', ?, ?)`)
    .bind(txId, claims.sub, itemId, -quantity, referenceId, idempotencyKey, JSON.stringify({ speedupQueue: item.speedupQueue }), now).run();
  const update = await env.DB.prepare(`UPDATE inventory_balances SET quantity = quantity - ?, updated_at = ?
    WHERE player_id = ? AND item_id = ? AND quantity >= ?`).bind(quantity, now, claims.sub, itemId, quantity).run();
  if (!update.meta.changes) {
    await env.DB.prepare("UPDATE inventory_transactions SET status = 'rejected', committed_at = ? WHERE id = ?").bind(now, txId).run();
    return response({ error: "insufficient_inventory" }, 409);
  }
  const balance = await env.DB.prepare("SELECT quantity FROM inventory_balances WHERE player_id = ? AND item_id = ?")
    .bind(claims.sub, itemId).first<{ quantity: number }>();
  await env.DB.batch([
    env.DB.prepare("UPDATE inventory_transactions SET status = 'committed', balance_after = ?, committed_at = ? WHERE id = ?")
      .bind(balance?.quantity ?? 0, now, txId),
    env.DB.prepare(`INSERT INTO account_audit_log (id, player_id, action, actor_player_id, metadata_json, created_at)
      VALUES (?, ?, 'inventory.consume', ?, ?, ?)`).bind(crypto.randomUUID(), claims.sub, claims.sub, JSON.stringify({ itemId, quantity, referenceId }), now),
  ]);
  return response({ itemId, quantity: balance?.quantity ?? 0, effect: { speedupSeconds: item.speedupSeconds, speedupQueue: item.speedupQueue } });
}

async function grantAlphaInventory(request: Request, env: BackendEnv, claims: SessionClaims): Promise<Response> {
  if (claims.role !== "gm") return response({ error: "gm_required" }, 403);
  const data = await body(request);
  const requestKey = String(data?.idempotencyKey || "").slice(0, 128);
  if (!requestKey) return response({ error: "idempotency_required" }, 400);
  const now = Date.now();
  const statements: D1PreparedStatement[] = [];
  for (const item of MVP_ITEMS.filter((entry) => entry.status === "active")) {
    const key = `gm:${requestKey}:${item.id}`;
    const exists = await env.DB.prepare("SELECT 1 FROM inventory_transactions WHERE player_id = ? AND idempotency_key = ?")
      .bind(claims.sub, key).first();
    if (exists) continue;
    const current = await env.DB.prepare("SELECT quantity FROM inventory_balances WHERE player_id = ? AND item_id = ?")
      .bind(claims.sub, item.id).first<{ quantity: number }>();
    const delta = Math.max(0, 99 - (current?.quantity || 0));
    if (!delta) continue;
    statements.push(
      env.DB.prepare(`INSERT INTO inventory_balances (player_id, item_id, quantity, updated_at) VALUES (?, ?, ?, ?)
        ON CONFLICT(player_id, item_id) DO UPDATE SET quantity = inventory_balances.quantity + excluded.quantity, updated_at = excluded.updated_at`)
        .bind(claims.sub, item.id, delta, now),
      env.DB.prepare(`INSERT INTO inventory_transactions
        (id, player_id, item_id, delta, balance_after, reason, idempotency_key, status, created_at, committed_at)
        VALUES (?, ?, ?, ?, 99, 'gm_alpha_test', ?, 'committed', ?, ?)`)
        .bind(crypto.randomUUID(), claims.sub, item.id, delta, key, now, now),
    );
  }
  if (statements.length) await env.DB.batch(statements);
  return response({ inventory: (await inventoryRows(env, claims.sub)).results });
}

async function sessionResponse(env: BackendEnv, player: PlayerRow, method: AuthMethod, extra: Record<string, unknown> = {}): Promise<Response> {
  const token = await issueSession(env.AUTH_SECRET, { sub: player.id, method, role: player.role }, SESSION_SECONDS);
  return response({
    token,
    expiresAt: Date.now() + SESSION_SECONDS * 1000,
    player: { id: player.id, displayName: player.display_name, role: player.role, authMethod: player.auth_method, walletAddress: player.wallet_address },
    ...extra,
  });
}

async function authClaims(request: Request, env: BackendEnv): Promise<SessionClaims | null> {
  const token = bearerToken(request);
  return token ? verifySession(env.AUTH_SECRET, token) : null;
}

async function walletChallenge(request: Request, env: BackendEnv): Promise<Response> {
  const data = await body(request);
  const address = normalizedWallet(data?.address);
  if (!address) return response({ error: "invalid_wallet" }, 400);
  const nonce = randomSecret(18);
  const issuedAt = new Date().toISOString();
  const expiresAt = Date.now() + CHALLENGE_MS;
  const message = `ALLIANCE wants to verify you own this wallet.\n\nAddress: ${address}\nChain: Robinhood Chain (4663)\nNonce: ${nonce}\nIssued: ${issuedAt}\nExpires: ${new Date(expiresAt).toISOString()}\n\nRead-only. This signature moves no funds.`;
  await env.DB.batch([
    env.DB.prepare("DELETE FROM auth_challenges WHERE expires_at < ? OR used_at IS NOT NULL").bind(Date.now() - 24 * 60 * 60 * 1000),
    env.DB.prepare("INSERT INTO auth_challenges (nonce, address, message, expires_at) VALUES (?, ?, ?, ?)").bind(nonce, address, message, expiresAt),
  ]);
  return response({ nonce, message, expiresAt });
}

async function walletVerify(request: Request, env: BackendEnv): Promise<Response> {
  const data = await body(request);
  const address = normalizedWallet(data?.address);
  const nonce = String(data?.nonce || "");
  const signature = String(data?.signature || "");
  if (!address || !nonce || !/^0x[0-9a-f]+$/i.test(signature)) return response({ error: "invalid_verification" }, 400);
  const challenge = await env.DB.prepare("SELECT message, expires_at, used_at FROM auth_challenges WHERE nonce = ? AND address = ?")
    .bind(nonce, address).first<{ message: string; expires_at: number; used_at: number | null }>();
  if (!challenge || challenge.used_at || challenge.expires_at < Date.now()) return response({ error: "challenge_expired" }, 401);
  if (!(await verifyWalletSignature(address, challenge.message, signature))) return response({ error: "bad_signature" }, 401);
  await env.DB.prepare("UPDATE auth_challenges SET used_at = ? WHERE nonce = ? AND used_at IS NULL").bind(Date.now(), nonce).run();
  const role: PlayerRole = listed(env.GM_WALLETS, address) ? "gm" : "player";
  const player = await savePlayer(env, { id: address, method: "wallet", provider: "wallet", subject: address, wallet: address, role });
  return sessionResponse(env, player, "wallet");
}

async function googleVerify(request: Request, env: BackendEnv): Promise<Response> {
  const data = await body(request);
  const idToken = String(data?.idToken || "");
  if (!idToken) return response({ error: "missing_token" }, 400);
  const identity = await verifyFirebaseToken(idToken, env.FIREBASE_PROJECT_ID);
  if (!identity) return response({ error: "invalid_google_token" }, 401);
  const id = synthAddress(`google:${identity.uid}`);
  const role: PlayerRole = listed(env.GM_EMAILS, identity.email) ? "gm" : "player";
  const player = await savePlayer(env, { id, method: "google", provider: "google", subject: identity.uid, displayName: identity.name || undefined, role });
  return sessionResponse(env, player, "google");
}

async function guestVerify(request: Request, env: BackendEnv): Promise<Response> {
  const data = await body(request);
  const guestId = String(data?.guestId || "").slice(0, 128);
  const playerId = String(data?.playerId || "").toLowerCase();
  const suppliedSecret = String(data?.secret || "");
  if (!/^[a-z0-9:_-]{16,128}$/i.test(guestId) || !/^0x[0-9a-f]{40}$/.test(playerId)) return response({ error: "invalid_guest" }, 400);
  const identity = await env.DB.prepare("SELECT player_id, secret_hash FROM player_identities WHERE provider = 'guest' AND provider_subject = ?")
    .bind(guestId).first<{ player_id: string; secret_hash: string | null }>();
  if (identity) {
    if (!suppliedSecret || !identity.secret_hash || await hashSecret(suppliedSecret) !== identity.secret_hash) return response({ error: "guest_proof_required" }, 401);
    const existing = await findPlayer(env, identity.player_id);
    if (!existing) return response({ error: "guest_missing" }, 404);
    await env.DB.prepare("UPDATE players SET last_seen_at = ?, last_login_at = ? WHERE id = ?").bind(Date.now(), Date.now(), existing.id).run();
    return sessionResponse(env, existing, "guest");
  }
  const secret = randomSecret();
  const player = await savePlayer(env, {
    id: playerId, method: "guest", provider: "guest", subject: guestId,
    displayName: data?.displayName ? String(data.displayName) : undefined,
    secretHash: await hashSecret(secret),
  });
  return sessionResponse(env, player, "guest", { guestSecret: secret });
}

async function me(request: Request, env: BackendEnv, claims: SessionClaims): Promise<Response> {
  const player = await findPlayer(env, claims.sub);
  if (!player || player.status !== "active") return response({ error: "account_unavailable" }, 403);
  await env.DB.prepare("UPDATE players SET last_seen_at = ? WHERE id = ?").bind(Date.now(), claims.sub).run();
  return response({ player: { id: player.id, displayName: player.display_name, role: player.role, authMethod: player.auth_method, walletAddress: player.wallet_address } });
}

async function renamePlayer(request: Request, env: BackendEnv, claims: SessionClaims): Promise<Response> {
  if (request.method !== "POST") return response({ error: "method_not_allowed" }, 405);
  const data = await body(request);
  const candidate = validPlayerName(data?.name);
  if (!candidate) return response({ error: "invalid_name" }, 400);
  const player = await findPlayer(env, claims.sub);
  if (!player || player.status !== "active") return response({ error: "account_unavailable" }, 403);
  if (player.name_key === candidate.key) return response({ displayName: player.display_name, nextFreeRenameAt: player.last_renamed_at ? player.last_renamed_at + FREE_RENAME_MS : 0 });
  const now = Date.now();
  const nextFreeRenameAt = (player.last_renamed_at || 0) + FREE_RENAME_MS;
  if (claims.role !== "gm" && player.last_renamed_at && now < nextFreeRenameAt) return response({ error: "rename_cooldown", nextFreeRenameAt }, 429);
  try {
    await env.DB.batch([
      env.DB.prepare("UPDATE players SET display_name = ?, name_key = ?, last_renamed_at = ?, last_seen_at = ? WHERE id = ?")
        .bind(candidate.name, candidate.key, now, now, claims.sub),
      env.DB.prepare(`INSERT INTO account_audit_log (id, player_id, action, actor_player_id, metadata_json, created_at)
        VALUES (?, ?, 'profile.rename', ?, ?, ?)`).bind(crypto.randomUUID(), claims.sub, claims.sub, JSON.stringify({ from: player.display_name, to: candidate.name }), now),
    ]);
  } catch (error) {
    if (String(error).toLowerCase().includes("unique")) return response({ error: "name_taken" }, 409);
    throw error;
  }
  return response({ displayName: candidate.name, lastRenamedAt: now, nextFreeRenameAt: now + FREE_RENAME_MS });
}

async function submitFeedback(request: Request, env: BackendEnv, claims: SessionClaims): Promise<Response> {
  if (request.method !== "POST") return response({ error: "method_not_allowed" }, 405);
  const data = await body(request);
  const message = String(data?.message || "").replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, "").trim().slice(0, 2000);
  const category = String(data?.category || "other");
  const page = String(data?.page || "").slice(0, 32) || null;
  if (message.length < 5 || !["bug", "ux", "balance", "other"].includes(category)) return response({ error: "invalid_feedback" }, 400);
  let context = "{}";
  try { context = JSON.stringify(data?.context && typeof data.context === "object" ? data.context : {}); } catch {}
  if (context.length > 4000) context = "{}";
  const id = crypto.randomUUID();
  await env.DB.prepare(`INSERT INTO alpha_feedback (id, player_id, category, page, message, client_context_json, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)`).bind(id, claims.sub, category, page, message, context, Date.now()).run();
  return response({ id, received: true }, 201);
}

async function storeEvents(request: Request, env: BackendEnv, claims: SessionClaims): Promise<Response> {
  const data = await body(request);
  const events = Array.isArray(data?.events) ? data.events.slice(0, 50) : [];
  const statements: D1PreparedStatement[] = [];
  const now = Date.now();
  for (const raw of events) {
    if (!raw || typeof raw !== "object") continue;
    const event = raw as Record<string, unknown>;
    const name = String(event.name || "");
    if (!/^[a-z][a-z0-9_.-]{1,63}$/.test(name)) continue;
    const page = String(event.page || "").slice(0, 32) || null;
    const clientTs = Number(event.clientTs);
    let properties = "{}";
    try { properties = JSON.stringify(event.properties && typeof event.properties === "object" ? event.properties : {}); } catch {}
    if (properties.length > 4000) continue;
    statements.push(env.DB.prepare(`INSERT INTO player_events
      (id, player_id, session_id, event_name, event_version, page, client_ts, server_ts, properties_json)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .bind(crypto.randomUUID(), claims.sub, claims.sid, name, Math.max(1, Math.floor(Number(event.version) || 1)), page, Number.isFinite(clientTs) ? clientTs : null, now, properties));
  }
  if (statements.length) await env.DB.batch(statements);
  return response({ accepted: statements.length });
}

async function stateRoute(request: Request, env: BackendEnv, claims: SessionClaims): Promise<Response> {
  if (request.method === "GET") {
    const state = await env.DB.prepare("SELECT revision, profile_json, game_json, world_json, account_json, economy_authority_version, economy_migrated_at, updated_at FROM player_state WHERE player_id = ?")
      .bind(claims.sub).first();
    return response({ state: state || null });
  }
  const data = await body(request);
  if (!data) return response({ error: "invalid_state" }, 400);
  const revision = Math.max(0, Math.floor(Number(data.revision) || 0));
  const encode = (key: string) => data[key] === undefined ? null : JSON.stringify(data[key]);
  const encoded = ["profile", "game", "world", "account"].map(encode);
  if (encoded.some((value) => value && value.length > 250_000)) return response({ error: "state_too_large" }, 413);
  const result = await env.DB.prepare(`UPDATE player_state SET revision = revision + 1,
    profile_json = COALESCE(?, profile_json),
    game_json = CASE WHEN economy_authority_version > 0 THEN game_json ELSE COALESCE(?, game_json) END,
    world_json = CASE WHEN economy_authority_version > 0 THEN world_json ELSE COALESCE(?, world_json) END,
    account_json = COALESCE(?, account_json), updated_at = ?
    WHERE player_id = ? AND revision = ?`)
    .bind(...encoded, Date.now(), claims.sub, revision).run();
  if (!result.meta.changes) return response({ error: "revision_conflict" }, 409);
  return response({ revision: revision + 1 });
}

// Step 1 (docs/ECONOMY-SERVER.md): serve the player's own authoritative state,
// projected to now with the shared engine. Read-only — the client still writes
// locally + mirrors for now; this lets us confirm server/client parity.
async function gameRoute(env: BackendEnv, claims: SessionClaims): Promise<Response> {
  const row = await env.DB.prepare("SELECT revision, game_json, world_json, economy_authority_version, updated_at FROM player_state WHERE player_id = ?")
    .bind(claims.sub).first<{ revision: number; game_json: string | null; world_json: string | null; economy_authority_version: number; updated_at: number }>();
  const game = projectGameJson(row?.game_json, Date.now());
  let world: unknown = null;
  try { world = row?.world_json ? JSON.parse(row.world_json) : null; } catch {}
  return response({ game, world, revision: row?.revision ?? 0, authorityVersion: row?.economy_authority_version ?? 0, updatedAt: row?.updated_at ?? 0 });
}

async function enableGameAuthority(request: Request, env: BackendEnv, claims: SessionClaims): Promise<Response> {
  const data = await body(request);
  const expectedRevision = Math.max(0, Math.floor(Number(data?.revision) || 0));
  let supplied = "";
  let suppliedWorld = "";
  try { supplied = JSON.stringify(data?.game); } catch {}
  try { suppliedWorld = JSON.stringify(data?.world); } catch {}
  if (!supplied || supplied.length > 250_000) return response({ error: "invalid_state" }, 400);
  if (!suppliedWorld || suppliedWorld.length > WORLD_STATE_BYTES) return response({ error: "invalid_world_state" }, 400);
  const now = Date.now();
  const game = projectGameJson(supplied, now);
  if (!game) return response({ error: "invalid_state" }, 400);
  if (!gameStateBelongsToPlayer(game, claims.sub)) return response({ error: "state_owner_mismatch" }, 403);
  let world: unknown;
  try { world = JSON.parse(suppliedWorld); } catch { return response({ error: "invalid_world_state" }, 400); }
  if (!isWorldAuthoritySession(world, claims.sub)) return response({ error: "invalid_world_state" }, 400);
  const coord = await sharedWorldCoord(env, claims.sub);
  if (coord) {
    const player = world.world.players[world.playerId];
    const city = world.world.entities[player.cityId];
    if (city?.kind === "city") city.position = coord;
  }
  suppliedWorld = JSON.stringify(world);
  const encoded = JSON.stringify(game);
  const write = await env.DB.prepare(`UPDATE player_state
    SET game_json = ?, world_json = ?, economy_authority_version = 1,
      economy_migrated_at = COALESCE(economy_migrated_at, ?), revision = revision + 1, updated_at = ?
    WHERE player_id = ? AND revision = ? AND (economy_authority_version = 0 OR world_json IS NULL)`)
    .bind(encoded, suppliedWorld, now, now, claims.sub, expectedRevision).run();
  if (!write.meta.changes) {
    const current = await env.DB.prepare("SELECT revision, game_json, world_json, economy_authority_version FROM player_state WHERE player_id = ?")
      .bind(claims.sub).first<{ revision: number; game_json: string | null; world_json: string | null; economy_authority_version: number }>();
    if (current?.economy_authority_version) {
      let currentWorld: unknown = null;
      try { currentWorld = current.world_json ? JSON.parse(current.world_json) : null; } catch {}
      return response({ game: projectGameJson(current.game_json, now), world: currentWorld, revision: current.revision, authorityVersion: current.economy_authority_version, replayed: true });
    }
    return response({ error: "revision_conflict" }, 409);
  }
  await env.DB.prepare(`INSERT INTO account_audit_log
    (id, player_id, action, actor_player_id, metadata_json, created_at)
    VALUES (?, ?, 'economy.authority_enabled', ?, ?, ?)`).bind(
    crypto.randomUUID(), claims.sub, claims.sub,
    JSON.stringify({ authorityVersion: 1, source: "local_alpha_save" }), now,
  ).run();
  return response({ game, world, revision: expectedRevision + 1, authorityVersion: 1 });
}

type CommandLedgerRow = {
  command_type: string;
  args_hash: string;
  ok: number;
  reason: string | null;
  result_revision: number;
  inventory_item_id: string | null;
};

function speedupTarget(value: unknown): SpeedupTarget | null {
  if (!value || typeof value !== "object") return null;
  const target = value as Record<string, unknown>;
  if (target.kind === "construction" && BUILDING_ORDER.includes(String(target.key) as BKey)) return { kind: "construction", key: String(target.key) as BKey };
  if (target.kind === "training" && TROOP_ORDER.includes(String(target.key) as TroopKey)) return { kind: "training", key: String(target.key) as TroopKey };
  if (target.kind === "research") return { kind: "research" };
  if (target.kind === "healing") return { kind: "healing" };
  return null;
}

async function replayCommand(env: BackendEnv, claims: SessionClaims, idempotencyKey: string, fingerprint: string): Promise<Response | null> {
  const prior = await env.DB.prepare(`SELECT command_type, args_hash, ok, reason, result_revision, inventory_item_id
    FROM game_commands WHERE player_id = ? AND idempotency_key = ?`)
    .bind(claims.sub, idempotencyKey).first<CommandLedgerRow>();
  if (!prior) return null;
  if (prior.args_hash !== fingerprint) return response({ error: "idempotency_mismatch" }, 409);
  const current = await env.DB.prepare("SELECT revision, game_json, world_json FROM player_state WHERE player_id = ?")
    .bind(claims.sub).first<{ revision: number; game_json: string | null; world_json: string | null }>();
  let world: unknown = null;
  try { world = current?.world_json ? JSON.parse(current.world_json) : null; } catch {}
  const inventory = prior.inventory_item_id
    ? await env.DB.prepare("SELECT item_id AS itemId, quantity FROM inventory_balances WHERE player_id = ? AND item_id = ?")
      .bind(claims.sub, prior.inventory_item_id).first<{ itemId: string; quantity: number }>()
    : null;
  return response({
    ok: prior.ok === 1,
    reason: prior.reason || undefined,
    game: projectGameJson(current?.game_json, Date.now()),
    world,
    revision: current?.revision ?? prior.result_revision,
    replayed: true,
    inventory: inventory || undefined,
  });
}

// Step 2: apply one authoritative game command. Load → project → shared reducer
// → save under the revision lock → return the new state. A rejected command is a
// 200 with the current state + reason so the client can reconcile (not an error).
async function commandRoute(request: Request, env: BackendEnv, claims: SessionClaims): Promise<Response> {
  const data = await body(request);
  const type = String(data?.type || "");
  const args = (data?.args && typeof data.args === "object") ? data.args as Record<string, unknown> : {};
  const idempotencyKey = String(data?.idempotencyKey || "");
  const argsJson = canonicalJson(args);
  if (!IDEMPOTENCY_KEY.test(idempotencyKey) || argsJson.length > COMMAND_ARGS_BYTES) return response({ error: "invalid_command" }, 400);
  const fingerprint = await commandFingerprint(type, args);
  const replay = await replayCommand(env, claims, idempotencyKey, fingerprint);
  if (replay) return replay;
  const row = await env.DB.prepare("SELECT revision, game_json, world_json, economy_authority_version FROM player_state WHERE player_id = ?")
    .bind(claims.sub).first<{ revision: number; game_json: string | null; world_json: string | null; economy_authority_version: number }>();
  if (!row?.economy_authority_version) return response({ error: "authority_disabled" }, 409);
  const now = Date.now();
  const state = projectGameJson(row?.game_json, now);
  const revision = row?.revision ?? 0;
  if (!state) return response({ error: "no_state" }, 409);
  let world: WorldAuthoritySession | null = null;
  try {
    const parsed = row.world_json ? JSON.parse(row.world_json) : null;
    if (isWorldAuthoritySession(parsed, claims.sub)) world = parsed;
  } catch {}
  let inventoryItemId: string | null = null;
  let result: { state: typeof state; ok: boolean; reason?: string; world?: WorldAuthoritySession; extra?: Record<string, unknown> };
  const isWorldCommand = type === "world.advance" || type === "world.dispatch" || type === "world.recall" || type === "world.scan";
  if (isWorldCommand) {
    if (!world) return response({ error: "world_authority_disabled" }, 409);
    let command: WorldAuthorityCommand;
    if (type === "world.dispatch") {
      const action = String(args.action || "");
      if (!["scout", "gather", "attack_monster", "attack_city"].includes(action)) return response({ error: "invalid_command" }, 400);
      command = { type, args: { targetId: String(args.targetId || ""), action: action as any, force: args.force as any, dispatchKey: String(args.dispatchKey || idempotencyKey) } };
    } else if (type === "world.recall") {
      command = { type, args: { marchId: String(args.marchId || "") } };
    } else if (type === "world.scan") {
      command = { type, args: { requestedLevel: Math.max(1, Math.floor(Number(args.requestedLevel) || 1)) } };
    } else command = { type, args: {} };
    const applied = applyWorldAuthorityCommand(world, state, command, now, defaultN());
    result = {
      state: applied.game, ok: applied.ok, reason: applied.reason, world: applied.session,
      extra: { targetId: applied.targetId, spawned: applied.spawned },
    };
  } else if (type === "speedup.use") {
    const itemId = String(args.itemId || "");
    const item = MVP_ITEM_BY_ID.get(itemId);
    const target = speedupTarget(args.target);
    if (!item || item.status !== "active" || item.category !== "speedup" || !item.speedupSeconds || !target || !speedupCompatible(item.speedupQueue, target)) {
      result = { state, ok: false, reason: "Invalid speedup" };
    } else {
      const applied = applySpeedup(state, target, item.speedupSeconds, now);
      result = applied.secondsApplied > 0
        ? { state: applied.state, ok: true }
        : { state, ok: false, reason: "That operation has already finished" };
      if (result.ok) inventoryItemId = itemId;
    }
  } else {
    result = applyCommand(state, type, args);
  }
  const reason = result.ok ? null : result.reason || "rejected";
  const resultRevision = result.ok ? revision + 1 : revision;
  const encoded = JSON.stringify(result.state);
  const encodedWorld = result.world ? JSON.stringify(result.world) : row.world_json;
  if (encoded.length > 250_000) return response({ error: "state_too_large" }, 413);
  if (encodedWorld && encodedWorld.length > WORLD_STATE_BYTES) return response({ error: "world_state_too_large" }, 413);
  const commandId = crypto.randomUUID();
  const guardId = crypto.randomUUID();
  const inventoryTransactionId = inventoryItemId ? crypto.randomUUID() : null;
  const inventoryBefore = inventoryItemId
    ? await env.DB.prepare("SELECT quantity FROM inventory_balances WHERE player_id = ? AND item_id = ?")
      .bind(claims.sub, inventoryItemId).first<{ quantity: number }>()
    : null;
  if (inventoryItemId && (!inventoryBefore || inventoryBefore.quantity < 1)) return response({ error: "insufficient_inventory" }, 409);
  try {
    const insert = env.DB.prepare(`INSERT INTO game_commands
      (id, player_id, idempotency_key, command_type, args_hash, args_json, ok, reason, base_revision, result_revision,
       result_game_json, created_at, inventory_item_id, inventory_quantity, inventory_transaction_id)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .bind(commandId, claims.sub, idempotencyKey, type, fingerprint, argsJson, result.ok ? 1 : 0, reason, revision, resultRevision,
        result.ok ? encoded : null, now, inventoryItemId, inventoryItemId ? 1 : null, inventoryTransactionId);
    if (!result.ok) {
      await insert.run();
    } else {
      const statements: D1PreparedStatement[] = [insert];
      if (inventoryItemId && inventoryBefore && inventoryTransactionId) {
        const expectedBalance = inventoryBefore.quantity - 1;
        statements.push(
          env.DB.prepare("UPDATE inventory_balances SET quantity = quantity - 1, updated_at = ? WHERE player_id = ? AND item_id = ? AND quantity >= 1")
            .bind(now, claims.sub, inventoryItemId),
          env.DB.prepare(`INSERT INTO command_transaction_guards (id, ok)
            VALUES (?, COALESCE((SELECT CASE WHEN quantity = ? THEN 1 ELSE 0 END FROM inventory_balances WHERE player_id = ? AND item_id = ?), 0))`)
            .bind(`${guardId}:inventory`, expectedBalance, claims.sub, inventoryItemId),
        );
      }
      statements.push(
        env.DB.prepare(`UPDATE player_state SET game_json = ?, world_json = COALESCE(?, world_json), revision = ?, updated_at = ?
          WHERE player_id = ? AND revision = ? AND economy_authority_version > 0`)
          .bind(encoded, encodedWorld, resultRevision, now, claims.sub, revision),
        env.DB.prepare(`INSERT INTO command_transaction_guards (id, ok)
          VALUES (?, COALESCE((SELECT CASE WHEN revision = ? THEN 1 ELSE 0 END FROM player_state WHERE player_id = ?), 0))`)
          .bind(`${guardId}:state`, resultRevision, claims.sub),
      );
      if (inventoryItemId && inventoryTransactionId) {
        statements.push(env.DB.prepare(`INSERT INTO inventory_transactions
          (id, player_id, item_id, delta, balance_after, reason, reference_id, idempotency_key, status, metadata_json, created_at, committed_at)
          VALUES (?, ?, ?, -1, (SELECT quantity FROM inventory_balances WHERE player_id = ? AND item_id = ?),
            'item_used', ?, ?, 'committed', '{}', ?, ?)`)
          .bind(inventoryTransactionId, claims.sub, inventoryItemId, claims.sub, inventoryItemId, commandId, `command:${idempotencyKey}`, now, now));
      }
      statements.push(
        env.DB.prepare("UPDATE game_commands SET result_game_json = NULL WHERE id = ?").bind(commandId),
        env.DB.prepare("DELETE FROM command_transaction_guards WHERE id IN (?, ?)").bind(`${guardId}:inventory`, `${guardId}:state`),
      );
      await env.DB.batch(statements);
    }
  } catch (error) {
    const racedReplay = await replayCommand(env, claims, idempotencyKey, fingerprint);
    if (racedReplay) return racedReplay;
    if (error instanceof Error && error.message.includes("insufficient_inventory")) return response({ error: "insufficient_inventory" }, 409);
    return response({ error: "revision_conflict" }, 409);
  }
  const inventory = inventoryItemId
    ? await env.DB.prepare("SELECT item_id AS itemId, quantity FROM inventory_balances WHERE player_id = ? AND item_id = ?")
      .bind(claims.sub, inventoryItemId).first<{ itemId: string; quantity: number }>()
    : null;
  return response({
    ok: result.ok, reason: reason || undefined, game: result.ok ? result.state : state,
    world: result.ok ? result.world || world : world, revision: resultRevision,
    inventory: inventory || undefined, ...(result.ok ? result.extra : {}),
  });
}

export async function handlePlayerApi(request: Request, env: BackendEnv): Promise<Response | null> {
  const { pathname } = new URL(request.url);
  if (request.method === "GET" && pathname === "/items") return response({ items: MVP_ITEMS });
  if (request.method === "POST" && pathname === "/auth/wallet/challenge") return walletChallenge(request, env);
  if (request.method === "POST" && pathname === "/auth/wallet/verify") return walletVerify(request, env);
  if (request.method === "POST" && pathname === "/auth/google") return googleVerify(request, env);
  if (request.method === "POST" && pathname === "/auth/guest") return guestVerify(request, env);
  if (!["/me", "/profile/name", "/feedback", "/events", "/state", "/game", "/game/authority/enable", "/command", "/inventory", "/inventory/history", "/inventory/consume", "/inventory/grant-alpha"].includes(pathname)) return null;
  const claims = await authClaims(request, env);
  if (!claims) return response({ error: "unauthorized" }, 401);
  if (request.method === "GET" && pathname === "/me") return me(request, env, claims);
  if (pathname === "/profile/name") return renamePlayer(request, env, claims);
  if (pathname === "/feedback") return submitFeedback(request, env, claims);
  if (request.method === "POST" && pathname === "/events") return storeEvents(request, env, claims);
  if ((request.method === "GET" || request.method === "PUT") && pathname === "/state") return stateRoute(request, env, claims);
  if (request.method === "GET" && pathname === "/game") return gameRoute(env, claims);
  if (request.method === "POST" && pathname === "/game/authority/enable") return enableGameAuthority(request, env, claims);
  if (request.method === "POST" && pathname === "/command") return commandRoute(request, env, claims);
  if (pathname === "/inventory") return inventory(request, env, claims);
  if (pathname === "/inventory/history") return inventoryHistory(request, env, claims);
  if (request.method === "POST" && pathname === "/inventory/consume") return consumeInventory(request, env, claims);
  if (request.method === "POST" && pathname === "/inventory/grant-alpha") return grantAlphaInventory(request, env, claims);
  return response({ error: "method_not_allowed" }, 405);
}
