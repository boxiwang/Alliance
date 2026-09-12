# Proposal — Void-Touched premium skin + home-planet size (for review before merge)

> Status: **NOT committed.** Lives as uncommitted working-tree changes on top of
> `b5befb0` (the Star Map perf pass). This note is for Codex to review the logic
> before we push it. Two logically separate changes are bundled here because they
> touch the same home-planet render code.

## Files in this change
- `src/VoidPlanet.tsx` — **new**, untracked. WebGL overlay component.
- `src/World.tsx` — home-planet render rewrite + `homeScale` + shader mount.
- `src/styles.css` — `.world-void-*` skin classes + `.world-void-canvas` overlay.

To see the diff vs the committed perf baseline:
```bash
git diff b5befb0 -- src/World.tsx src/styles.css   # skin + home-size hunks
```
(`src/VoidPlanet.tsx` is untracked — `git add -N src/VoidPlanet.tsx` to include it in the diff.)

---

## Part 1 — Home planet must be the biggest body at every zoom

**Problem.** The own-city marker was scaled by `importantScale = (strategicZoom ? 1.6 : 1.18) / zoom` — a flat `1/zoom` shrink. Resource/rogue markers use `worldMarkerScale(zoom)`, which *grows* in deep Tactical view via `tacticalBoost` (up to 2× at 16×). So past ~3× zoom the home marker fell **below** a resource planet in size — the opposite of what a player's own capital should read as.

**Proposed fix.** Give the home planet its own scale that rides the same growth curve as targets and stays above it:
```ts
const homeScale = strategicZoom ? 2 / zoom : worldMarkerScale(zoom) * 1.7;
```
Home planet body radius is `9` world units (vs a resource's `7.2` at detail), so at max zoom the home body ≈ `9 * worldMarkerScale(16) * 1.7 ≈ 1.9` wu vs a resource's `7.2 * 0.125 ≈ 0.9` wu — roughly **2×**, clearly dominant. The identity tag/coordinate stay on `importantScale` (unchanged) via a split transform group, so only the planet body grows.

**Review question for Codex:** is `1.7×` the ratio we want, or should the home/target size relationship be a single tunable in `numbers.json` (e.g. `world.render.homeScaleFactor`) rather than a literal? Home body radius `9` is likewise a literal.

## Part 2 — Void-Touched (Rift Sovereign) premium skin

**Intent.** First paid cosmetic. Renders **only** on the player's own home planet, **only** on the local machine — never on other players' maps, so it adds zero cost to anyone else. This matches the LOD line in `docs/PRODUCT.md`: "zoomed-out = simple outline+halo; selected = full shader."

**How it's built.**
- `src/VoidPlanet.tsx`: a single `<canvas>` overlay (Codex's `sovereign-planet-skins.html` rift fragment shader, adapted to render transparently over the SVG map). It's a small box centred on the planet (body + halo + void-scar tail), so the fragment only runs over the planet footprint, not the whole map.
- It tracks the planet through pan/zoom by reading the SVG's client rect + current camera/zoom each frame (props kept in a ref so the rAF loop doesn't re-subscribe).
- **LOD / cost guards:** inert (falls back to the SVG skin) at Strategic zoom, when the planet is off-screen, when radius < 3px, when the tab is hidden (`document.hidden`), and under `prefers-reduced-motion` (freezes a frame). No WebGL → SVG fallback, no blank.
- `z-index: 2` (above the SVG map at z1, below the HUD controls at z3-4); `pointer-events: none` so the map still drags through it.
- While the shader is active, `World` hides the SVG skin underneath (`voidShaderActive`) to avoid a doubled halo.

**A real bug fixed in passing:** under React StrictMode (dev) the effect mounts → cleans up → remounts; calling `WEBGL_lose_context.loseContext()` in cleanup left the remount's `getContext()` returning a **dead** context (nothing drew). Fix: don't lose the context in cleanup, just cancel the rAF.

**SVG fallback skin** (`VoidTouchedPlanet` in `World.tsx` + `.world-void-*` CSS): obsidian body, violet fracture paths, cyan/violet halo, void tail, cheap CSS pulse. Used at Strategic zoom / no-WebGL / off-screen.

**What is NOT built yet (the reason this is a preview, not a shippable feature):**
1. **Ownership gating.** The skin is currently hardcoded ON for every player's own planet. A real cosmetic needs an "equipped skin" field on the player/profile and a check before rendering (`equippedSkin === "void-touched"`).
2. **Skin registry.** Only `rift` (Void-Touched) is wired; `horizon` (Event Horizon) and `imperator` (Solar Imperator) shaders exist in the mockup but aren't ported. Wants a `skinId → shader` registry so the overlay picks the fragment by equipped id.
3. **Where it must also appear** (per PRODUCT.md cosmetics): Comms nameplate, Rally card, battle report, profile — not just the Star Map.
4. **Acquisition path.** Store/credits/ownership — deferred to P2 per PRODUCT.md; do NOT wire real value until server-authoritative state lands.

**Review question for Codex:** does the overlay-canvas-tracking-the-SVG approach fit where the server-authoritative Star Map (`e6f2009`) is heading, or should the skin be rendered inside the map's own render path once that lands? Deciding this before porting the other two skins avoids redoing the plumbing.
