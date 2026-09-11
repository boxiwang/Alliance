# March Signatures — cosmetic spec

> A **March Signature** is a cosmetic worn by a player's *fleet while it travels the
> Star Map* — the moving marker + the trail it leaves between origin and target.
> It is a separate cosmetic slot from the planet skin (Body / Surface / Halo /
> Glyph / Trail / Title); think of it as the 7th slot. Cosmetic only.
>
> **Reference implementation:** [`docs/mockups/march-signatures.html`](mockups/march-signatures.html)
> is a self-contained animated demo of all four (Canvas 2D, no libraries). Read its
> `Card` class for the exact per-effect draw code and constants this doc summarizes.
> To preview it: `python3 -m http.server` in `docs/mockups/` and open the file, or
> open it directly in a browser. (The claude.ai artifact link is for humans only —
> it sits behind a login wall and is not readable by an agent.)

## Non-negotiable rules (apply to every tier)

1. **No coordinate exposure / no beacon.** The effect renders *tight to the fleet
   body only* — it never extends into a long-range glow, never enlarges the
   fleet's silhouette, and is never visible from across the map. At Strategic
   zoom every fleet — Common to Legendary — collapses to the same plain marker.
   A cosmetic must never make its owner easier to find or target.
2. **Readability first.** The march line's direction, progress and ETA must stay
   unmistakable — especially an *incoming* attack. The effect restyles; it must
   never obscure or mislead. This is a fairness line.
3. **Zero gameplay effect.** No change to combat, march speed, capacity, or the
   line's mechanics. Observable spectacle only, and only at close / selected zoom.
4. **Performance / LOD.** Full effect runs only at Field zoom or nearer, only for
   fleets on screen; it degrades to a light line at Strategic zoom and for large
   batches of other players' marches. Pause when the tab is hidden; freeze a
   single frame under `prefers-reduced-motion`. Cap DPR at ~1.5–2.

## The four signatures (Genesis drop)

| skinId | Name (EN / 中文) | Tier | Accent | Acquisition | Price |
|---|---|---|---|---|---|
| `march.ion` | Ion Wake / 离子尾迹 | Common (R) | cyan `#59dcff` | store | ◈480 |
| `march.warp` | Warp Thread / 曲率折线 | Rare (SR) | violet `#a96cff` | store / gacha | ◈1,200 |
| `march.aurora` | Aurora Sail / 极光帆 | SSR | aurora-teal `#4ff0d0` | limited gacha | ◈2,800 |
| `march.comet` | Comet Vanguard / 彗锋 | Legendary (UR) | gold `#f3c46b` (intent-tinted) | **earn — season, not for sale** | — |

Tier ladder mirrors the planet-skin ladder (R → SR → SSR → UR). The apex
(`march.comet`) is **earn-only**, consistent with the "top tier is not for sale"
principle in `docs/PRODUCT.md` — this is what keeps the whole ladder clear of
pay-to-win optics.

### `march.ion` — Ion Wake (Common)
A slender cold-light vessel trailing a dashed, segment-by-segment fading ion trace.
Clean, restrained. Recommended default.
- **Vessel:** shared kite hull (see below), cyan.
- **Trail:** polyline through sampled points, per-segment alpha by age; life ≈ **2.6 s**.
  Plus a few offset motes fading over ≈ 2.9 s.

### `march.warp` — Warp Thread (Rare)
The fleet folds the space ahead of it and pulls a braided warp corridor behind.
- **Vessel:** chromatic **lens core** (white core + cyan/violet split), concentric
  pulsing rings, and 3 leading "space-fold" arcs ahead along the heading.
- **Trail:** two **counter-phase braided threads** (violet + cyan) that weave, plus
  two faint converging **corridor rails** that narrow behind the fleet. Life ≈ **4.2 s**.
- **Flourishes:** departure warp-streak; arrival = fold-collapse implosion (a bright
  dot expands then contracts) + ring.

### `march.aurora` — Aurora Sail (SSR)
A flowing aurora curtain unfurled behind the fleet.
- **Vessel:** shared kite hull, aurora-teal.
- **Trail:** an undulating filled **ribbon**, two passes (wide soft glow `hw≈15`
  then body `hw≈9`) + a bright cyan shimmer core line. Wave: low frequency
  `≈0.13`/sample, amplitude `≈10.5`, slow drift `t/900`. Life ≈ **5.2 s**.
- **Gradient is fixed to the journey, not the frame.** Each trail point stores the
  march progress `f` (0→1) at which it was laid; colour = `teal→cyan→violet` keyed
  on that `f`. So the gradient is *painted along the route* and never re-maps as the
  buffer scrolls. (This was a deliberate fix — do not colour by array index.)

### `march.comet` — Comet Vanguard (Legendary / earn-only)
A comet head dragging a curved, ember-shedding tail whose colour reads the fleet's
**intent**.
- **Vessel:** bright comet head — radial core glow + white core.
- **Trail:** curved tail of fading discs (life ≈ **3.8 s**) + embers spawned on the
  sample clock that drift and fade.
- **Intent colour** (uses the engine's existing march action classes):
  `scout = cyan`, `gather = gold`, `attack = red`. Show the current intent on a chip.

## Shared mechanics (all signatures)

- **Vessel — kite hull:** an elongated diamond (fore point long, aft short, two side
  points) with a directional glow, gradient body and a bright white core. It echoes
  the map's city-diamond glyph and reads as a real craft — **do not use a flat
  triangle** (looked cheap; replaced). Warp and Comet keep their own signature heads
  (lens / comet) instead of the hull.
- **Pacing:** travel ≈ **20 s** (Warp ≈ 22 s), matching real march durations; arrival
  hold ≈ 1.4 s, then reset. Position eased in/out (`p·p·(3-2p)`) so the fleet spools
  up leaving home and settles into the target.
- **Trail sampling** on a fixed **45 ms** clock (not per-frame), capped at ~260 points,
  so a slow fleet still leaves an even streak and cost stays bounded regardless of
  frame rate. Glows drawn with `globalCompositeOperation = 'lighter'`.
- **Flourishes:** a departure ring at home on reset; an arrival ring (Warp adds the
  implosion) at the target during the hold.

## Registry shape (proposed)

A signature is data + a draw function keyed by `skinId`:

```jsonc
{
  "skinId": "march.aurora",
  "slot": "march_signature",
  "name": { "en": "Aurora Sail", "zh": "极光帆" },
  "tier": "SSR",                       // R | SR | SSR | UR
  "accent": "#4ff0d0",
  "acquisition": { "type": "gacha", "limited": true, "price": 2800, "currency": "credits" },
  //  march.comet -> { "type": "earn", "source": "season" }  (no price)
  "params": {                          // consumed by the renderer; see the mockup
    "travelMs": 20000,
    "trailLifeMs": 5200,
    "wave": { "freq": 0.13, "amp": 10.5, "driftDivisor": 900 },
    "colorStops": ["#4ff0d0", "#59dcff", "#a96cff"],  // keyed on journey progress f
    "vessel": "kite"                   // "kite" | "lens" | "comet"
  }
}
```

`slot: "march_signature"` sits alongside the planet-skin slots so a loadout can hold
one march signature independently of the equipped planet skin. `march.comet` reads
`intentColors: { scout, gather, attack }` instead of a single accent.

## Open questions for review
- Price anchors (◈480 / ◈1,200 / ◈2,800) — right feel for the tiers?
- Aurora colour/width/flow-speed — current pass is elegant/restrained; can be pushed
  bolder if we want it flashier.
- Should the vessel kite hull be shared by **all four** (uniform "fleet", trail carries
  the identity), or keep Warp's lens and Comet's comet head as tier signatures? Current
  build keeps them distinct.
