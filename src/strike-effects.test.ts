import { describe, expect, it } from "vitest";
import { STRIKE_SIGNATURES } from "./lib/player-account";
import {
  STRIKE_EFFECT_DURATION_MS, STRIKE_EFFECT_FRAME_BUCKETS, STRIKE_EFFECT_FRAME_SIZE, STRIKE_EFFECT_IDS,
  STRIKE_EFFECT_STAGES, STRIKE_EFFECT_WORLD_SIZE, strikeEffectFrameKey,
} from "./strike-effects";

describe("strike effect registry", () => {
  it("keeps every live Relic Vault imprint backed by a Starmap renderer", () => {
    expect(STRIKE_EFFECT_IDS).toEqual(STRIKE_SIGNATURES.map((signature) => signature.id));
    STRIKE_EFFECT_IDS.forEach((id) => {
      expect(STRIKE_EFFECT_DURATION_MS[id]).toBeGreaterThanOrEqual(900);
      expect(STRIKE_EFFECT_FRAME_SIZE[id]).toBeGreaterThanOrEqual(300);
      expect(STRIKE_EFFECT_WORLD_SIZE[id]).toBeGreaterThanOrEqual(230);
      expect(STRIKE_EFFECT_STAGES[id]).toContain("·");
    });
  });

  it("reserves longer, larger compositions for SSR and UR imprints", () => {
    expect(STRIKE_EFFECT_DURATION_MS["rift-guillotine"]).toBeGreaterThan(STRIKE_EFFECT_DURATION_MS["comet-break"]);
    expect(STRIKE_EFFECT_DURATION_MS["whalefall-protocol"]).toBeGreaterThan(STRIKE_EFFECT_DURATION_MS["solar-bloom"]);
    expect(STRIKE_EFFECT_FRAME_SIZE["finality-engine"]).toBeGreaterThan(STRIKE_EFFECT_FRAME_SIZE["blockfall"]);
    expect(STRIKE_EFFECT_WORLD_SIZE["whalefall-protocol"]).toBeGreaterThan(STRIKE_EFFECT_WORLD_SIZE["vector-snap"]);
  });

  it("quantizes shared frames so concurrent copies reuse the full-quality render", () => {
    expect(strikeEffectFrameKey("whalefall-protocol", .5001)).toBe(strikeEffectFrameKey("whalefall-protocol", .5002));
    expect(strikeEffectFrameKey("vector-snap", -1)).toBe("vector-snap:0");
    expect(strikeEffectFrameKey("vector-snap", 2)).toBe("vector-snap:9");
    expect(Object.values(STRIKE_EFFECT_FRAME_BUCKETS).reduce((sum, value) => sum + value, 0)).toBe(108);
  });
});
