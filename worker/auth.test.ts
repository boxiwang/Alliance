import { describe, expect, it } from "vitest";
import { issueSession, normalizedWallet, synthAddress, verifySession } from "./auth";

describe("backend sessions", () => {
  it("accepts an intact session and rejects a changed signature", async () => {
    const token = await issueSession("test-secret", { sub: "player-1", method: "guest", role: "player" }, 60);
    expect((await verifySession("test-secret", token))?.sub).toBe("player-1");
    expect(await verifySession("wrong-secret", token)).toBeNull();
    expect(await verifySession("test-secret", `${token.slice(0, -1)}x`)).toBeNull();
  });

  it("normalizes valid wallets and rejects non-address identities", () => {
    expect(normalizedWallet("0xBB1D63C5AF5D97963671C8BD8A5F73A7EBAD1D1C"))
      .toBe("0xbb1d63c5af5d97963671c8bd8a5f73a7ebad1d1c");
    expect(normalizedWallet("guest:someone")).toBeNull();
  });

  it("derives stable synthetic addresses", () => {
    expect(synthAddress("google:abc")).toBe(synthAddress("google:abc"));
    expect(synthAddress("google:abc")).toMatch(/^0x[0-9a-f]{40}$/);
    expect(synthAddress("google:abc")).not.toBe(synthAddress("google:def"));
  });
});
