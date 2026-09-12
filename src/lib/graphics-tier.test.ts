import { describe, expect, it } from "vitest";
import { detectAutoTier, resolveGraphicsQuality, TIER_PRESETS } from "./graphics-tier";

describe("detectAutoTier", () => {
  it("floors weak or tiny devices to low", () => {
    expect(detectAutoTier({ cores: 2, memoryGB: 2, dpr: 1, screenMaxEdge: 1440 })).toBe("low");
    expect(detectAutoTier({ cores: 8, memoryGB: 8, dpr: 3, screenMaxEdge: 812 })).toBe("low"); // phone
  });
  it("gives Retina high-core machines ultra, non-Retina high", () => {
    expect(detectAutoTier({ cores: 10, memoryGB: 16, dpr: 2, screenMaxEdge: 1800 })).toBe("ultra");
    expect(detectAutoTier({ cores: 8, memoryGB: 8, dpr: 1, screenMaxEdge: 1920 })).toBe("high");
  });
  it("puts mid machines at medium", () => {
    expect(detectAutoTier({ cores: 4, memoryGB: 4, dpr: 1, screenMaxEdge: 1440 })).toBe("medium");
  });
});

describe("resolveGraphicsQuality", () => {
  it("returns the pinned preset unchanged when not auto", () => {
    expect(resolveGraphicsQuality("ultra")).toEqual(TIER_PRESETS.ultra);
    expect(resolveGraphicsQuality("low")).toEqual(TIER_PRESETS.low);
  });
  it("eases auto down a step on battery and per FPS demotions, but never below low", () => {
    expect(resolveGraphicsQuality("auto", { autoTier: "ultra", unplugged: true }).tier).toBe("high");
    expect(resolveGraphicsQuality("auto", { autoTier: "high", downgradeSteps: 2 }).tier).toBe("low");
    expect(resolveGraphicsQuality("auto", { autoTier: "low", unplugged: true, downgradeSteps: 3 }).tier).toBe("low");
  });
  it("does not apply battery/FPS demotions to a manually pinned tier", () => {
    expect(resolveGraphicsQuality("high", { unplugged: true, downgradeSteps: 2 }).tier).toBe("high");
  });
  it("reduced motion stops all animation but keeps the tier's identity budgets", () => {
    const q = resolveGraphicsQuality("ultra", { reducedMotion: true });
    expect(q.bgAnimate).toBe(false);
    expect(q.nameCanvas).toBe(false);
    expect(q.fallbackAnim).toBe(false);
    expect(q.nameFxBudget).toBe(0);
    expect(q.marchFx).toBe("kite");
    expect(q.dprCap).toBe(TIER_PRESETS.ultra.dprCap);
  });
});
