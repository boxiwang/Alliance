# ALLIANCE — current handoff

**Updated:** 2026-09-08 (Claude — world-experience fixes on top of Codex's Star Map pass)
**Scope:** Personal Mode first. Alliance gameplay and final art direction remain later layers.  
**Environment:** local-only; do not deploy yet.

## Latest changes (Claude, 2026-09-08)

World Star Map + combat pass, all under `npm run check` (110 tests + build) and `npm run balance:world` (0 issues):

- **Crash fix (load white-screen):** worlds persisted before a new `world.config` key existed (e.g. `minEntitySpacing`) threw on load/respawn. `openLocalWorldSession` now refreshes `world.config` from `numbers.json` on every load, and `randomLegalPoint` falls back to the default spacing. Old saves open again.
- **Combat casualties fixed:** each side's loss now scales with the OPPONENT's power share (`lossFraction(own,enemy)`), winner ×`winnerLossMultiplier` (default 0.5). Overwhelming force now BOUNDS a winner's losses instead of inflating them — sending more troops past the victory threshold no longer raises casualties (verified: L5 rogue, 60K troops → ~6 dead, not ~1800).
- **Rogue = neutral geography, low-outer / high-inner:** rewrote `zoneForPoint` (edge-normalised depth), level is now deterministic from radius (smooth ladder, no random gaps). `populateWorld` seeds a guaranteed ladder (`rogueMinPerLevel`/`resourceMinPerLevel` of every level) then area-fills; `respawnTarget` conserves level (a defeated Lx returns as Lx). Result: abundant low levels on the outer rim, scarce high levels near the wormhole; every level 1–30 always present.
- **On-demand local supply (early game never stalls):** `ensureLocalTargets` (called on session open and every reconcile tick) keeps a floor of engageable rogues + low resources within `localGuaranteeRadius` of the player's city, and specifically ≥`localNextLevelFloor` of the player's NEXT level. If a rival takes them or they deplete, they refill next tick. Guarantee stops at `localGuaranteeMaxLevel` (12) so the inner circle stays scarce. Total counts are capped (`monsterCap`/`resourceCap`) so it never grows unbounded.
- **NEXT ROGUE button + rogue lock:** map tool jumps to the nearest rogue the player may engage (level ≤ highest-defeated+1), never a higher one. Rogue panel shows `READY` / `DEFEAT Lx FIRST` and disables engaging a locked level. Rogues no longer offer SCAN (their type is public).
- **Scout = fast unarmed recon:** scout travels `scoutSpeedMultiplier`× faster (both ways), carries no troops, and only targets rival CITIES. Its report now details garrison by arm (dominant highlighted), garrison by tier, and lootable resources per type (cash/oil/power) — in-city troops only (marching troops excluded).
- **Entity spacing + map legibility:** `minEntitySpacing` (6) keeps every city/rogue/resource in its own cell; rival city name plates render only when selected (a compact level badge otherwise) so clustered cities never overlap text; own/rival name plate width is now adaptive + centred; harvest march lines are thinner with a 🚀 marker + live ETA (outbound and return); Live Fleets show `EN ROUTE / HARVESTING / RETURNING · countdown`; Mission Archive is results-only (no duplicate in-flight entries).

New `numbers.json` knobs (all under `world.*`): `state.minEntitySpacing`; `march.scoutSpeedMultiplier`; `population.{resourceMinPerLevel,rogueMinPerLevel,localGuaranteeRadius,localGuaranteeMaxLevel,localRogueFloor,localNextLevelFloor,localResourceFloor,monsterCap,resourceCap}`; `combat.winnerLossMultiplier` (optional; defaults to 0.5).

**Open design item (server slice):** new-player spawns must stay in the outer low-level ring; today the single local player is always the outermost city so this is fine, but a dense multiplayer State needs new joiners assigned to outer rings (not the next farthest-first inner cell). A separate UI mockup of a minimalist City screen lives at `docs/mockups/city-console-claude.html` (design reference only).

## Start here

```bash
npm install
npm run dev
```

- City GM: `http://127.0.0.1:5173/?town&gm&slot=1`
- Star Map GM: `http://127.0.0.1:5173/?world&gm&slot=1`
- Balance Lab: `http://127.0.0.1:5173/?admin`
- Full verification: `npm run check`
- World balance report: `npm run balance:world`

The Vite port may increment when another local server is already running. Use the URL printed by Vite.

## Product rules that are already locked

- Wallet = persistent civilization. Selling a meme token never deletes personal progress.
- Personal Mode is not an alliance and must not appear as an alliance choice.
- Cash / Oil / Power economy; Army / Navy / Air troops, T1–T10.
- Command Core upgrades require the configured buildings to reach the **previous level**, not merely exist.
- A building cannot upgrade while its own research/training operation is active, and cannot start that operation while upgrading.
- PvP is non-destructive: resources and troops can be lost, but city/building/research progression is permanent.
- No fog of war. Scouting reveals target intelligence; it does not reveal the map.
- X/Y is camera inspection. Relocation requires a future Warp Engine consumable.
- Resource and rogue targets are neutral world geography, not player-centered spawn halos.
- Heroes are not implemented, but every march already stores a commander snapshot so Heroes can be added later without rewriting the World engine.

## What currently works

### City

- Shared City / Star Map command navigation with live resources, Might, Energy, fleets, standing and wounded.
- Fourteen buildings, two build slots, offline progress and explicit Command Core prerequisites.
- Three independent training buildings and queues, slider quantities, T1–T10 unlocks and low-tier promotion.
- Research Institute with Development / Economy / Battle dependency trees; all completed effects apply to the account.
- Medical Bay healing queue and Hospital-capacity logic.
- Operations Queue combines build, Army, Navy, Air, research, medical and placeholder rally state.
- Wallet-bound local GM tools for resources, troops, queues, research, levels and reset.

### Star Map

- 512×512 sparse coordinate State designed for 1,024 civilizations.
- Strategic / field / tactical zoom, target clustering, bookmarks, coordinate viewing and fixed Home recentering.
- Rival civilizations display a numeric city-level badge plus player name; no `TH` prefix.
- Cash/Oil/Power planets show level, occupancy state, travel time and remaining supply.
- Per-tier troop load is authoritative. `AUTO MIN` and `FILL MAX` stop at the smallest useful gathering fleet.
- Resource planets below 25% retire after a fleet leaves; depleted planets respawn full at a new legal coordinate.
- Rogue planets use explicit L1–30 power/reward rows: L1–6 outermost, L25–30 nearest the Wormhole.
- Rogue combat reserves real troops and Energy, resolves on arrival, applies wounded/dead through Medical Bay capacity, respawns defeated targets and delivers rewards only on return.
- Selecting a rogue force shows estimated victory/defeat and wounded/dead before dispatch.
- Scouting, city attacks, recall, immutable arrival/return reports and troop conservation are wired through the same headless engine.

### Balance/data

- `docs/numbers.json` is schema v0.9 and remains the only gameplay-number source.
- Admin edits local overrides; team changes still require Export → replace `docs/numbers.json` → commit.
- Current World ruler: a 60%-filled mixed fleet at matching Command Core level has ~57% PvE win ratio and ~1.5–1.8% winning casualties.
- `npm run balance:world` currently reports zero issues across all 30 rogue levels.
- `npm run check` currently passes 110 tests, TypeScript and the production build.

## Next work, in order

### P0 — finish the first-session World loop

1. ~~Add rogue progression guidance + find-next-rogue.~~ **DONE (Claude, 2026-09-08)** — NEXT ROGUE tool, `READY`/`DEFEAT Lx FIRST` gating, and on-demand local rogue supply so L1 is always beside a fresh player. See "Latest changes".
2. Run a fresh GM session through L1→L5 rogues and a complete gather/return cycle. Verify Energy, sequential unlock, victory/defeat, Medical Bay overflow, report copy, return settlement and respawn from the visible UI—not only unit tests. (Engine paths verified; still worth a manual UI playthrough.)
3. Improve force selection without changing combat math: one recommended counter composition action, clear march-cap/load explanations and optional 25% / 50% / useful-max presets.

### P1 — tune Personal Mode as a game

4. Playtest the full Command Core L1→10 account loop. Decide whether the balanced-account target should remain ~4–5 days; then tune early troop starvation, Cash pressure and late Warehouse overflow in the integrated simulator.
5. Playtest target density and travel: time-to-nearest useful planet/rogue, L1 availability, resource competition, Energy cadence, city raid damage and burn duration. Change target bands before changing explicit numbers.
6. Turn report history into a clearer battle report: force composition, power comparison, counters, casualties, rewards and return state. Keep the current engine result authoritative.

### P2 — prepare a real multiplayer alpha

7. Replace `src/lib/world-adapter.ts` localStorage authority with authenticated server commands, server time, atomic target locks and durable persistence. Do not ship paid items or token mechanics on browser-local authority.
8. Replace deterministic NPC stand-ins with real player summaries and add server-driven world feed/realtime march updates.
9. Only then add alliance territory, roles, chat, rally, alliance tasks and shared war objectives. Rally in the current Operations Queue is intentionally only a placeholder.

### Later

- Heroes, commander equipment and NFT-avatar presentation can use the existing commander/profile seams.
- Final 2.5D/mobile production starts only after the text/grid version proves retention and monetization.
- Token, faucet/sink and paid Warp Engine design require a separate economic/security review before implementation.

## Known gaps

- Current NPCs are browser-local test stand-ins, not synchronized players.
- Sequential rogue progression is enforced by the engine but still needs the P0 map guidance above.
- Alliance, rally, chat, resource-tile PvP, reinforcements, usable relocation items, heroes and world bosses are not implemented.
- Wallet login is display-only `personal_sign`; production auth must support smart wallets/EIP-1271.
- Blockscout proxy is development-only and needs a server/Worker proxy before deployment.
- The production bundle emits a non-blocking >500 kB chunk warning; code splitting can wait until routes stabilize.

## File map

- `STATUS.md` — full history and decisions
- `docs/DIRECTION.md` — product direction and locked principles
- `docs/numbers.json` — gameplay values
- `docs/WORLD-MVP.md` / `docs/WORLD-BALANCE.md` — World contract and reproducible balance ruler
- `src/Town.tsx` / `src/World.tsx` — player surfaces
- `src/lib/game.ts` — persistent City/account rules
- `src/lib/world-engine.ts` — authoritative UI-free World state machine
- `src/lib/world-adapter.ts` — temporary browser-local bridge; replace this for multiplayer
- `src/lib/expedition.ts` — carry, scouting, gathering and combat calculators
- `src/lib/world-balance.ts` — deterministic World diagnostics

When handing off again, update this file and the date/current-focus block at the top of `STATUS.md`.
