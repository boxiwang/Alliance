import { createRemoteJWKSet, jwtVerify } from "jose";
import { verifyMessage } from "viem";

export type AuthMethod = "wallet" | "google" | "guest";
export type PlayerRole = "player" | "gm";

export type SessionClaims = {
  sub: string;
  method: AuthMethod;
  role: PlayerRole;
  sid: string;
  iat: number;
  exp: number;
};

const encoder = new TextEncoder();
const GOOGLE_JWKS = createRemoteJWKSet(new URL("https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com"));

function bytesToBase64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function base64UrlToBytes(value: string): Uint8Array {
  const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
  const binary = atob(normalized + "=".repeat((4 - normalized.length % 4) % 4));
  return Uint8Array.from(binary, (char) => char.charCodeAt(0));
}

function jsonPart(value: unknown): string {
  return bytesToBase64Url(encoder.encode(JSON.stringify(value)));
}

async function hmac(secret: string, value: string): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey("raw", encoder.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return new Uint8Array(await crypto.subtle.sign("HMAC", key, encoder.encode(value)));
}

export async function hashSecret(value: string): Promise<string> {
  return bytesToBase64Url(new Uint8Array(await crypto.subtle.digest("SHA-256", encoder.encode(value))));
}

export function randomSecret(bytes = 32): string {
  const value = new Uint8Array(bytes);
  crypto.getRandomValues(value);
  return bytesToBase64Url(value);
}

export async function issueSession(secret: string, input: Omit<SessionClaims, "sid" | "iat" | "exp">, lifetimeSec = 24 * 60 * 60): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  const claims: SessionClaims = { ...input, sid: crypto.randomUUID(), iat: now, exp: now + lifetimeSec };
  const unsigned = `${jsonPart({ alg: "HS256", typ: "JWT" })}.${jsonPart(claims)}`;
  return `${unsigned}.${bytesToBase64Url(await hmac(secret, unsigned))}`;
}

export async function verifySession(secret: string, token: string): Promise<SessionClaims | null> {
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  const expected = await hmac(secret, `${parts[0]}.${parts[1]}`);
  const actual = base64UrlToBytes(parts[2]);
  if (actual.length !== expected.length) return null;
  let mismatch = 0;
  for (let index = 0; index < actual.length; index += 1) mismatch |= actual[index] ^ expected[index];
  if (mismatch !== 0) return null;
  try {
    const claims = JSON.parse(new TextDecoder().decode(base64UrlToBytes(parts[1]))) as SessionClaims;
    if (!claims.sub || !claims.sid || !["wallet", "google", "guest"].includes(claims.method)) return null;
    if (!Number.isFinite(claims.exp) || claims.exp <= Math.floor(Date.now() / 1000)) return null;
    return claims;
  } catch {
    return null;
  }
}

export function bearerToken(request: Request): string {
  const header = request.headers.get("authorization") || "";
  return header.startsWith("Bearer ") ? header.slice(7).trim() : "";
}

export function normalizedWallet(value: unknown): `0x${string}` | null {
  const address = String(value || "").trim().toLowerCase();
  return /^0x[0-9a-f]{40}$/.test(address) ? address as `0x${string}` : null;
}

export function synthAddress(seed: string): string {
  let h = 2166136261 >>> 0;
  for (let index = 0; index < seed.length; index += 1) {
    h ^= seed.charCodeAt(index);
    h = Math.imul(h, 16777619) >>> 0;
  }
  let hex = "";
  let x = h;
  while (hex.length < 40) {
    x = Math.imul(x ^ (x >>> 15), 2246822507) >>> 0;
    hex += x.toString(16).padStart(8, "0");
  }
  return `0x${hex.slice(0, 40)}`;
}

export async function verifyWalletSignature(address: `0x${string}`, message: string, signature: string): Promise<boolean> {
  try {
    return await verifyMessage({ address, message, signature: signature as `0x${string}` });
  } catch {
    return false;
  }
}

export async function verifyFirebaseToken(token: string, projectId: string): Promise<{ uid: string; email: string | null; name: string | null } | null> {
  if (!projectId || token.length > 10_000) return null;
  try {
    const { payload } = await jwtVerify(token, GOOGLE_JWKS, {
      audience: projectId,
      issuer: `https://securetoken.google.com/${projectId}`,
      algorithms: ["RS256"],
    });
    if (!payload.sub || typeof payload.sub !== "string") return null;
    const firebase = payload.firebase as { sign_in_provider?: string } | undefined;
    if (firebase?.sign_in_provider !== "google.com") return null;
    return {
      uid: payload.sub,
      email: typeof payload.email === "string" ? payload.email.toLowerCase() : null,
      name: typeof payload.name === "string" ? payload.name : null,
    };
  } catch {
    return null;
  }
}
