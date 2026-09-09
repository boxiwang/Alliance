# ALLIANCE — current handoff

**Updated:** 2026-09-08 (Claude — Comms page landed + hosting/monetization plans, on top of Codex's Frontier I)
**Scope:** Personal Mode first. Alliance gameplay and final art direction remain later layers.  
**Environment:** local-only; do not deploy yet.

## Latest changes (Claude, 2026-09-08 — Comms page + plans)

- **Comms (Task-1 chat) frontend landed** in `src/Messages.tsx` (`/?messages&gm&slot=N`, or the COMMS nav tab), replacing the earlier mock. Reuses the real `GameNav` (nav identical across City/Star Map/Comms), `CosmicBackdrop`, and the app's font/colour tokens. Features: Cosmos (server-wide) / Alliance / System channels + Contacts + DMs; **Alliance = one rail tab** with **General / War Room** sub-tabs in the thread (War Room is off by default, gated on alliance management, and each op is a fresh session that clears on end); **System is a filterable notification log** (Military/Economy/Security), not a conversation; actionable **coordinate & rally chips**; **own messages right-aligned** like a real chat app; **alliance tag prefixes every name** (`[ORBT] Name`); safety by design — links stripped, per-message report/mute on hover, repeated messages auto-collapse, verified-holder ✓ badge; minimal copy throughout. CSS is scoped under `.comms-page` in `styles.css`.
- **This is frontend + a LOCAL stub only** (channels/threads seeded, your sends echo locally). It is NOT real multiplayer chat yet — that needs the server adapter below. The seam to build next is a `chat-adapter` (listChannels / getHistory / send / subscribe / presence / report / mute) so the server swap doesn't touch the page, exactly like World's `world-adapter`.
- **Still to wire:** System channel → real local game events (currently sample); a **mini-chat** dock on City & Star Map (Alliance⇄Cosmos toggle, click jumps into full Comms); the `chat-adapter` server implementation.
- **Note:** the earlier Comms mock's `.messages-*` / `.chat-*` / `.channel-*` / `.context-*` CSS in `styles.css` is now unused (dead) — safe to prune later.

### Hosting & monetization (decisions, not yet built)
- **Free hosting stack = Cloudflare** (Pages + Workers + **Durable Objects** SQLite + WebSockets + D1 + R2). DO is on the **free** Workers plan (SQLite-backed) → realtime chat rooms + world shards for $0. Free ceilings: 100k requests/day (incl. each WS message), 100k row writes/day, 5M reads/day, 5GB. Binding limit is requests/day → roughly **~300–1,000 DAU** before the $5/mo Workers Paid plan. So: keep building locally now; deploy to CF free tier only when going multiplayer; pay only at real scale.
- **Design levers to stay free:** hibernatable WebSockets, event-driven (not constant-alarm) world ticks, batched writes, anti-spam (already in Comms).
- **Monetization proposal:** `docs/MONETIZATION.md` (Credits currency; time/convenience + shields/Warp + cosmetics/identity + VIP + season pass; never sell raw power; token-native items gated behind an economic/security review). Proposal only — no items built; `Credits` + `Warp Engine` are just hooks.

## Latest changes (Codex, 2026-09-08)

Frontier I ecology/progression pass:

Frontier I ecology/progression pass:

- **One circular World boundary:** rendering, city anchors, public population, Deep Scan and respawn now share an inscribed 253-tile playable radius instead of mixing a diagonal visual circle with square-generated coordinates. The city candidate grid is 40×40 before circle clipping, preserving 1,024-city capacity. Local World v5 saves migrate out-of-bounds cities and idle targets once.
- **Frontier I has a deliberate ceiling:** this first 512×512 map supports Command Core / Rogue progression through **L20**, with resource planets through **L8**. Rogue L21–30 and resource rows L9–10 stay in the data for later maps; they do not spawn here. Reaching and holding the Wormhole is the future passage to a harder map, where higher targets and potentially map-specific upgrade resources can begin.
- **Public ecology, not personal spawn bubbles:** target population is generated independently of any player's progress and spread with 32×32 ecology-sector balancing plus radial difficulty and ±1 level overlap. Levels still trend upward toward the Wormhole without looking like perfect rings. Killing L3 never causes L4 to appear beside that player.
- **Stable density at young and full population:** a young/local State holds 480 resource planets + 180 Rogues. Population then scales toward **3.2 planets + 1 Rogue per active city**, capped at 3,200 + 1,000 for a 1,000-player State. Including cities, the circular playable annulus has ~6.2 tiles characteristic spacing across 5,200 entities.
- **Delayed, randomized recycling:** defeated Rogues return after 3–10 minutes; depleted/retired resource planets return after 5–15 minutes, at a new legal coordinate and at the same level. Refill is scheduled map ecology, not a response to an individual player's next unlock.
- **NEXT ROGUE is search-first:** it selects a nearby public target of the next legal level. Only an explicit click may use the early-game Deep Scan safety valve for L1–6 when none exists within 55 tiles. A discovered Rogue appears 28–50 tiles away, and each player/level has one target plus a 10-minute cooldown; ordinary reconcile ticks never manufacture targets.
- **Balanced rows remain reusable:** the existing explicit Rogue L1–30 combat/reward rows are preserved. The executable Frontier I ruler now validates L1–20 only: a 60%-filled matching fleet holds ~57% projected win chance and prepared wins stay below 2% casualties.

Claude's immediately preceding pass remains in place:

- **Crash fix (load white-screen):** worlds persisted before a new `world.config` key existed (e.g. `minEntitySpacing`) threw on load/respawn. `openLocalWorldSession` now refreshes `world.config` from `numbers.json` on every load, and `randomLegalPoint` falls back to the default spacing. Old saves open again.
- **Combat casualties fixed:** each side's loss now scales with the OPPONENT's power share (`lossFraction(own,enemy)`), winner ×`winnerLossMultiplier` (default 0.5). Overwhelming force now BOUNDS a winner's losses instead of inflating them — sending more troops past the victory threshold no longer raises casualties (verified: L5 rogue, 60K troops → ~6 dead, not ~1800).
- **NEXT ROGUE button + rogue lock:** map tool jumps to the nearest rogue the player may engage (level ≤ highest-defeated+1), never a higher one. Rogue panel shows `READY` / `DEFEAT Lx FIRST` and disables engaging a locked level. Rogues no longer offer SCAN (their type is public).
- **Scout = fast unarmed recon:** scout travels `scoutSpeedMultiplier`× faster (both ways), carries no troops, and only targets rival CITIES. Its report now details garrison by arm (dominant highlighted), garrison by tier, and lootable resources per type (cash/oil/power) — in-city troops only (marching troops excluded).
- **Entity spacing + map legibility:** `minEntitySpacing` (6) keeps every city/rogue/resource in its own cell; rival city name plates render only when selected (a compact level badge otherwise) so clustered cities never overlap text; own/rival name plate width is now adaptive + centred; harvest march lines are thinner with a 🚀 marker + live ETA (outbound and return); Live Fleets show `EN ROUTE / HARVESTING / RETURNING · countdown`; Mission Archive is results-only (no duplicate in-flight entries).

New ecology knobs are under `world.ecology`, `world.population` and `world.lifecycle`. All are organized in the Admin **World** tab.

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
- Frontier I exposes Rogue L1–20 and resource-planet L1–8. Explicit Rogue L21–30 and resource L9–10 rows are retained for later maps.
- Rogue combat reserves real troops and Energy, resolves on arrival, applies wounded/dead through Medical Bay capacity, respawns defeated targets and delivers rewards only on return.
- Selecting a rogue force shows estimated victory/defeat and wounded/dead before dispatch.
- Scouting, city attacks, recall, immutable arrival/return reports and troop conservation are wired through the same headless engine.

### Messages mock

- City / Star Map / Messages share the exact same command navigation and live account bar.
- Browser-local interaction mock includes Alliance, World, System and PM channels, unread state, pinned orders, coordinate shares, rally cards, contextual alliance/player panels and a local compose interaction.
- This is intentionally UI-only: no message persistence, moderation, realtime transport, voice or server authority exists yet.

### Balance/data

- `docs/numbers.json` is schema v0.10 and remains the only gameplay-number source.
- Admin edits local overrides; team changes still require Export → replace `docs/numbers.json` → commit.
- Current World ruler: a 60%-filled mixed fleet at matching Command Core level has ~57% PvE win ratio and ~1.5–1.8% winning casualties.
- `npm run balance:world` currently reports zero issues across Frontier I's 20 rogue levels.
- Unit coverage includes a full circular 5,200-entity capacity test; rerun `npm run check` before each handoff.

## Next work, in order

### P0 — finish the first-session World loop

1. ~~Add rogue progression guidance + find-next-rogue.~~ **DONE** — NEXT ROGUE is public-search-first, with explicit L1–6 Deep Scan only as an early-game safety valve. See "Latest changes".
2. Run a fresh GM session through L1→L5 rogues and a complete gather/return cycle. Verify Energy, sequential unlock, victory/defeat, Medical Bay overflow, report copy, return settlement and respawn from the visible UI—not only unit tests. (Engine paths verified; still worth a manual UI playthrough.)
3. Improve force selection without changing combat math: one recommended counter composition action, clear march-cap/load explanations and optional 25% / 50% / useful-max presets.

### P1 — tune Personal Mode as a game

4. Playtest the full Command Core L1→10 account loop. Decide whether the balanced-account target should remain ~4–5 days; then tune early troop starvation, Cash pressure and late Warehouse overflow in the integrated simulator.
5. Playtest target density and travel: time-to-nearest useful planet/rogue, L1 availability, resource competition, randomized refill cadence, Energy cadence, city raid damage and burn duration. Tune the ecology controls before changing combat rows.
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
- The Wormhole graduation/next-map system is designed but not implemented; Frontier I completion currently focuses the Wormhole and explains that the next sector is pending.
- Frontier I currently hard-caps **World targets**, not City upgrades. Command Core L21+ remains available for local full-table testing until Map II, Wormhole graduation and any new post-L20 resource gate are designed together.
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
