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
import { ALPHA_STARTER_ITEMS, MVP_ITEM_BY_ID, MVP_ITEMS, rollChest, UNLIMITED_ITEM_QUANTITY } from "../src/lib/mvp-items";
import { DAILY_SUPPLY, SHOP_OFFER_BY_ID, SHOP_OFFERS, TOPUP_PACKS } from "../src/lib/shop-catalog";
import { gameStateBelongsToPlayer, projectGameJson } from "./economy";
import { applyCommand } from "./commands";
import { scoutOilCost } from "../src/lib/scout-cost";
import { gmFillResources, gmFillTroops, gmFinishQueues, gmMaxResearch, gmRaiseBuilding, gmRaiseTownhall, gmResetProgress } from "../src/lib/gm";
import { applySpeedup, speedupCompatible, type SpeedupTarget } from "../src/lib/speedups";
import { BUILDING_ORDER, TROOP_ORDER, type BKey, type GameState, type TroopKey } from "../src/lib/game";
import { defaultN } from "../src/lib/numbers";
import {
  applyWorldAuthorityCommand, isWorldAuthoritySession,
  type WorldAuthorityCommand, type WorldAuthoritySession,
} from "../src/lib/world-authority";
import { removeSimulatedCities, simulatedCityCount } from "../src/lib/world-engine";
import { retirePrivateWorld, type SharedCarryOver } from "../src/lib/shared-world";

/**
 * The WorldRoom's shared world as seen by the D1 command pipeline (docs/SHARED-ECOLOGY.md).
 * `apply` works on a pending copy; `commit` makes it real only after D1 accepted the
 * matching game_json write, so the world and the economy never diverge. `discard` is a
 * no-op after `commit`.
 */
export interface SharedWorldPort {
  has(playerId: string): boolean;
  join(playerId: string, game: GameState, carry: SharedCarryOver | undefined, now: number): Promise<void>;
  apply(playerId: string, game: GameState, command: WorldAuthorityCommand, now: number): {
    game: GameState; ok: boolean; reason?: string; session: WorldAuthoritySession; position?: { x: number; y: number };
    targetId?: string | null; spawned?: boolean;
  };
  commit(): Promise<void>;
  discard(): void;
}

const WORLD_COMMANDS = new Set(["world.advance", "world.dispatch", "world.recall", "world.scan", "world.warp"]);

function worldRoom(env: BackendEnv): DurableObjectStub | null {
  return env.WORLD_ROOM ? env.WORLD_ROOM.get(env.WORLD_ROOM.idFromName("frontier-1")) : null;
}

export interface BackendEnv {
  DB: D1Database;
  WORLD_ROOM?: DurableObjectNamespace;
  AUTH_SECRET: string;
  FIREBASE_PROJECT_ID: string;
  GM_WALLETS?: string;
  GM_EMAILS?: string;
  PAYMENT_RAILS_JSON?: string;
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

async function reserveWorldCoord(env: BackendEnv, playerId: string, coord: { x: number; y: number }, minSpacing: number, revert = false): Promise<{ ok: boolean; error?: string; previous?: { x: number; y: number } | null }> {
  if (!env.WORLD_ROOM) return { ok: true, previous: null };
  try {
    const id = env.WORLD_ROOM.idFromName("frontier-1");
    const res = await env.WORLD_ROOM.get(id).fetch("https://world.internal/relocate", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ player: playerId, x: coord.x, y: coord.y, minSpacing, revert }),
    });
    const data = await res.json() as { ok?: boolean; error?: string; previous?: { x: number; y: number } | null };
    return { ok: !!data.ok, error: data.error, previous: data.previous ?? null };
  } catch { return { ok: false, error: "world_unreachable" }; }
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
    env.DB.prepare("INSERT INTO credit_accounts (player_id, balance, purchased_total, updated_at) VALUES (?, 0, 0, ?) ON CONFLICT(player_id) DO NOTHING")
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

/** What a player's Warehouse shows: GM accounts see every active item without limit. */
async function inventoryView(env: BackendEnv, claims: SessionClaims) {
  if (claims.role !== "gm") return (await inventoryRows(env, claims.sub)).results;
  const now = Date.now();
  return MVP_ITEMS.filter((item) => item.status === "active").map((item) => ({ itemId: item.id, quantity: UNLIMITED_ITEM_QUANTITY, updatedAt: now }));
}

function utcDay(now = Date.now()): string {
  return new Date(now).toISOString().slice(0, 10);
}

async function creditBalance(env: BackendEnv, playerId: string): Promise<number> {
  const row = await env.DB.prepare("SELECT balance FROM credit_accounts WHERE player_id = ?")
    .bind(playerId).first<{ balance: number }>();
  return Math.max(0, Number(row?.balance) || 0);
}

function publicPaymentRails(env: BackendEnv): Array<Record<string, unknown>> {
  if (!env.PAYMENT_RAILS_JSON) return [];
  try {
    const rows = JSON.parse(env.PAYMENT_RAILS_JSON) as Array<Record<string, unknown>>;
    if (!Array.isArray(rows)) return [];
    return rows.flatMap((rail) => {
      const id = String(rail.id || "").slice(0, 48);
      const chainId = Math.floor(Number(rail.chainId));
      const tokenAddress = normalizedWallet(rail.tokenAddress);
      const treasuryAddress = normalizedWallet(rail.treasuryAddress);
      const decimals = Math.floor(Number(rail.decimals));
      if (!id || !Number.isFinite(chainId) || !tokenAddress || !treasuryAddress || decimals < 0 || decimals > 36) return [];
      return [{
        id, chainId, chainName: String(rail.chainName || `Chain ${chainId}`).slice(0, 48),
        tokenAddress, tokenSymbol: String(rail.tokenSymbol || "TOKEN").slice(0, 12),
        decimals, treasuryAddress, confirmations: Math.max(1, Math.min(64, Math.floor(Number(rail.confirmations) || 2))),
        explorerTxUrl: String(rail.explorerTxUrl || "").slice(0, 240),
      }];
    });
  } catch {
    return [];
  }
}

async function shopAccount(request: Request, env: BackendEnv, claims: SessionClaims): Promise<Response> {
  if (request.method !== "GET") return response({ error: "method_not_allowed" }, 405);
  const today = utcDay();
  const claim = await env.DB.prepare("SELECT 1 AS claimed FROM shop_daily_claims WHERE player_id = ? AND claim_day = ?")
    .bind(claims.sub, today).first<{ claimed: number }>();
  return response({
    balance: await creditBalance(env, claims.sub),
    offers: SHOP_OFFERS,
    packs: TOPUP_PACKS,
    dailyClaimed: !!claim,
    resetAt: Date.parse(`${new Date(Date.now() + 86_400_000).toISOString().slice(0, 10)}T00:00:00.000Z`),
    paymentRails: publicPaymentRails(env),
  });
}

async function shopPurchase(request: Request, env: BackendEnv, claims: SessionClaims): Promise<Response> {
  if (request.method !== "POST") return response({ error: "method_not_allowed" }, 405);
  const data = await body(request);
  const offerId = String(data?.offerId || "").slice(0, 128);
  const idempotencyKey = String(data?.idempotencyKey || "").slice(0, 128);
  const offer = SHOP_OFFER_BY_ID.get(offerId);
  if (!offer || offer.status !== "active" || !offer.itemId || !IDEMPOTENCY_KEY.test(idempotencyKey)) return response({ error: "invalid_offer" }, 400);
  const item = MVP_ITEM_BY_ID.get(offer.itemId);
  if (!item || item.status !== "active") return response({ error: "item_unavailable" }, 409);

  const replay = await env.DB.prepare(`SELECT id, balance_after AS balanceAfter FROM shop_purchases
    WHERE player_id = ? AND idempotency_key = ?`).bind(claims.sub, idempotencyKey)
    .first<{ id: string; balanceAfter: number }>();
  if (replay) {
    const owned = await env.DB.prepare("SELECT quantity FROM inventory_balances WHERE player_id = ? AND item_id = ?")
      .bind(claims.sub, offer.itemId).first<{ quantity: number }>();
    return response({ purchaseId: replay.id, balance: replay.balanceAfter, itemId: offer.itemId, quantity: owned?.quantity || 0, replayed: true });
  }

  const now = Date.now();
  const purchaseId = crypto.randomUUID();
  const priorInventory = await env.DB.prepare("SELECT quantity FROM inventory_balances WHERE player_id = ? AND item_id = ?")
    .bind(claims.sub, offer.itemId).first<{ quantity: number }>();
  const inventoryAfter = (priorInventory?.quantity || 0) + offer.quantity;
  await env.DB.batch([
    // The purchase row is the transaction guard. If the account cannot afford
    // the offer no row is inserted, and every following statement is a no-op.
    env.DB.prepare(`INSERT INTO shop_purchases
      (id, player_id, offer_id, item_id, quantity, credits_spent, balance_after, idempotency_key, created_at)
      SELECT ?, player_id, ?, ?, ?, ?, balance - ?, ?, ? FROM credit_accounts
      WHERE player_id = ? AND balance >= ?`)
      .bind(purchaseId, offer.id, offer.itemId, offer.quantity, offer.price, offer.price, idempotencyKey, now, claims.sub, offer.price),
    env.DB.prepare(`UPDATE credit_accounts SET balance = balance - ?, updated_at = ?
      WHERE player_id = ? AND EXISTS (SELECT 1 FROM shop_purchases WHERE id = ?)`)
      .bind(offer.price, now, claims.sub, purchaseId),
    env.DB.prepare(`INSERT INTO inventory_balances (player_id, item_id, quantity, updated_at)
      SELECT ?, ?, ?, ? WHERE EXISTS (SELECT 1 FROM shop_purchases WHERE id = ?)
      ON CONFLICT(player_id, item_id) DO UPDATE SET quantity = inventory_balances.quantity + excluded.quantity, updated_at = excluded.updated_at`)
      .bind(claims.sub, offer.itemId, offer.quantity, now, purchaseId),
    env.DB.prepare(`INSERT INTO inventory_transactions
      (id, player_id, item_id, delta, balance_after, reason, reference_id, idempotency_key, status, created_at, committed_at)
      SELECT ?, ?, ?, ?, ?, 'shop_purchase', ?, ?, 'committed', ?, ?
      WHERE EXISTS (SELECT 1 FROM shop_purchases WHERE id = ?)`)
      .bind(crypto.randomUUID(), claims.sub, offer.itemId, offer.quantity, inventoryAfter, purchaseId, `shop-inventory:${idempotencyKey}`, now, now, purchaseId),
    env.DB.prepare(`INSERT INTO credit_ledger
      (id, player_id, delta, balance_after, reason, reference_id, idempotency_key, metadata_json, created_at)
      SELECT ?, ?, ?, balance_after, 'shop_purchase', ?, ?, ?, ? FROM shop_purchases WHERE id = ?`)
      .bind(crypto.randomUUID(), claims.sub, -offer.price, purchaseId, `shop-credit:${idempotencyKey}`, JSON.stringify({ offerId, itemId: offer.itemId, quantity: offer.quantity }), now, purchaseId),
  ]);
  const purchase = await env.DB.prepare("SELECT balance_after AS balanceAfter FROM shop_purchases WHERE id = ?")
    .bind(purchaseId).first<{ balanceAfter: number }>();
  if (!purchase) {
    const balance = await creditBalance(env, claims.sub);
    return response({ error: "insufficient_credits", balance, shortfall: Math.max(0, offer.price - balance) }, 409);
  }
  return response({ purchaseId, balance: purchase.balanceAfter, itemId: offer.itemId, quantity: inventoryAfter });
}

async function shopDailyClaim(request: Request, env: BackendEnv, claims: SessionClaims): Promise<Response> {
  if (request.method !== "POST") return response({ error: "method_not_allowed" }, 405);
  const data = await body(request);
  const idempotencyKey = String(data?.idempotencyKey || "").slice(0, 128);
  if (!IDEMPOTENCY_KEY.test(idempotencyKey)) return response({ error: "idempotency_required" }, 400);
  const day = utcDay();
  const prior = await env.DB.prepare("SELECT claimed_at AS claimedAt FROM shop_daily_claims WHERE player_id = ? AND claim_day = ?")
    .bind(claims.sub, day).first<{ claimedAt: number }>();
  if (prior) return response({ error: "already_claimed", claimedAt: prior.claimedAt }, 409);
  const now = Date.now();
  const statements: D1PreparedStatement[] = [
    env.DB.prepare("INSERT INTO shop_daily_claims (player_id, claim_day, claimed_at) VALUES (?, ?, ?)").bind(claims.sub, day, now),
  ];
  const inventory: Array<{ itemId: string; quantity: number }> = [];
  for (const [itemId, delta] of Object.entries(DAILY_SUPPLY)) {
    const current = await env.DB.prepare("SELECT quantity FROM inventory_balances WHERE player_id = ? AND item_id = ?")
      .bind(claims.sub, itemId).first<{ quantity: number }>();
    const next = (current?.quantity || 0) + delta;
    inventory.push({ itemId, quantity: next });
    statements.push(
      env.DB.prepare(`INSERT INTO inventory_balances (player_id, item_id, quantity, updated_at) VALUES (?, ?, ?, ?)
        ON CONFLICT(player_id, item_id) DO UPDATE SET quantity = inventory_balances.quantity + excluded.quantity, updated_at = excluded.updated_at`)
        .bind(claims.sub, itemId, delta, now),
      env.DB.prepare(`INSERT INTO inventory_transactions
        (id, player_id, item_id, delta, balance_after, reason, reference_id, idempotency_key, status, created_at, committed_at)
        VALUES (?, ?, ?, ?, ?, 'daily_supply', ?, ?, 'committed', ?, ?)`)
        .bind(crypto.randomUUID(), claims.sub, itemId, delta, next, day, `daily:${day}:${itemId}`, now, now),
    );
  }
  await env.DB.batch(statements);
  return response({ claimedAt: now, inventory });
}

const WARP_ATTEMPTS_PER_MINUTE = 10;

// ---- Shared world entry points (called by the WorldRoom, inside its world lock) ----

type AuthorityRow = { revision: number; game_json: string | null; world_json: string | null; economy_authority_version: number; updated_at: number };
const loadAuthorityRow = (env: BackendEnv, playerId: string) => env.DB.prepare(
  "SELECT revision, game_json, world_json, economy_authority_version, updated_at FROM player_state WHERE player_id = ?",
).bind(playerId).first<AuthorityRow>();

export async function sharedClaims(request: Request, env: BackendEnv): Promise<SessionClaims | null> {
  return authClaims(request, env);
}

/**
 * One-time move of an authority player into the shared world: their private world is
 * settled (fleets home, cargo delivered), progress carries over, and economy authority
 * becomes version 2. The private world_json is kept untouched as a rollback copy.
 * Returns an error response, or null when the player is in the shared world.
 */
export async function sharedCutover(env: BackendEnv, playerId: string, port: SharedWorldPort): Promise<Response | null> {
  if (port.has(playerId)) return null;
  const row = await loadAuthorityRow(env, playerId);
  if (!row?.economy_authority_version) return response({ error: "authority_disabled" }, 409);
  const now = Date.now();
  const numbers = defaultN();
  const projected = projectGameJson(row.game_json, now);
  if (!projected) return response({ error: "no_state" }, 409);
  let game: GameState = projected;
  let carry: SharedCarryOver | undefined;
  if (row.economy_authority_version === 1) {
    let session: unknown = null;
    try { session = row.world_json ? JSON.parse(row.world_json) : null; } catch {}
    if (isWorldAuthoritySession(session, playerId)) ({ game, carry } = retirePrivateWorld(session, projected, now, numbers));
  }
  await port.join(playerId, game, carry, now);
  const write = await env.DB.prepare(`UPDATE player_state SET game_json = ?, economy_authority_version = 2, revision = revision + 1, updated_at = ?
    WHERE player_id = ? AND revision = ?`).bind(JSON.stringify(game), now, playerId, row.revision).run();
  if (!write.meta.changes) { port.discard(); return response({ error: "revision_conflict" }, 409); }
  await port.commit();
  await env.DB.prepare(`INSERT INTO account_audit_log (id, player_id, action, metadata_json, created_at) VALUES (?, ?, 'shared_world_cutover', ?, ?)`)
    .bind(crypto.randomUUID(), playerId, JSON.stringify({ fromVersion: row.economy_authority_version }), now).run().catch(() => {});
  return null;
}

export async function sharedCommandRoute(request: Request, env: BackendEnv, claims: SessionClaims, port: SharedWorldPort): Promise<Response> {
  return commandRoute(request, env, claims, port);
}

/** GET /game for shared-world players: sync deliveries into game_json, return the player's slice. */
export async function sharedSyncRoute(env: BackendEnv, claims: SessionClaims, port: SharedWorldPort): Promise<Response> {
  try {
    const row = await loadAuthorityRow(env, claims.sub);
    const now = Date.now();
    const state = projectGameJson(row?.game_json, now);
    if (!row || !state) return response({ error: "no_state" }, 409);
    const applied = port.apply(claims.sub, state, { type: "world.advance", args: {} }, now);
    if (!applied.ok) return response({ game: state, world: null, revision: row.revision, authorityVersion: row.economy_authority_version, updatedAt: row.updated_at });
    const pick = (game: GameState) => JSON.stringify([game.troops, game.woundedTroops, game.wounded, game.res]);
    let revision = row.revision;
    if (pick(applied.game) !== pick(state)) {
      const write = await env.DB.prepare(`UPDATE player_state SET game_json = ?, revision = revision + 1, updated_at = ?
        WHERE player_id = ? AND revision = ?`).bind(JSON.stringify(applied.game), now, claims.sub, row.revision).run();
      // Lost a race with an economy command: keep the world as it was; the next read retries.
      if (!write.meta.changes) return response({ game: state, world: null, revision: row.revision, authorityVersion: row.economy_authority_version, updatedAt: row.updated_at });
      revision += 1;
    }
    await port.commit();
    return response({ game: applied.game, world: applied.session, revision, authorityVersion: row.economy_authority_version, updatedAt: now });
  } finally { port.discard(); }
}

// GM ops: world roster and map-slot release (docs/BETA-P0.md P0-2 ghost cleanup).
async function gmWorld(request: Request, env: BackendEnv, claims: SessionClaims, pathname: string): Promise<Response> {
  if (claims.role !== "gm") return response({ error: "gm_required" }, 403);
  if (!env.WORLD_ROOM) return response({ error: "world_unavailable" }, 503);
  const room = env.WORLD_ROOM.get(env.WORLD_ROOM.idFromName("frontier-1"));
  if (pathname === "/gm/world/roster") {
    if (request.method !== "GET") return response({ error: "method_not_allowed" }, 405);
    return response(await (await room.fetch("https://world.internal/roster")).json());
  }
  if (request.method !== "POST") return response({ error: "method_not_allowed" }, 405);
  const data = await body(request);
  const ids = Array.isArray(data?.ids) ? data.ids : [];
  if (pathname === "/gm/world/shield") {
    const res = await room.fetch("https://world.internal/grant-shield", { method: "POST", body: JSON.stringify({ ids, hours: data?.hours, mode: data?.mode }) });
    return response(await res.json());
  }
  const res = await room.fetch("https://world.internal/release", { method: "POST", body: JSON.stringify({ ids }) });
  return response(await res.json());
}

async function grantAlphaCredits(request: Request, env: BackendEnv, claims: SessionClaims): Promise<Response> {
  if (request.method !== "POST") return response({ error: "method_not_allowed" }, 405);
  if (claims.role !== "gm") return response({ error: "gm_required" }, 403);
  const data = await body(request);
  const idempotencyKey = String(data?.idempotencyKey || "").slice(0, 128);
  if (!IDEMPOTENCY_KEY.test(idempotencyKey)) return response({ error: "idempotency_required" }, 400);
  const prior = await env.DB.prepare("SELECT balance_after AS balanceAfter FROM credit_ledger WHERE player_id = ? AND idempotency_key = ?")
    .bind(claims.sub, idempotencyKey).first<{ balanceAfter: number }>();
  if (prior) return response({ balance: prior.balanceAfter, replayed: true });
  const before = await creditBalance(env, claims.sub);
  const delta = 25_000;
  const after = before + delta;
  const now = Date.now();
  await env.DB.batch([
    env.DB.prepare("UPDATE credit_accounts SET balance = ?, updated_at = ? WHERE player_id = ? AND balance = ?").bind(after, now, claims.sub, before),
    env.DB.prepare(`INSERT INTO credit_ledger
      (id, player_id, delta, balance_after, reason, idempotency_key, created_at)
      VALUES (?, ?, ?, ?, 'gm_alpha_test', ?, ?)`)
      .bind(crypto.randomUUID(), claims.sub, delta, after, idempotencyKey, now),
  ]);
  return response({ balance: after });
}

async function inventory(request: Request, env: BackendEnv, claims: SessionClaims): Promise<Response> {
  if (request.method !== "GET") return response({ error: "method_not_allowed" }, 405);
  return response({ inventory: await inventoryView(env, claims) });
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
  if (claims.role === "gm") return response({ itemId, quantity: UNLIMITED_ITEM_QUANTITY, effect: { speedupSeconds: item.speedupSeconds, speedupQueue: item.speedupQueue } });

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
  return response({ inventory: await inventoryView(env, claims) });
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
  const onCooldown = claims.role !== "gm" && !!player.last_renamed_at && now < nextFreeRenameAt;
  // A Rename Signal skips the cooldown; it is spent in the same batch as the rename.
  const useSignal = onCooldown && data?.useItem === true;
  if (onCooldown && !useSignal) return response({ error: "rename_cooldown", nextFreeRenameAt }, 429);
  if (useSignal) {
    const owned = await env.DB.prepare("SELECT quantity FROM inventory_balances WHERE player_id = ? AND item_id = 'identity.rename'").bind(claims.sub).first<{ quantity: number }>();
    if (!owned || owned.quantity < 1) return response({ error: "insufficient_inventory" }, 409);
  }
  try {
    await env.DB.batch([
      env.DB.prepare("UPDATE players SET display_name = ?, name_key = ?, last_renamed_at = ?, last_seen_at = ? WHERE id = ?")
        .bind(candidate.name, candidate.key, now, now, claims.sub),
      env.DB.prepare(`INSERT INTO account_audit_log (id, player_id, action, actor_player_id, metadata_json, created_at)
        VALUES (?, ?, 'profile.rename', ?, ?, ?)`).bind(crypto.randomUUID(), claims.sub, claims.sub, JSON.stringify({ from: player.display_name, to: candidate.name, signal: useSignal }), now),
      ...(useSignal ? [
        env.DB.prepare("UPDATE inventory_balances SET quantity = quantity - 1, updated_at = ? WHERE player_id = ? AND item_id = 'identity.rename' AND quantity >= 1").bind(now, claims.sub),
        env.DB.prepare(`INSERT INTO inventory_transactions (id, player_id, item_id, delta, balance_after, reason, idempotency_key, status, metadata_json, created_at, committed_at)
          VALUES (?, ?, 'identity.rename', -1, (SELECT quantity FROM inventory_balances WHERE player_id = ? AND item_id = 'identity.rename'), 'item_used', ?, 'committed', '{}', ?, ?)`)
          .bind(crypto.randomUUID(), claims.sub, claims.sub, `rename:${claims.sub}:${now}`, now, now),
      ] : []),
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
async function gameRoute(request: Request, env: BackendEnv, claims: SessionClaims): Promise<Response> {
  const row = await env.DB.prepare("SELECT revision, game_json, world_json, economy_authority_version, updated_at FROM player_state WHERE player_id = ?")
    .bind(claims.sub).first<{ revision: number; game_json: string | null; world_json: string | null; economy_authority_version: number; updated_at: number }>();
  // Authority players read through the shared world (deliveries land in game_json there).
  const room = worldRoom(env);
  if (room && (row?.economy_authority_version ?? 0) >= 1) {
    return room.fetch("https://world.internal/world/sync", { headers: { authorization: request.headers.get("authorization") || "" } });
  }
  const game = projectGameJson(row?.game_json, Date.now());
  let world: unknown = null;
  try { world = row?.world_json ? JSON.parse(row.world_json) : null; } catch {}
  // Beta: real players only. Older saves are cleaned for display here and persisted on the next command.
  const numbers = defaultN();
  if (isWorldAuthoritySession(world, claims.sub) && !simulatedCityCount(numbers)) {
    world.world = removeSimulatedCities(world.world, Date.now(), numbers);
  }
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
async function commandRoute(request: Request, env: BackendEnv, claims: SessionClaims, port?: SharedWorldPort): Promise<Response> {
  try { return await commandRouteInner(request, env, claims, port); } finally { port?.discard(); }
}

async function commandRouteInner(request: Request, env: BackendEnv, claims: SessionClaims, port?: SharedWorldPort): Promise<Response> {
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
  // World commands run inside the WorldRoom's shared world (it performs the one-time
  // cutover from the private world, then calls back into this route with a port).
  const room = worldRoom(env);
  if (!port && WORLD_COMMANDS.has(type) && room) {
    return room.fetch("https://world.internal/world/command", {
      method: "POST", headers: { authorization: request.headers.get("authorization") || "", "content-type": "application/json" }, body: JSON.stringify(data),
    });
  }
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
  let inventoryQuantity = 1;
  let scoutLaunch: { target: string; cost: number } | null = null;
  let itemGrants: Record<string, number> | null = null;
  let worldEffect: { shieldHours?: number; stamina?: number; marchBonus?: number; marchMinutes?: number } | null = null;
  let result: { state: typeof state; ok: boolean; reason?: string; world?: WorldAuthoritySession; extra?: Record<string, unknown> };
  const isWorldCommand = type === "world.advance" || type === "world.dispatch" || type === "world.recall" || type === "world.scan" || type === "world.warp";
  let warpReservation: { coord: { x: number; y: number }; previous: { x: number; y: number } | null } | null = null;
  if (isWorldCommand) {
    if (!world && !port) return response({ error: "world_authority_disabled" }, 409);
    if (world && !port) {
      // Private world (pre-cutover): the shared WorldRoom owns real-player coordinates.
      const home = await sharedWorldCoord(env, claims.sub);
      const homeCity = world.world.entities[world.world.players[world.playerId]?.cityId];
      if (home && homeCity?.kind === "city" && (homeCity.position.x !== home.x || homeCity.position.y !== home.y)) homeCity.position = home;
    }
    let command: WorldAuthorityCommand;
    if (type === "world.dispatch") {
      const action = String(args.action || "");
      if (!["scout", "gather", "attack_monster", "attack_city"].includes(action)) return response({ error: "invalid_command" }, 400);
      command = { type, args: { targetId: String(args.targetId || ""), action: action as any, force: args.force as any, dispatchKey: String(args.dispatchKey || idempotencyKey) } };
    } else if (type === "world.recall") {
      command = { type, args: { marchId: String(args.marchId || "") } };
    } else if (type === "world.scan") {
      command = { type, args: { requestedLevel: Math.max(1, Math.floor(Number(args.requestedLevel) || 1)) } };
    } else if (type === "world.warp") {
      const x = Number(args.x), y = Number(args.y);
      if (args.mode === "random") command = { type, args: { mode: "random" } };
      else if (Number.isFinite(x) && Number.isFinite(y)) command = { type, args: { mode: "precision", target: { x, y } } };
      else return response({ error: "invalid_command" }, 400);
    } else command = { type, args: {} };
    // Warp spends one relocation item; check the balance before simulating.
    const warpItemId = type === "world.warp" ? (args.mode === "random" ? "war.relocator.random" : "war.relocator.advanced") : null;
    const warpBalance = warpItemId
      ? await env.DB.prepare("SELECT quantity FROM inventory_balances WHERE player_id = ? AND item_id = ?").bind(claims.sub, warpItemId).first<{ quantity: number }>()
      : null;
    // Anti-probing (docs/BETA-P0.md P0-4): at most WARP_ATTEMPTS_PER_MINUTE warp
    // attempts per player; rejected attempts never spend the item.
    const recentWarps = type === "world.warp"
      ? await env.DB.prepare("SELECT COUNT(*) AS n FROM game_commands WHERE player_id = ? AND command_type = 'world.warp' AND created_at > ?")
        .bind(claims.sub, now - 60_000).first<{ n: number }>()
      : null;
    if (recentWarps && recentWarps.n >= WARP_ATTEMPTS_PER_MINUTE) {
      result = { state, ok: false, reason: "rate_limited", world: world ?? undefined };
    } else if (warpItemId && (!warpBalance || warpBalance.quantity < 1)) {
      result = { state, ok: false, reason: "no_warp_item", world: world ?? undefined };
    } else if (port) {
      const applied = port.apply(claims.sub, state, command, now);
      result = {
        state: applied.game, ok: applied.ok, reason: applied.reason, world: applied.session,
        extra: { targetId: applied.targetId, spawned: applied.spawned, position: applied.position },
      };
      if (warpItemId && applied.ok && applied.position) inventoryItemId = warpItemId;
    } else {
      const applied = applyWorldAuthorityCommand(world!, state, command, now, defaultN());
      result = {
        state: applied.game, ok: applied.ok, reason: applied.reason, world: applied.session,
        extra: { targetId: applied.targetId, spawned: applied.spawned, position: applied.position },
      };
      if (warpItemId && applied.ok && applied.position) {
        // The shared WorldRoom is the coordinate authority for real players: reserve first.
        const minSpacing = Number(defaultN().world?.warp?.minCitySpacing) || 6;
        const reserved = await reserveWorldCoord(env, claims.sub, applied.position, minSpacing);
        if (!reserved.ok) result = { state, ok: false, reason: reserved.error || "warp_rejected", world: world ?? undefined };
        else { inventoryItemId = warpItemId; warpReservation = { coord: applied.position, previous: reserved.previous ?? null }; }
      }
    }
  } else if (type === "speedup.use") {
    const itemId = String(args.itemId || "");
    const item = MVP_ITEM_BY_ID.get(itemId);
    const target = speedupTarget(args.target);
    if (!item || item.status !== "active" || item.category !== "speedup" || !item.speedupSeconds || !target || !speedupCompatible(item.speedupQueue, target)) {
      result = { state, ok: false, reason: "Invalid speedup" };
    } else {
      // Several of the same speedup in one order (the client auto-picks the count).
      const quantity = Math.max(1, Math.min(999, Math.floor(Number(args.quantity) || 1)));
      const applied = applySpeedup(state, target, item.speedupSeconds * quantity, now);
      result = applied.secondsApplied > 0
        ? { state: applied.state, ok: true }
        : { state, ok: false, reason: "That operation has already finished" };
      if (result.ok) { inventoryItemId = itemId; inventoryQuantity = quantity; }
    }
  } else if (type === "item.use") {
    // Non-speedup items from the Warehouse (docs/ITEMS.md). Speedups use speedup.use; warp
    // jumps are spent by world.warp; the Rename Signal is spent by /profile/name.
    const itemId = String(args.itemId || "");
    const item = MVP_ITEM_BY_ID.get(itemId);
    const effect = item?.status === "active" ? item.effect : undefined;
    const quantity = Math.max(1, Math.min(effect?.kind === "chest" ? 20 : 99, Math.floor(Number(args.quantity) || 1)));
    if (!item || !effect) result = { state, ok: false, reason: "invalid_item" };
    else if (effect.kind === "warp" || effect.kind === "rename") result = { state, ok: false, reason: "use_elsewhere" };
    else {
      inventoryItemId = itemId; inventoryQuantity = quantity;
      if (effect.kind === "resource") {
        result = { state: { ...state, res: { ...state.res, [effect.resource]: (state.res[effect.resource] || 0) + effect.amount * quantity } }, ok: true };
      } else if (effect.kind === "chest") {
        itemGrants = rollChest(effect.table, quantity);
        result = { state, ok: true, extra: { loot: itemGrants } };
      } else {
        worldEffect = effect.kind === "shield" ? { shieldHours: effect.hours * quantity }
          : effect.kind === "stamina" ? { stamina: effect.amount * quantity }
            : { marchBonus: effect.bonus, marchMinutes: effect.minutes * quantity };
        result = { state, ok: true };
      }
    }
  } else if (type === "world.scout_player") {
    // Paid scout on another commander (numbers.json global.march.scoutCost): the WorldRoom
    // quotes the distance, Oil is debited here with the save, then the fleet launches.
    const target = String(args.target || "").slice(0, 64);
    const room = worldRoom(env);
    const quote: { ok?: boolean; error?: string; distance?: number } = room && target
      ? await room.fetch("https://world.internal/scout-quote", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ player: claims.sub, target }) })
        .then((res) => res.json() as Promise<{ ok?: boolean; error?: string; distance?: number }>).catch(() => ({ ok: false, error: "world_unreachable" }))
      : { ok: false, error: "invalid_target" };
    if (!quote.ok) result = { state, ok: false, reason: quote.error || "scout_rejected" };
    else {
      const cost = scoutOilCost(state, Number(quote.distance) || 0, defaultN());
      if ((state.res.oil || 0) < cost) result = { state, ok: false, reason: "not_enough_oil" };
      else {
        result = { state: { ...state, res: { ...state.res, oil: state.res.oil - cost } }, ok: true, extra: { scoutCost: cost } };
        scoutLaunch = { target, cost };
      }
    }
  } else if (type.startsWith("gm.")) {
    // Server GM tools (the city page GM panel) on the GM's own account only.
    result = claims.role !== "gm" ? { state, ok: false, reason: "gm_required" } : gmCommand(state, type, args, claims.sub, now);
  } else {
    result = applyCommand(state, type, args);
  }
  const reason = result.ok ? null : result.reason || "rejected";
  const resultRevision = result.ok ? revision + 1 : revision;
  const encoded = JSON.stringify(result.state);
  // Shared-world players keep their retired private world untouched as a rollback copy.
  const encodedWorld = port ? null : result.world ? JSON.stringify(result.world) : row.world_json;
  if (encoded.length > 250_000) return response({ error: "state_too_large" }, 413);
  if (encodedWorld && encodedWorld.length > WORLD_STATE_BYTES) return response({ error: "world_state_too_large" }, 413);
  const commandId = crypto.randomUUID();
  const guardId = crypto.randomUUID();
  // GM accounts hold every item without limit: the item is recorded on the command but never debited.
  const unlimitedItems = claims.role === "gm";
  const inventoryTransactionId = inventoryItemId && !unlimitedItems ? crypto.randomUUID() : null;
  const inventoryBefore = inventoryItemId && !unlimitedItems
    ? await env.DB.prepare("SELECT quantity FROM inventory_balances WHERE player_id = ? AND item_id = ?")
      .bind(claims.sub, inventoryItemId).first<{ quantity: number }>()
    : null;
  if (inventoryItemId && !unlimitedItems && (!inventoryBefore || inventoryBefore.quantity < inventoryQuantity)) {
    if (warpReservation?.previous) await reserveWorldCoord(env, claims.sub, warpReservation.previous, 0, true);
    return response({ error: "insufficient_inventory" }, 409);
  }
  try {
    const insert = env.DB.prepare(`INSERT INTO game_commands
      (id, player_id, idempotency_key, command_type, args_hash, args_json, ok, reason, base_revision, result_revision,
       result_game_json, created_at, inventory_item_id, inventory_quantity, inventory_transaction_id)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .bind(commandId, claims.sub, idempotencyKey, type, fingerprint, argsJson, result.ok ? 1 : 0, reason, revision, resultRevision,
        result.ok ? encoded : null, now, inventoryItemId, inventoryItemId ? inventoryQuantity : null, inventoryTransactionId);
    if (!result.ok) {
      await insert.run();
    } else {
      const statements: D1PreparedStatement[] = [insert];
      if (inventoryItemId && inventoryBefore && inventoryTransactionId) {
        const expectedBalance = inventoryBefore.quantity - inventoryQuantity;
        statements.push(
          env.DB.prepare("UPDATE inventory_balances SET quantity = quantity - ?, updated_at = ? WHERE player_id = ? AND item_id = ? AND quantity >= ?")
            .bind(inventoryQuantity, now, claims.sub, inventoryItemId, inventoryQuantity),
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
          VALUES (?, ?, ?, ?, (SELECT quantity FROM inventory_balances WHERE player_id = ? AND item_id = ?),
            'item_used', ?, ?, 'committed', '{}', ?, ?)`)
          .bind(inventoryTransactionId, claims.sub, inventoryItemId, -inventoryQuantity, claims.sub, inventoryItemId, commandId, `command:${idempotencyKey}`, now, now));
      }
      // Chest loot lands in the same transaction as the chest being spent.
      for (const [grantId, grantQuantity] of Object.entries(itemGrants ?? {})) {
        statements.push(
          env.DB.prepare(`INSERT INTO inventory_balances (player_id, item_id, quantity, updated_at) VALUES (?, ?, ?, ?)
            ON CONFLICT(player_id, item_id) DO UPDATE SET quantity = inventory_balances.quantity + excluded.quantity, updated_at = excluded.updated_at`)
            .bind(claims.sub, grantId, grantQuantity, now),
          env.DB.prepare(`INSERT INTO inventory_transactions
            (id, player_id, item_id, delta, balance_after, reason, reference_id, idempotency_key, status, metadata_json, created_at, committed_at)
            VALUES (?, ?, ?, ?, (SELECT quantity FROM inventory_balances WHERE player_id = ? AND item_id = ?), 'chest_opened', ?, ?, 'committed', '{}', ?, ?)`)
            .bind(crypto.randomUUID(), claims.sub, grantId, grantQuantity, claims.sub, grantId, commandId, `command:${idempotencyKey}:${grantId}`, now, now),
        );
      }
      statements.push(
        env.DB.prepare("UPDATE game_commands SET result_game_json = NULL WHERE id = ?").bind(commandId),
        env.DB.prepare("DELETE FROM command_transaction_guards WHERE id IN (?, ?)").bind(`${guardId}:inventory`, `${guardId}:state`),
      );
      await env.DB.batch(statements);
      if (port) await port.commit();
    }
  } catch (error) {
    // The D1 commit lost: give the shared coordinate back before replying.
    if (warpReservation?.previous) await reserveWorldCoord(env, claims.sub, warpReservation.previous, 0, true);
    const racedReplay = await replayCommand(env, claims, idempotencyKey, fingerprint);
    if (racedReplay) return racedReplay;
    if (error instanceof Error && error.message.includes("insufficient_inventory")) return response({ error: "insufficient_inventory" }, 409);
    return response({ error: "revision_conflict" }, 409);
  }
  if (result.ok && worldEffect && inventoryItemId) {
    // The item is paid; apply its world effect. If the room refuses, give the items back.
    const room = worldRoom(env);
    const applied: { ok?: boolean; error?: string } = room
      ? await room.fetch("https://world.internal/player-effect", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ player: claims.sub, ...worldEffect }) })
        .then((res) => res.json() as Promise<{ ok?: boolean; error?: string }>).catch(() => ({ ok: false, error: "world_unreachable" }))
      : { ok: false, error: "world_unreachable" };
    if (!applied.ok) {
      if (!unlimitedItems) await env.DB.batch([
        env.DB.prepare("UPDATE inventory_balances SET quantity = quantity + ?, updated_at = ? WHERE player_id = ? AND item_id = ?").bind(inventoryQuantity, Date.now(), claims.sub, inventoryItemId),
        env.DB.prepare(`INSERT INTO inventory_transactions (id, player_id, item_id, delta, balance_after, reason, idempotency_key, status, metadata_json, created_at, committed_at)
          VALUES (?, ?, ?, ?, (SELECT quantity FROM inventory_balances WHERE player_id = ? AND item_id = ?), 'item_refunded', ?, 'committed', '{}', ?, ?)`)
          .bind(crypto.randomUUID(), claims.sub, inventoryItemId, inventoryQuantity, claims.sub, inventoryItemId, `command:${idempotencyKey}:refund`, Date.now(), Date.now()),
      ]);
      return response({ ok: false, reason: applied.error || "effect_rejected", game: result.state, revision: resultRevision, authorityVersion: row.economy_authority_version });
    }
    result.extra = { ...(result.extra ?? {}), effect: applied };
  }
  if (result.ok && scoutLaunch) {
    // The Oil is paid; launch the fleet. If the room refuses (a race), give the Oil back.
    const room = worldRoom(env);
    const launched = room
      ? await room.fetch("https://world.internal/scout-launch", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ player: claims.sub, target: scoutLaunch.target, cost: scoutLaunch.cost }) })
        .then((res) => res.json() as Promise<{ ok?: boolean; error?: string }>).catch(() => ({ ok: false, error: "world_unreachable" }))
      : { ok: false, error: "world_unreachable" };
    if (!launched.ok) {
      const refunded = { ...result.state, res: { ...result.state.res, oil: result.state.res.oil + scoutLaunch.cost } };
      await env.DB.prepare("UPDATE player_state SET game_json = ?, revision = revision + 1, updated_at = ? WHERE player_id = ? AND revision = ?")
        .bind(JSON.stringify(refunded), Date.now(), claims.sub, resultRevision).run();
      return response({ ok: false, reason: launched.error || "scout_rejected", game: refunded, revision: resultRevision + 1, authorityVersion: row.economy_authority_version });
    }
  }
  const inventory = inventoryItemId && unlimitedItems ? { itemId: inventoryItemId, quantity: UNLIMITED_ITEM_QUANTITY }
    : inventoryItemId ? await env.DB.prepare("SELECT item_id AS itemId, quantity FROM inventory_balances WHERE player_id = ? AND item_id = ?")
      .bind(claims.sub, inventoryItemId).first<{ itemId: string; quantity: number }>()
    : null;
  return response({
    ok: result.ok, reason: reason || undefined, game: result.ok ? result.state : state,
    world: port ? result.world : result.ok ? result.world || world : world, revision: resultRevision,
    authorityVersion: port ? 2 : row.economy_authority_version,
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
  if (!["/me", "/profile/name", "/feedback", "/events", "/state", "/game", "/game/authority/enable", "/command", "/inventory", "/inventory/history", "/inventory/consume", "/inventory/grant-alpha", "/shop/account", "/shop/purchase", "/shop/daily-claim", "/shop/grant-alpha", "/gm/world/roster", "/gm/world/release", "/gm/world/shield"].includes(pathname)) return null;
  const claims = await authClaims(request, env);
  if (!claims) return response({ error: "unauthorized" }, 401);
  if (request.method === "GET" && pathname === "/me") return me(request, env, claims);
  if (pathname === "/profile/name") return renamePlayer(request, env, claims);
  if (pathname === "/feedback") return submitFeedback(request, env, claims);
  if (request.method === "POST" && pathname === "/events") return storeEvents(request, env, claims);
  if ((request.method === "GET" || request.method === "PUT") && pathname === "/state") return stateRoute(request, env, claims);
  if (request.method === "GET" && pathname === "/game") return gameRoute(request, env, claims);
  if (request.method === "POST" && pathname === "/game/authority/enable") return enableGameAuthority(request, env, claims);
  if (request.method === "POST" && pathname === "/command") return commandRoute(request, env, claims);
  if (pathname === "/inventory") return inventory(request, env, claims);
  if (pathname === "/inventory/history") return inventoryHistory(request, env, claims);
  if (request.method === "POST" && pathname === "/inventory/consume") return consumeInventory(request, env, claims);
  if (request.method === "POST" && pathname === "/inventory/grant-alpha") return grantAlphaInventory(request, env, claims);
  if (pathname === "/shop/account") return shopAccount(request, env, claims);
  if (pathname === "/shop/purchase") return shopPurchase(request, env, claims);
  if (pathname === "/shop/daily-claim") return shopDailyClaim(request, env, claims);
  if (pathname === "/shop/grant-alpha") return grantAlphaCredits(request, env, claims);
  if (pathname === "/gm/world/roster" || pathname === "/gm/world/release" || pathname === "/gm/world/shield") return gmWorld(request, env, claims, pathname);
  return response({ error: "method_not_allowed" }, 405);
}

function gmCommand(state: GameState, type: string, args: Record<string, unknown>, playerId: string, now: number): { state: GameState; ok: boolean; reason?: string } {
  switch (type) {
    case "gm.fill_resources": return { state: gmFillResources(state, now), ok: true };
    case "gm.fill_troops": return { state: gmFillTroops(state, now), ok: true };
    case "gm.finish_queues": return { state: gmFinishQueues(state, now), ok: true };
    case "gm.max_research": return { state: gmMaxResearch(state, now), ok: true };
    case "gm.raise_townhall": return { state: gmRaiseTownhall(state, now), ok: true };
    case "gm.raise_building": {
      const building = String(args.building || "") as BKey;
      if (!BUILDING_ORDER.includes(building)) return { state, ok: false, reason: "Unknown building" };
      return { state: gmRaiseBuilding(state, building, now), ok: true };
    }
    case "gm.reset": return { state: gmResetProgress(playerId, now), ok: true };
    default: return { state, ok: false, reason: "Unknown GM command" };
  }
}
