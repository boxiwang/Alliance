# Planet Orbits — cosmetic spec

> A **Planet Orbit** is the orbital structure worn around a player's planet — rings,
> satellites, an accretion disk. It is the orbital-hardware / halo slot of the planet
> cosmetic set (Body / Surface / Halo / Glyph / Trail / Title); here it is treated as
> its own equippable slot `orbit`. Cosmetic only.
>
> **Reference implementation:** [`docs/mockups/planet-orbits.html`](mockups/planet-orbits.html)
> is a self-contained animated demo of all four (Canvas 2D, no libraries). Read its
> `Card` class — `planet()` and `orbit()` — for the exact per-tier draw code and the
> constants this doc summarizes. Preview: `python3 -m http.server` in `docs/mockups/`
> and open the file, or open it directly in a browser. (The claude.ai artifact link is
> for humans only — it sits behind a login wall and is not readable by an agent.)
>
> Pairs with [`docs/MARCH_SIGNATURES.md`](MARCH_SIGNATURES.md); same visual language,
> same rules, same registry pattern.

## Non-negotiable rules (every tier)

1. **Bounded, no coordinate exposure.** The orbit hugs the planet at a bounded radius —
   it never extends into a long-range glow or a cross-map beacon, never enlarges the
   planet's map silhouette. At Strategic zoom every planet — Common to Legendary —
   collapses to the same plain marker. A cosmetic must never make its owner easier to
   find or target.
2. **No map-hitbox change.** The orbit is purely visual; it must not change the planet's
   collision/selection footprint or occlude neighbours.
3. **Zero gameplay effect.** No combat / build / gather / defense influence. Spectacle
   only, and only at close / selected zoom.
4. **Performance / LOD.** Full effect only at Field zoom or nearer, for on-screen
   planets; degrade to a thin static ring at Strategic zoom. Pause when hidden; freeze
   one frame under `prefers-reduced-motion`. Cap DPR ~1.5–2.

## The four orbits (Genesis drop)

| skinId | Name (EN / 中文) | Tier | Accent | Acquisition | Price |
|---|---|---|---|---|---|
| `orbit.survey` | Survey Ring / 勘测环 | Common (R) | cyan `#59dcff` | store | ◈420 |
| `orbit.belt` | Orbital Belt / 轨道带 | Rare (SR) | violet `#a96cff` | store / gacha | ◈1,100 |
| `orbit.accretion` | Accretion Halo / 吸积光环 | SSR | amber `#ffb454` | limited gacha | ◈2,600 |
| `orbit.crown` | Sovereign Crown / 君冕环 | Legendary (UR) | platinum `#d7e7ff` + gold gems | **earn — season, not for sale** | — |

Tier ladder mirrors the planet-skin and march ladders (R → SR → SSR → UR). The apex
(`orbit.crown`) is **earn-only**, per `docs/PRODUCT.md`'s "top tier is not for sale"
principle — what keeps the ladder clear of pay-to-win optics.

### `orbit.survey` — Survey Ring (Common)
A single thin **dashed ring** slowly spinning (animated dash offset), with one survey
tick-marker riding the orbit. Utilitarian starter.
- Ring `rx ≈ R*2.15`, `ry ≈ rx*0.30`; dash `[5,7]`, offset `-t*14`; marker at `θ = t*0.6`.

### `orbit.belt` — Orbital Belt (Rare)
Two rings at different tilts + a few glowing satellites at staggered speeds + sparse
debris. Reads as an established orbital installation.
- Ring1 `rx ≈ R*2.05, ry ≈ rx*0.30`; Ring2 fainter `rx ≈ R*2.55, ry ≈ rx*0.24`.
- 4 satellites on Ring1 at `θ = iπ/2 + t*(0.5+0.05i)` — radial glow + white core.
- ~14 debris motes on `rx*1.06` drifting at `t*0.25`.

### `orbit.accretion` — Accretion Halo (SSR)
A flowing accretion disk: particles streaming along the ellipse, colour graded
amber→violet, inner edge bright. Premium, buyable.
- Ellipse `rx ≈ R*2.25, ry ≈ rx*0.34`; ~90 particles at `θ = i/N·2π + t*0.9`, per-particle
  radius jitter; colour `mix(amber,violet,(cosθ+1)/2)`; crisp photon ring at `rx*0.86`.

### `orbit.crown` — Sovereign Crown (Legendary / earn-only)
A multi-axis gyroscopic crown of rings + orbiting crown-gem satellites. Realm-level.
- Main ring `rx ≈ R*2.2, ry ≈ rx*0.32` (platinum).
- 2 gyro secondary rings, rotated `±(0.5..0.7)` with a slow spin (`ellipse R*2.35 × R*0.5`).
- 6 **gold gem** satellites (rotated squares / diamonds — echo the map's city glyph)
  at `θ = iπ/3 + t*0.4`, radial glow; plus shimmer sparks.

## Shared mechanics

- **Depth / occlusion.** Every ring is a tilted ellipse (`ry ≈ 0.30–0.34·rx`) drawn in
  two passes — the far (top, `sinθ<0`) half **behind** the planet, the near (bottom)
  half **over** it — so rings and satellites pass believably behind the world.
  Satellites scale/brighten with depth (`0.6 + 0.4·(sinθ+1)/2`).
- **Planet body** is a neutral dark world (radial gradient + faint band + accent rim
  light) so the orbit is the focus — the equipped planet skin replaces this in-game.
- Glows drawn with `globalCompositeOperation = 'lighter'`. Guard against an un-laid-out
  canvas (skip the frame while `R < ~10px`) to avoid negative radii.

## Registry shape (proposed)

```jsonc
{
  "skinId": "orbit.accretion",
  "slot": "orbit",                     // orbital-hardware / halo slot
  "name": { "en": "Accretion Halo", "zh": "吸积光环" },
  "tier": "SSR",                       // R | SR | SSR | UR
  "accent": "#ffb454",
  "acquisition": { "type": "gacha", "limited": true, "price": 2600, "currency": "credits" },
  //  orbit.crown -> { "type": "earn", "source": "season" }  (no price)
  "params": {                          // consumed by the renderer; see the mockup
    "rings": [{ "rx": 2.25, "ry": 0.34 }],   // multipliers of planet radius R
    "style": "accretion",              // "ring" | "belt" | "accretion" | "crown"
    "particles": 90,
    "spin": 0.9,
    "colorStops": ["#ffb454", "#a96cff"]
  }
}
```

`slot: "orbit"` sits alongside the other planet-cosmetic slots so a loadout equips one
orbit independently of Body/Surface/Glyph/Trail/Title.

## Open questions for review
- Price anchors (◈420 / ◈1,100 / ◈2,600) — right feel for the tiers?
- Accretion intensity/speed — current pass is elegant; can be pushed hotter/faster.
- Crown gyro rings currently read a little "atomic"; option: narrow the two tilted rings
  and keep gem nodes only on the upper arc so it reads more like a crown.
- Should any tier's satellites share the march kite/diamond vessel language for a unified
  look? (Crown gems already use the diamond.)
