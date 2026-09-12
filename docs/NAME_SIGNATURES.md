# Name Signatures + Game Cursors — cosmetic spec (handoff)

> A **Name Signature** is how a commander's *name* is styled wherever it appears in Comms
> (the chatroom name, the inspect card, the world-map tag). It's the `chatSignal` slot —
> already wired in code as `ChatSignalId` / `CHAT_SIGNALS` / `vault.equipped.chatSignal`.
> This drop **completes the ladder** (R → SR → SSR → UR, 7 total) and adds a set of **3
> in-game cursors**. Cosmetic only — pure identity, never changes the message text or gameplay.
>
> **Reference implementation:** [`docs/mockups/name-signatures.html`](mockups/name-signatures.html)
> — self-contained animated demo (Canvas 2D + CSS, no libraries) of all 7 signatures in a mock
> chatroom + a legend, plus the 3 cursors with a live switcher. Read its `<style>` block for the
> CSS-only tiers and its `attach(el, kind)` function for the JS canvas tiers and exact constants.
> Preview: `python3 -m http.server` in `docs/mockups/` and open the file.
>
> Same visual language, rules and registry pattern as `MARCH_SIGNATURES.md` / `ORBITS.md` /
> `HALOS.md` / `CORES.md`.

---

## What's already in the repo (do not rebuild — extend)

The `chatSignal` slot exists and renders today in **six contexts**. Codex should keep all six
working and add the four new ids to each:

| Context | Selector | File |
|---|---|---|
| Live Comms name (chat list) | `.comms-page .chat-name-<id>` | `src/Messages.tsx:279`, `src/styles.css:775` |
| Relic chat message header | `.relic-chat-<id> …header b` | `src/styles.css:905` |
| Profile equip **preview** | `.relic-chat-preview.relic-chat-<id>` | `src/styles.css:930` |
| Player **inspect card** | `.player-signal-card.chat-signal-<id>` | `src/styles.css:920` |
| Equip **slot icon** | `.profile-vault-slots .chat-effect-<id>` | `src/styles.css:942` |
| **World-map** name tag | `.world-city-tag.signal-<id>` | `src/styles.css:965`, `src/World.tsx` |

Registry + ownership already defined in `src/lib/player-account.ts`:
`ChatSignalId` (line 12), `CHAT_SIGNALS` (line 194), `ownsChatSignal` (line 369),
`vault.equipped.chatSignal`, and the GM-grants / defaults (lines 256–270, 345).

**Existing ids:** `clear-channel` (R), `void-whisper` (SSR), `sovereign-flare` (UR).
This spec **upgrades the visuals** of `void-whisper` and `sovereign-flare` and adds four ids.

---

## Non-negotiable rules (every signature)

1. **Name stays readable.** The commander name is legible at rest at all times; effects are
   entrance/ambient flourishes, never obfuscation. Higher tiers may hide the name *during* a
   short entrance beat, but must resolve to a clean, readable name.
2. **Identity only. Zero gameplay effect, never touches message text.**
3. **Bounded to the name box.** An effect lives in/around its own name span — it must not
   bleed into the message body, avatar, or neighbouring rows.
4. **Reduced-motion / LOD.** Under `prefers-reduced-motion` (and the account
   `reducedMotion` flag) every signature freezes to its clean readable name (CSS animations
   off, canvas effects skipped). Canvas tiers run only where the name is large enough
   (Comms list, own message, inspect card) — the **world-map tag stays CSS-only** (too small).
5. **Play once per message, not a loop-forever in the feed.** In the live feed, a high-tier
   entrance plays **once** as the message mounts; your own name / the inspect card may keep a
   subtle ambient. (The mockup loops purely to demo the full cycle.)

---

## The set — 7 signatures

| `chatSignal` id | Name (EN / 中文) | Tier | `rarity` | Accent | Mechanism | Render | Acquisition |
|---|---|---|---|---|---|---|---|
| `clear-channel`   | Clear Channel / 明码   | R   | `ISSUED`    | ink `#eaf4ff`     | plain name                     | CSS | default |
| `signal-boost`    | Signal Boost / 增幅    | SR  | `RELIC`     | cyan `#59dcff`    | periodic transmit "ping"       | CSS | store / gacha ◈900 |
| `verdant-hail`    | Verdant Hail / 青鸣    | SR  | `RELIC`     | teal `#43f2a1`    | breathing glow + rising spores | CSS | store / gacha ◈900 |
| `void-whisper`    | Void Whisper / 虚语    | SSR | `MYTHIC`    | violet `#a96cff`  | black hole **explodes out** the name, then **sucks it back in** | **JS canvas** | limited |
| `ember-cipher`    | Ember Cipher / 炽语    | SSR | `MYTHIC`    | ember `#ffbf63`   | flame **burns the name in** L→R, then **burns it away** | **JS canvas** | limited |
| `sovereign-flare` | Sovereign Flare / 君焰 | UR  | `SOVEREIGN` | gold `#f3c46b`    | ornate crown w/ a twinkling star at its apex + radiant gold | CSS (SVG) | **earn — season** |
| `eclipse-herald`  | Eclipse Herald / 蚀谕  | UR  | `SOVEREIGN` | warm-gold `#f6e6bf` | name resolves out of a **soft diffuse light bloom**, then dissolves back | **JS canvas** | **earn — season** |

> UR is **earn-only** (never sold) — keeps the ladder off pay-to-flex, consistent with the
> other slots.

---

## Per-signature visual spec

Constants below are the demo's; treat the mockup as source of truth. All canvas glows use
`globalCompositeOperation = 'lighter'`; guard an un-laid-out canvas (skip while width < ~24px).

### `clear-channel` — R (CSS)
Plain name in ink. No effect. Default for everyone.

### `signal-boost` — SR (CSS only)
Cyan name, a `▸` transmit chevron prefix, and a periodic **ping**: every ~2.6s the glow
swells and the name scales to ~1.05 for a beat, then settles (`@keyframes sigPing`). Reads
like a signal pulse going out.

### `verdant-hail` — SR (CSS only)
Teal name with a slow **breathing** glow/brightness (`sigBreath`, ~3.6s) and two faint `˖`
**spores** that rise off the name and fade (`sigSpore`, `::before`/`::after`, staggered).
Organic, calm — the "cash-crop / PEPE" faction flavour.

### `void-whisper` — SSR (JS canvas) — *upgraded*
Cycle (~5.6s), at the **left edge** of the name:
1. A point **winds up** (small accreting hole).
2. **Explosion** — white-violet flash + an outward shockwave ring; the name **bursts out**
   from the hole (opacity 0→1, `scaleX` 0.25→1, `translateX` from left, blur→0).
3. Name **holds fully readable — the hole completely disappears** (no permanent black hole).
4. Name is **sucked back**: collapses left (scaleX→0.25, blur up, opacity→0) as the hole
   regrows with an **inward** ring, then the hole collapses to nothing.
Accretion = violet radial glow + a rotating ellipse ring; core = near-black `#05030a`
(drawn `source-over`).

### `ember-cipher` — SSR (JS canvas)
Cycle (~5.2s), a burn front travels along the name via `-webkit-mask-image`:
1. Blank → **burn in** L→R (`linear-gradient(90deg,#000 f·105%, transparent …)`), fully lit
   at the end (**last letters fully revealed**).
2. **Hold** fully readable (mask off).
3. **Burn away** L→R until **completely gone**, then a short **blank pause** before repeat
   (no leftover letters).
Flames = small additive particles (yellow core → orange, ~2/frame) rising off the active
burn edge. Kept deliberately light so it doesn't smother the name.

### `sovereign-flare` — UR (CSS + inline SVG) — *upgraded*
Gold name with a radiant pulse (`sigRadiate`). Prefix is an **ornate crown** (inline SVG:
base band + rounded merlon points + white-gold jewels + a violet keystone jewel) with a
**four-point star twinkling at its apex** (`.crown .cstar`, `sigTwinkle` — scale/opacity/
rotate). The star replaces the old top-right `✦`. Crown viewBox `0 -9 30 31`,
`overflow:visible` so the star isn't clipped.

### `eclipse-herald` — UR (JS canvas)
Cycle (~6s) — premium, **fully soft-edged**:
1. A **diffuse light bloom** (three stacked feathered radial ellipses via `scale()` — ambient
   glow, soft band, feathered hot core; warm gold, no hard rectangle, no hard boundary).
2. Light **fades as the name resolves** (crossfade; name has a small blur while forming).
3. **Fully readable hold — the light is 0** (nothing lingers behind the text).
4. Name **dissolves back** into the bloom.

---

## Implementation guidance for Codex

**Two rendering tiers — keep the cheap path everywhere, add the rich path only where the name is big.**

- **CSS tier** (`clear-channel`, `signal-boost`, `verdant-hail`, `sovereign-flare`): pure
  CSS/SVG. Add a `.chat-name-<id>` rule (and the sibling selectors in the 5 other contexts)
  mirroring the existing `void-whisper` / `sovereign-flare` blocks. These are safe in **all
  six** contexts including the world-map tag.
- **Canvas tier** (`void-whisper`, `ember-cipher`, `eclipse-herald`): lift the demo's
  `attach(el, kind)` into a small module, e.g. `src/lib/name-signal-fx.ts` exporting
  `attachNameSignal(el: HTMLElement, kind: "void" | "ember" | "eclipse"): () => void`
  (returns a disposer). It:
  - expects the styled name text wrapped in a child `.txt` span; inserts an absolutely-
    positioned `<canvas>` (`zIndex:0`, `pointerEvents:none`) as the span's first child, with
    the `.txt` above it (`zIndex:1`). **Do not use `zIndex:-1`** (escapes the row's stacking
    context and hides the effect behind the panel).
  - drives `.txt` inline styles (opacity/blur/transform/mask) + the canvas per `rAF`.
  - sizes off `.txt.getBoundingClientRect()` via a `ResizeObserver`.
  - Mount it in `Messages.tsx` for SSR/UR names in the **live list + own message**, and in the
    **inspect card**; run the entrance **once on mount** (not the demo's forever-loop). Skip
    entirely when `reducedMotion` / `prefers-reduced-motion` — render the clean CSS name.
  - Pause/dispose when the row unmounts or scrolls out (LOD).
- **World-map tag** (`.world-city-tag.signal-<id>`): CSS-only for all ids. For the canvas
  tiers, give the tag a static "premium" treatment (the accent color + glow already used for
  `void-whisper` / `sovereign-flare`); no canvas at map scale.

### Registry changes (`src/lib/player-account.ts`)

```ts
// line 12 — extend the id union
export type ChatSignalId =
  | "clear-channel" | "signal-boost" | "verdant-hail"
  | "void-whisper" | "ember-cipher" | "sovereign-flare" | "eclipse-herald";

// line 194 — CHAT_SIGNALS: add the four new entries (tier/accent optional, matches other slots)
export const CHAT_SIGNALS: CosmeticEffectDefinition<ChatSignalId>[] = [
  { id: "clear-channel",   name: "Clear Channel",   translatedName: "明码", rarity: "ISSUED",    tier: "R",  accent: "#eaf4ff", transmission: "An unmodified commander signal.", source: "Command activation" },
  { id: "signal-boost",    name: "Signal Boost",    translatedName: "增幅", rarity: "RELIC",     tier: "SR", accent: "#59dcff", price: 900, transmission: "The name pings as it transmits.", source: "Relic draw // ◈900" },
  { id: "verdant-hail",    name: "Verdant Hail",    translatedName: "青鸣", rarity: "RELIC",     tier: "SR", accent: "#43f2a1", price: 900, transmission: "Spores drift up from a breathing name.", source: "Relic draw // ◈900" },
  { id: "void-whisper",    name: "Void Whisper",    translatedName: "虚语", rarity: "MYTHIC",    tier: "SSR", accent: "#a96cff", transmission: "A black hole spits the name out, then swallows it.", source: "Rift Sovereign cache" },
  { id: "ember-cipher",    name: "Ember Cipher",    translatedName: "炽语", rarity: "MYTHIC",    tier: "SSR", accent: "#ffbf63", transmission: "The name is burned in, then burned away.", source: "Rift Sovereign cache" },
  { id: "sovereign-flare", name: "Sovereign Flare", translatedName: "君焰", rarity: "SOVEREIGN", tier: "UR", accent: "#f3c46b", transmission: "A crowned nameplate for sector-defining commanders.", source: "Season prestige track" },
  { id: "eclipse-herald",  name: "Eclipse Herald",  translatedName: "蚀谕", rarity: "SOVEREIGN", tier: "UR", accent: "#f6e6bf", transmission: "The name resolves out of gathered light.", source: "Season prestige track" },
];
```

- `ownsChatSignal` and the fallback at line 345 already handle any id generically — no change.
- GM-grants at line 256 (`...CHAT_SIGNALS.map(...)`) auto-include the new ids.
- Pricing (◈900 SR) and season-track sourcing for the two UR are proposals — see open
  questions.

---

## Game cursors — 3 ideas (in-page, not native)

A page-internal cursor rendered over everything and following the mouse — **do not use CSS
`cursor: url(data:…)`** (blocked by CSP on some hosts, incl. claude.ai). Hide the native
cursor (`body { cursor: none }`) and move a `position:fixed` element on `mousemove`. See the
demo's `CUR` map + `setCur()` / `place()`.

| id | Name | Color | Shape | Hotspot |
|---|---|---|---|---|
| `reticle` | Reticle | cyan `#59dcff` | crosshair ring + center dot + tick marks | center (14,14) |
| `comet`   | Comet   | cyan `#59dcff` | arrow/comet head with a white spark tail-tip | tip (5,5) |
| `sigil`   | Sigil   | gold `#f3c46b` | rotated `◈` diamond frame w/ solid center | center (15,15) |

Each is a small inline `<svg>` string with a `drop-shadow` glow in the accent color. Hotspot
= where the click actually registers; the follower element is offset by it. **RETICLE** is the
default. Integration notes for Codex:
- Mount one global cursor controller in the game shell; expose the choice as a
  cosmetic/setting (a `cursor` slot, or a client-side preference — Codex's call).
- On touch devices / when a real pointer is absent, fall back to the native cursor.
- Respect `reducedMotion` for any cursor animation (keep the swap instant).
- Keep the follower on a high `z-index` with `pointer-events:none` so it never eats clicks.

---

## Open questions for review
- SR pricing (◈900) and whether both SR go to store vs one gacha-only.
- Season-track sources for the two UR (`sovereign-flare`, `eclipse-herald`) — which
  achievement / prestige tier grants each.
- Cursors: expose as a real cosmetic slot (owned/equipped, tradeable later) or a plain client
  setting for now?
- Canvas tiers on the world map: static premium treatment (proposed) vs a tiny one-shot
  entrance when a tag first appears.
