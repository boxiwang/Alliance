# ALLIANCE — current handoff

**Updated:** 2026-09-08  
**Scope:** Personal Mode first. Alliance gameplay and final art direction remain later layers.  
**Environment:** local-only; do not deploy yet.

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

1. Add **rogue progression guidance**: show `READY` or `DEFEAT Lx FIRST`, disable impossible dispatches and provide a “find next rogue” camera action. A fresh player must be able to locate L1 without manually combing 512×512.
2. Run a fresh GM session through L1→L5 rogues and a complete gather/return cycle. Verify Energy, sequential unlock, victory/defeat, Medical Bay overflow, report copy, return settlement and respawn from the visible UI—not only unit tests.
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
