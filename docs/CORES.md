# Planet Cores (Body) — cosmetic spec

> The **Core** is the planet's own body — the `body` slot, the base every other cosmetic
> sits on (Body / Surface / Halo / Glyph / Trail / Title). Cosmetic only.
>
> **Reference implementation:** [`docs/mockups/planet-cores.html`](mockups/planet-cores.html)
> — self-contained animated demo of the three bodies below (Canvas 2D, no libraries). Read
> its `Card` class (`dust()`, `ocean()`, `core()` + the shared `feat()` rotation helper) for
> exact constants. Preview: `python3 -m http.server` in `docs/mockups/` and open the file.
>
> Same visual language, rules and registry pattern as `MARCH_SIGNATURES.md` / `ORBITS.md` /
> `HALOS.md`.

## Non-negotiable rules (every body)

1. **Everything stays inside the disk.** A body's effects (churn, flares, cracks, glow) must
   be **contained within the sphere** — never emit coronas, prominences, or particles into
   the space around it. That space belongs to the **`halo`** (light aura) and **`orbit`**
   (rings/structure) slots; a body that spills outside clashes with them. Only a thin edge
   *on the rim* is allowed.
2. **No map-hitbox change.** Purely visual; no change to collision/selection footprint.
3. **Zero gameplay effect.** Spectacle only; full detail at close/selected zoom.
4. **LOD.** At Strategic zoom every body collapses to the same plain marker; animated bodies
   (UR) run only near/selected. Pause when hidden; freeze a frame under `prefers-reduced-motion`.

## Shared mechanics

- **Surface rotation:** a feature at longitude `u`, latitude `v` maps to
  `a = (u + T·spd)·2π`, `depth = cos a` (front hemisphere when `depth > 0`),
  `x = cx + sin a · 0.92R`, `y = cy + (v−0.5)·1.72R`. **Foreshorten features in x by
  `depth`** (they compress into vertical slivers near the limb) and fade them out as
  `depth → 0` — this is what makes decals wrap on the sphere instead of looking pasted on.
- Glows use `globalCompositeOperation = 'lighter'`; guard against an un-laid-out canvas
  (skip while `R < ~10px`).

## The bodies

| skinId | Name (EN / 中文) | Tier | Accent | Acquisition | Price |
|---|---|---|---|---|---|
| `body.dust` | Dust Homestead / 荒土 | Common (R) | bronze `#c8a06a` | default | free |
| `body.bluemarble` | Blue Marble / 蔚蓝 | Rare (SR) | cyan `#59dcff` | store / gacha | ◈1,400 |
| `body.void` | Void-Touched / 触虚核 | SSR | violet `#a96cff` | limited (GPT/Codex — existing) | ◈3,200 |
| `body.core` | Sovereign Core / 君核 | Legendary (UR) | gold `#f3c46b` | **earn — season** | — |

> **`body.void` is not in this drop.** It already exists as the GPT/Codex Void-Touched
> shader — the real one is the WebGL fragment in [`src/VoidPlanet.tsx`](../src/VoidPlanet.tsx)
> (obsidian body, living violet Voronoi cracks, cyan-violet rim). Keep that as the SSR body;
> this spec ships only the R / SR / UR below. (The mockup omits it too.)

### `body.dust` — Dust Homestead (Common, default)
A matte rocky world — everyone's starting home.
- Warm-tan → dark radial base (light upper-left); faint horizontal **dust bands**.
- **Craters** drawn as low-contrast ellipses, **foreshortened** (`rx = base·depth`, `ry ≈ 0.82·base`)
  and faded near the limb, with a subtle sunlit rim arc. Matte dark limb (no glow).
- Very slow rotation.

### `body.bluemarble` — Blue Marble (Rare)
A recognizable, living Earth. The lighting is what sells it.
- Deep-ocean base; **irregular continents** (lumpy coastline polygons with a green/tan
  terrain gradient), foreshortened; **soft blurred clouds**; **thin flattened polar ice
  caps** hugging the top/bottom curve, blurred and fading toward the equator (the pole is
  the rotation axis, so caps stay put — keep them slim or the perspective reads wrong).
- **Day→night terminator + limb darkening** (sun upper-left) as an overlay — this single
  pass makes it read as a lit globe rather than flat decals.
- Soft **atmosphere haze** rim, brighter on the lit limb. No plastic hotspot.

### `body.core` — Sovereign Core (Legendary / earn-only)
A churning plasma star, **fully contained in the sphere**.
- White-hot center → gold → deep-red edge; **churning plasma cells** (foreshortened,
  additive).
- **Solar flare-spots** (not cracks — deliberately unlike `body.void`): bright patches that
  swell, burst, and fade on independent cycles (`inten = sin(phase·π)^1.6`), scattered across
  the surface, with a white core fleck at peak.
- **Dark sunspots** for contrast; a **pulsing white-hot core**; **limb darkening**; and only
  a thin hot edge on the rim. No corona/prominences outside (Halo & Orbit own that space).

## Registry shape (proposed)

```jsonc
{
  "skinId": "body.core",
  "slot": "body",
  "name": { "en": "Sovereign Core", "zh": "君核" },
  "tier": "UR",                        // R | SR | SSR | UR
  "accent": "#f3c46b",
  "acquisition": { "type": "earn", "source": "season" },
  //  body.dust -> {"type":"default"} ; body.bluemarble -> {"type":"gacha","price":1400,"currency":"credits"}
  "params": {                          // consumed by the renderer; see the mockup
    "style": "core",                   // "dust" | "ocean" | "void" | "core"
    "contained": true,                 // effects must stay within the sphere
    "flares": 14, "sunspots": 4, "rotate": 0.04
  }
}
```

`slot: "body"` is the base layer; a loadout stacks `halo` and `orbit` on top of it, so the
body must never draw outside its own disk.

## Open questions for review
- Prices (Blue Marble ◈1,400) and whether Dust is the free default.
- Blue Marble: continent count / cloud amount / axial tilt.
- Sovereign Core: add a rare **big flare** event (one spot erupts much larger/brighter, still
  inside the sphere) for extra drama?
