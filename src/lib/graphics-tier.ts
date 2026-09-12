// Graphics quality tiers for the starmap + cosmetic FX.
//
// A single "Auto" default detects the machine on first paint and adapts at
// runtime (battery + measured FPS); four manual overrides pin a tier. Every
// renderer keys off the resolved `GraphicsQuality` knobs below rather than
// branching on the tier name, so the tiers stay one parameterized code path
// instead of four bespoke variants. `reducedMotion` composes on top and wins.

export type GraphicsTier = "auto" | "low" | "medium" | "high" | "ultra";
export type ResolvedTier = "low" | "medium" | "high" | "ultra";

export const RESOLVED_TIERS: ResolvedTier[] = ["low", "medium", "high", "ultra"];

export const GRAPHICS_TIER_LABEL: Record<GraphicsTier, string> = {
  auto: "Auto // Adaptive",
  low: "Low-Band",
  medium: "Standard",
  high: "Enhanced",
  ultra: "Full-Spectrum",
};

export const GRAPHICS_TIER_HINT: Record<GraphicsTier, string> = {
  auto: "Detects your machine and eases off on battery or low frame-rate.",
  low: "Smooth on modest GPUs — identity kept, motion stripped.",
  medium: "Battery-friendly. Good-looking without the heavy passes.",
  high: "Rich effects for most machines.",
  ultra: "Top-end rendering — the best starmap and signatures.",
};

export interface GraphicsQuality {
  tier: ResolvedTier;
  /** Concurrent "hero" per-name Canvas signatures allowed on the starmap. */
  nameFxBudget: number;
  /** May run a per-name 2D canvas at all (Comms/inspect + budgeted map tags). */
  nameCanvas: boolean;
  /** Animate the cheap CSS/SVG fallback (pulse/flicker/breath) vs static. */
  fallbackAnim: boolean;
  /** March-fleet map rendering fidelity. */
  marchFx: "kite" | "lite" | "full";
  /** Animate background starfield/nebula drift. */
  bgAnimate: boolean;
  /** Multiplier applied to decorative particle counts (orbits/halos/trails). */
  particleScale: number;
  /** Upper bound on canvas backing-store devicePixelRatio (huge cost lever on Retina). */
  dprCap: number;
  /** Allow expensive blur / drop-shadow / feGaussianBlur passes. */
  blur: boolean;
  /** Animation frame target; low tier throttles to save power. */
  frameHz: 30 | 60;
}

export const TIER_PRESETS: Record<ResolvedTier, GraphicsQuality> = {
  low: { tier: "low", nameFxBudget: 0, nameCanvas: false, fallbackAnim: false, marchFx: "kite", bgAnimate: false, particleScale: 0.4, dprCap: 1, blur: false, frameHz: 30 },
  medium: { tier: "medium", nameFxBudget: 1, nameCanvas: true, fallbackAnim: true, marchFx: "lite", bgAnimate: true, particleScale: 0.7, dprCap: 1.5, blur: false, frameHz: 60 },
  high: { tier: "high", nameFxBudget: 3, nameCanvas: true, fallbackAnim: true, marchFx: "full", bgAnimate: true, particleScale: 1, dprCap: 2, blur: true, frameHz: 60 },
  ultra: { tier: "ultra", nameFxBudget: 6, nameCanvas: true, fallbackAnim: true, marchFx: "full", bgAnimate: true, particleScale: 1.2, dprCap: 2, blur: true, frameHz: 60 },
};

export interface DeviceSignals {
  cores?: number;
  memoryGB?: number;
  dpr?: number;
  /** Longest screen edge in CSS px — small screens read as mobile/low. */
  screenMaxEdge?: number;
}

export function readDeviceSignals(): DeviceSignals {
  if (typeof navigator === "undefined") return {};
  const dpr = typeof window !== "undefined" ? window.devicePixelRatio || 1 : 1;
  const screenMaxEdge = typeof screen !== "undefined" ? Math.max(screen.width || 0, screen.height || 0) : undefined;
  return {
    cores: (navigator as Navigator & { hardwareConcurrency?: number }).hardwareConcurrency,
    memoryGB: (navigator as Navigator & { deviceMemory?: number }).deviceMemory,
    dpr,
    screenMaxEdge,
  };
}

// Browsers can't reliably name the GPU, so score the coarse signals that are
// available. Deliberately conservative: better to under-promise and let the
// runtime FPS probe hold a tier than to stutter a low-end machine on entry.
export function detectAutoTier(signals: DeviceSignals = readDeviceSignals()): ResolvedTier {
  const cores = signals.cores ?? 4;
  const mem = signals.memoryGB ?? 4;
  const dpr = signals.dpr ?? 1;
  const edge = signals.screenMaxEdge ?? 1440;
  if (edge > 0 && edge < 900) return "low"; // phones / very small panels
  if (cores <= 2 || mem <= 2) return "low";
  if (cores <= 4 || mem <= 4) return "medium";
  if (cores >= 8 && mem >= 8) return dpr >= 2 ? "ultra" : "high";
  return "high";
}

export interface ResolveOptions {
  /** Detected auto tier (cache it — detection is stable per device). */
  autoTier?: ResolvedTier;
  reducedMotion?: boolean;
  /** On battery (not charging) — Auto eases down a step. */
  unplugged?: boolean;
  /** Runtime FPS-driven demotions applied only in Auto mode. */
  downgradeSteps?: number;
}

function stepDown(tier: ResolvedTier, steps: number): ResolvedTier {
  const index = RESOLVED_TIERS.indexOf(tier);
  return RESOLVED_TIERS[Math.max(0, index - Math.max(0, steps))];
}

export function resolveGraphicsQuality(setting: GraphicsTier, opts: ResolveOptions = {}): GraphicsQuality {
  const auto = setting === "auto";
  let tier: ResolvedTier = auto ? (opts.autoTier ?? detectAutoTier()) : setting;
  if (auto) {
    if (opts.unplugged) tier = stepDown(tier, 1);
    if (opts.downgradeSteps) tier = stepDown(tier, opts.downgradeSteps);
  }
  const quality: GraphicsQuality = { ...TIER_PRESETS[tier] };
  // Reduced motion is a hard override on top of any tier: identity stays,
  // every animation stops. DPR/particle budgets are left to the tier.
  if (opts.reducedMotion) {
    quality.nameCanvas = false;
    quality.fallbackAnim = false;
    quality.bgAnimate = false;
    quality.marchFx = "kite"; // reduced motion → the static kite, no animated trail
    quality.nameFxBudget = 0;
  }
  return quality;
}

export function isGraphicsTier(value: unknown): value is GraphicsTier {
  return value === "auto" || RESOLVED_TIERS.includes(value as ResolvedTier);
}
