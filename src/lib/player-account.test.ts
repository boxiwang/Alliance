import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { CHAT_SIGNALS, GAME_CURSORS, MARCH_SIGNATURES, PLANET_HALOS, PLANET_ORBITS, PLANET_SKINS, TITLE_SEALS, loadCosmeticVault, loadPlayerAccount, ownsChatSignal, ownsGameCursor, ownsMarchSignature, ownsPlanetHalo, ownsPlanetOrbit, ownsPlanetSkin, ownsTitleSeal, savePlayerAccount } from "./player-account";

describe("player account persistence", () => {
  beforeEach(() => {
    const values = new Map<string, string>();
    Object.defineProperty(globalThis, "localStorage", {
      configurable: true,
      value: {
        getItem: (key: string) => values.get(key) ?? null,
        setItem: (key: string, value: string) => values.set(key, value),
        removeItem: (key: string) => values.delete(key),
        clear: () => values.clear(),
      },
    });
  });

  afterEach(() => {
    Reflect.deleteProperty(globalThis, "window");
  });

  it("keeps a stable internal id separate from the wallet address", () => {
    const first = loadPlayerAccount("0xABC123");
    const second = loadPlayerAccount("0xabc123");
    expect(first.playerId).toBe(second.playerId);
    expect(first.playerId).toMatch(/^PLY-[0-9A-F]{8}$/);
    expect(first.loginMethod).toBe("wallet");
  });

  it("resolves linked wallets back to the same player account", () => {
    const account = loadPlayerAccount("0xabc123");
    savePlayerAccount({ ...account, linkedWallets: [...account.linkedWallets, "0xdef456"] });
    expect(loadPlayerAccount("0xdef456").playerId).toBe(account.playerId);
    expect(loadPlayerAccount("0xdef456").primaryWallet).toBe("0xabc123");
  });

  it("migrates incomplete stored settings without losing defaults", () => {
    const account = loadPlayerAccount("0xabc123");
    savePlayerAccount({ ...account, language: "zh-CN", credits: 320 });
    const restored = loadPlayerAccount("0xAbC123");
    expect(restored.language).toBe("zh-CN");
    expect(restored.credits).toBe(320);
    expect(restored.musicEnabled).toBe(true);
    expect(restored.musicVolume).toBe(1);
    expect(restored.consents.digitalAssets.version).toBeTruthy();
  });

  it("persists and clamps the player-selected music mix", () => {
    const account = loadPlayerAccount("0xabc123");
    savePlayerAccount({ ...account, musicVolume: .37 });
    expect(loadPlayerAccount("0xabc123").musicVolume).toBe(.37);
    localStorage.setItem(`ruglands:account:${account.playerId.toLowerCase()}`, JSON.stringify({ ...account, musicVolume: 9 }));
    expect(loadPlayerAccount("0xabc123").musicVolume).toBe(1);
  });

  it("allows a Google login to exist before a wallet is linked", () => {
    const account = loadPlayerAccount("google:commander@example.test");
    savePlayerAccount({ ...account, loginMethod: "google", primaryWallet: null, linkedWallets: [] });
    const restored = loadPlayerAccount("google:commander@example.test");
    expect(restored.loginMethod).toBe("google");
    expect(restored.primaryWallet).toBeNull();
    expect(restored.linkedWallets).toEqual([]);
  });

  it("always grants the issued frontier Core", () => {
    const vault = loadCosmeticVault("0xabc123");
    expect(ownsPlanetSkin(vault, "dust-homestead")).toBe(true);
    expect(PLANET_SKINS.map((skin) => skin.id)).toEqual([
      "dust-homestead", "blue-marble", "void-touched", "sovereign-core", "event-horizon", "solar-imperator",
    ]);
    expect(ownsPlanetHalo(vault, "faint-corona")).toBe(true);
    expect(ownsPlanetOrbit(vault, "survey-ring")).toBe(true);
    expect(ownsMarchSignature(vault, "ion-wake")).toBe(true);
    expect(ownsChatSignal(vault, "clear-channel")).toBe(true);
    expect(ownsGameCursor(vault, "reticle")).toBe(true);
    expect(ownsTitleSeal(vault, "frontier-born")).toBe(true);
  });

  it("unlocks every live cosmetic renderer when local GM mode is requested", () => {
    Object.defineProperty(globalThis, "window", {
      configurable: true,
      value: { location: { hostname: "localhost", search: "?profile&gm" } },
    });
    const vault = loadCosmeticVault("0xabc123");
    expect(PLANET_SKINS.every((skin) => ownsPlanetSkin(vault, skin.id))).toBe(true);
    expect(PLANET_HALOS.every((halo) => ownsPlanetHalo(vault, halo.id))).toBe(true);
    expect(PLANET_ORBITS.every((orbit) => ownsPlanetOrbit(vault, orbit.id))).toBe(true);
    expect(MARCH_SIGNATURES.every((signature) => ownsMarchSignature(vault, signature.id))).toBe(true);
    expect(CHAT_SIGNALS.every((signal) => ownsChatSignal(vault, signal.id))).toBe(true);
    expect(GAME_CURSORS.every((cursor) => ownsGameCursor(vault, cursor.id))).toBe(true);
    expect(TITLE_SEALS.every((title) => ownsTitleSeal(vault, title.id))).toBe(true);
  });

  it("preserves deliberately released optional cosmetic slots", () => {
    localStorage.setItem("ruglands:cosmetics:0xabc123", JSON.stringify({
      owned: [],
      equipped: { halo: null, orbit: null, marchSignature: null, chatSignal: null, title: null, cursor: null },
    }));
    const equipped = loadCosmeticVault("0xabc123").equipped;
    expect(equipped.halo).toBeNull();
    expect(equipped.orbit).toBeNull();
    expect(equipped.marchSignature).toBeNull();
    expect(equipped.chatSignal).toBeNull();
    expect(equipped.title).toBeNull();
    expect(equipped.cursor).toBeNull();
    expect(equipped.planetBody).toBe("dust-homestead");
  });

  it("falls back safely when a pre-Genesis march signature is stored", () => {
    localStorage.setItem("ruglands:cosmetics:0xabc123", JSON.stringify({
      owned: ["march:void-scar"],
      equipped: { marchSignature: "void-scar" },
    }));
    expect(loadCosmeticVault("0xabc123").equipped.marchSignature).toBe("ion-wake");
  });

  it("migrates the retired Civic Core into Dust Homestead", () => {
    localStorage.setItem("ruglands:cosmetics:0xabc123", JSON.stringify({
      owned: ["planet:civic-core"],
      equipped: { planetBody: "civic-core" },
    }));
    const vault = loadCosmeticVault("0xabc123");
    expect(vault.equipped.planetBody).toBe("dust-homestead");
    expect(ownsPlanetSkin(vault, "dust-homestead")).toBe(true);
    expect(vault.owned).not.toContain("planet:civic-core");
  });

  it("migrates the prototype halo slot into the issued Survey Ring", () => {
    localStorage.setItem("ruglands:cosmetics:0xabc123", JSON.stringify({
      owned: ["halo:orbit-one"],
      equipped: { halo: "orbit-one" },
    }));
    const vault = loadCosmeticVault("0xabc123");
    expect(vault.equipped.orbit).toBe("survey-ring");
    expect(vault.equipped.halo).toBe("faint-corona");
    expect(ownsPlanetOrbit(vault, "survey-ring")).toBe(true);
  });
});
