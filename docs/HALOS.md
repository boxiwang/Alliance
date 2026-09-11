# Planet Halos — cosmetic spec

> A **Planet Halo** is the light aura around a player's planet — glow, corona, aurora
> veil, radiant crown. It is the `halo` slot of the planet cosmetic set (Body / Surface /
> Halo / Glyph / Trail / Title). **Distinct from `orbit`** (see [`docs/ORBITS.md`](ORBITS.md)):
> orbit is *structure* (rings / satellites / accretion), halo is pure *light*. A loadout
> can equip one of each. Cosmetic only.
>
> **Reference implementation:** [`docs/mockups/planet-halos.html`](mockups/planet-halos.html)
> — self-contained animated demo of all four (Canvas 2D, no libraries). Read its `Card`
> class (`planet()`, `bloom()`, `rim()`, `halo()`) for the exact draw code and constants.
> Preview: `python3 -m http.server` in `docs/mockups/` and open the file. (The claude.ai
> artifact link is humans-only — login-walled, not agent-readable.)
>
> Same visual language, rules and registry pattern as `MARCH_SIGNATURES.md` / `ORBITS.md`.

## Non-negotiable rules (every tier)

1. **Bounded, no beacon.** The halo hugs the planet at a bounded radius (**≤ ~2×** the
   planet); it never becomes a long-range glow or cross-map beacon, never enlarges the
   planet's map silhouette. At Strategic zoom every planet — Common to Legendary —
   collapses to the same plain marker. (Light is the most beacon-prone cosmetic — hold
   the radius cap.)
2. **No map-hitbox change.** Purely visual; no change to collision/selection footprint,
   no occluding neighbours.
3. **Zero gameplay effect.** Spectacle only, at close / selected zoom.
4. **Performance / LOD.** Full effect only at Field zoom or nearer, on-screen planets;
   degrade to a plain rim at Strategic zoom. Pause when hidden; freeze one frame under
   `prefers-reduced-motion`. Cap DPR ~1.5–2.

## The four halos (Genesis drop)

| skinId | Name (EN / 中文) | Tier | Accent | Acquisition | Price |
|---|---|---|---|---|---|
| `halo.corona` | Faint Corona / 微光冕 | Common (R) | cyan `#59dcff` | store | ◈400 |
| `halo.pulse` | Pulse Aura / 脉冲光晕 | Rare (SR) | violet `#a96cff` | store / gacha | ◈1,050 |
| `halo.aurora` | Aurora Veil / 极光晕纱 | SSR | aurora-teal `#4ff0d0` → violet | limited gacha | ◈2,500 |
| `halo.radiant` | Radiant Crown / 光辉圣冕 | Legendary (UR) | gold `#f3c46b` + white | **earn — season, not for sale** | — |

Tier ladder mirrors the skin / orbit / march ladders (R → SR → SSR → UR). The apex
(`halo.radiant`) is **earn-only**, per `docs/PRODUCT.md`'s "top tier is not for sale".

### `halo.corona` — Faint Corona (Common)
A soft, **slowly** breathing glow hugging the rim + a thin bright outline. Minimal starter.
- Behind: annular bloom to `R*1.7`, alpha ≈ `.16·(0.78+0.22·sin(t·0.42))` — a slow breath.
- Front: rim at `R+0.6`, alpha ≈ `.42·breath`, width 1.2.

> **Pacing:** cheaper tiers emanate *slowly* on purpose — a gentle, unhurried effect reads
> as more premium than a fast flicker. Keep breaths/drifts low-frequency.

### `halo.pulse` — Pulse Aura (Rare)
A brighter aura with periodic expanding pulse rings (a slow sonar breath).
- Behind: base bloom to `R*1.6` (α .15) + 2 staggered rings: `phase = (t·0.33 + k·0.5) mod 1`,
  radius `R·(1.02 + phase)`, alpha `(1-phase)²·0.55`, width 1.6.
- Front: rim α .5, width 1.4.

### `halo.aurora` — Aurora Veil (SSR)
Flowing aurora curtains wrapping the sphere, colour drifting teal→violet by angle+time.
- Behind: soft teal bloom to `R*1.75` (α .12).
- Curtain: ~42 additive blobs around the rim at `r = R·(1.14 + 0.07·sin(4a + 0.4t))`, colour
  `mix(teal,violet,(cos a+1)/2)`, shimmer `0.5+0.5·sin(3a + 0.5t + …)` — a **slow** drift;
  **top half drawn behind the planet, bottom half in front** (occlusion). Front rim teal α .4.

### `halo.radiant` — Radiant Crown (Legendary / earn-only)
A layered, **slow, divine** corona of light. Everything moves at a calm, majestic pace —
holiness comes from layering and slowness, not speed or size.
- One long calm breath drives the whole crown: `breathe = 0.85 + 0.15·sin(t·0.28)`.
- Behind: soft white-gold outer aura to `R*2.05`; **two counter-rotating volumetric ray
  layers** — 12 broad shafts (`rotate +t·0.028`, widen outward) and 24 fine shafts
  (`rotate −t·0.016`), each ray's length gently breathing, **all drawn under
  `ctx.filter='blur(4px)'` so the shafts diffuse into light with no hard edges**; then
  **layered soft radiance** via stacked blooms at `R*1.34 / 1.62 / 1.9` — *not* crisp
  concentric rings (the `orbit` slot owns rings; crisp rings here would clash and read
  as clutter).
- Front: a crisp thin **white rim** (α .6 w1.6) + a **blurred gold glow rim**
  (`blur(3px)`, α .5 w4.2) — a glow, not a hard band; 8 slow-drifting **cathedral light
  motes** softly twinkling; a slow 4-point **star** that swells at the crown's top.

> **Softness matters:** hard-edged shafts / crisp rings read as cheap and busy, and
> collide with the `orbit` slot. Blur the light and use diffuse gradations — the halo is
> atmosphere, not geometry.

## Shared mechanics

- **Depth / occlusion.** Halo is drawn in two passes — light **behind** the planet
  (blooms, rays, aurora top-half) then the planet, then the **front** (rim, aurora
  bottom-half, sparks) — so the aura wraps believably around the sphere.
- **Planet body** is a neutral dark world (the equipped planet skin replaces it in-game).
- Glows use `globalCompositeOperation = 'lighter'`. Guard against an un-laid-out canvas
  (skip while `R < ~10px`) to avoid negative radii.

## Registry shape (proposed)

```jsonc
{
  "skinId": "halo.aurora",
  "slot": "halo",
  "name": { "en": "Aurora Veil", "zh": "极光晕纱" },
  "tier": "SSR",                       // R | SR | SSR | UR
  "accent": "#4ff0d0",
  "acquisition": { "type": "gacha", "limited": true, "price": 2500, "currency": "credits" },
  //  halo.radiant -> { "type": "earn", "source": "season" }  (no price)
  "params": {                          // consumed by the renderer; see the mockup
    "style": "aurora",                 // "corona" | "pulse" | "aurora" | "radiant"
    "maxRadius": 1.75,                 // × planet radius R — keep the beacon cap
    "colorStops": ["#4ff0d0", "#a96cff"],
    "segments": 42
  }
}
```

`slot: "halo"` sits alongside `orbit` and the other planet-cosmetic slots — a planet can
wear both a halo and an orbit at once.

## Open questions for review
- Price anchors (◈400 / ◈1,050 / ◈2,500) — right feel?
- Aurora Veil density / teal-violet balance — thicker or wispier?
- Radiant Crown rays: keep restrained (≤2×R, per the beacon cap) or push longer/brighter?
