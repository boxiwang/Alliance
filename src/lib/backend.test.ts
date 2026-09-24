import { beforeEach, describe, expect, it, vi } from "vitest";
import { clearBackendSession, loadBackendSession, loadLastBackendSession, resumeBackendSession, saveBackendSession, type BackendSession } from "./backend";

class MemoryStorage {
  private values = new Map<string, string>();
  getItem(key: string) { return this.values.get(key) ?? null; }
  setItem(key: string, value: string) { this.values.set(key, value); }
  removeItem(key: string) { this.values.delete(key); }
  key(index: number) { return [...this.values.keys()][index] ?? null; }
  get length() { return this.values.size; }
}

const address = "0xbb1d63c5af5d97963671c8bd8a5f73a7ebad1d1c";

function session(): BackendSession {
  return {
    token: "signed-session",
    expiresAt: Date.now() + 60_000,
    player: { id: address, displayName: "Commander", role: "player", authMethod: "wallet", walletAddress: address },
  };
}

beforeEach(() => {
  Object.assign(globalThis, { localStorage: new MemoryStorage() });
  vi.restoreAllMocks();
});

describe("backend session resume", () => {
  it("remembers the last wallet and resumes only after /me validates the token", async () => {
    saveBackendSession(session());
    expect(loadLastBackendSession()?.player.id).toBe(address);
    vi.stubGlobal("fetch", vi.fn(async () => Response.json({ player: { ...session().player, displayName: "Verified Commander" } })));

    const resumed = await resumeBackendSession();
    expect(resumed?.player.displayName).toBe("Verified Commander");
    expect(fetch).toHaveBeenCalledWith(expect.stringContaining("/me"), expect.objectContaining({ headers: { authorization: "Bearer signed-session" } }));
  });

  it("removes a cached session when the backend rejects it", async () => {
    saveBackendSession(session());
    vi.stubGlobal("fetch", vi.fn(async () => Response.json({ error: "unauthorized" }, { status: 401 })));

    expect(await resumeBackendSession()).toBeNull();
    expect(loadBackendSession(address)).toBeNull();
    clearBackendSession(address);
    expect(loadLastBackendSession()).toBeNull();
  });
});
