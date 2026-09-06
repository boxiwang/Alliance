# STATUS — Alliance / RUGLANDS

**The handoff doc.** Update this every time work changes hands. Read `docs/DIRECTION.md`
for the *why*; this file is the *where we are right now*.

---

**Last updated:** 2026-09-06 · **by:** Codex (headless World wired to local player UI)
**Current focus:** The scalable World engine now powers the existing visual map through a temporary browser-local GameState adapter. Next is player-facing force-selection guidance and balance playtesting before shared-server persistence.

### 🧮 Data-balance pass (this session, Claude)
- **FIXED — per-building upgrade-time monotonicity:** every building's time dipped at L10→L11
  (L11 upgrade was *faster* than L10; a piecewise-curve seam). Re-sloped L11–30 as a smooth
  monotonic ramp; 0 non-monotonic steps remain. Re-verified via the headless simulator:
  **TH10 ≈ 3.0d, TH30 ≈ 123.5d (~4.1 mo)** — still on the 4–5-month target. Only `timeSec`
  values changed. (Ran the sim in Node: `node --experimental-strip-types` against `simulator.ts`.)
- **OPEN — resource mix (Cash-lean):** total sink demand is Cash 47.5% / Oil 28% / Power 24.5%,
  but L30 production is 38.5% / 30.8% / 30.8% → Cash demand/supply ≈ 607h vs Oil 447h / Power 391h.
  Cash is a ~1.5× harder pinch (oil/power will pile up). **Decide:** raise Bank output ~20% (or trim
  cash costs) to equalize, OR keep Cash as the intended primary pinch. Not yet changed.
  (Verdict after benchmarking WoS/RoK/Last War: **model is genre-sound**; a primary pinch resource is
  normal — WoS=iron, Last War=oil-late — so keeping Cash-lean is fine. Our L25≈5.2d/L30≈9.5d per-level
  matches Last War L21–30 (5–7d). Endgame length beyond L30 = Phase-2 depth, not a flaw.)

### 🌍 Tasks 2+3 — outdoor expedition foundation (Claude + Sonnet)
- Design locked (bible §22, DIRECTION §9): personal mode = **async single-player PvP**; concentric
  **world rings** (edge spawn, center = the Circle); **NO fog** (scout = intel); leveled
  **gather nodes 1–10**; combat counter **air>army>navy>air +10%**; loot & gather capped by troop load.
- **Data landed in `numbers.json`:** `gatherNodes` (L1–10: ringZone/totalSupply/gatherRatePerHour +
  academy-speed & hero-carry hooks), `world` (rings/spawn), `global.combat.counter` matrix. `npm run check` green.
- **Endgame "the Circle"** (seniority cohort treadmill + guardrails) logged as Phase-2 in DIRECTION §9.
- **Original engine scope:** `src/lib/expedition.ts` (pure logic: marchTime, carry,
  resolveScout/Gather/Combat, counter, wounded→hospital→dead, loot=load, shield check) + tests +
  a `gatherNodes` editor section in `Admin.tsx`. No UI in Town (logic-only per task 2).
- **Hooks left for later:** hero carry/combat bonus = 0 (task 4); real-player targets (NPC stub now); inner-ring opening (server, later).
- **DONE (Sonnet):** `src/lib/expedition.ts` + 19 tests (`npm run check` green, 40 tests total); `Admin.tsx` gained a **Gathering** tab editing `gatherNodes`.
- **DONE (Claude):** `/?expedition` **Expedition Lab** (`src/ExpeditionLab.tsx`) — hidden points-and-lines test harness: concentric rings, labeled dots (node/monster/rival), pick force → Scout / Gather / Raid → numeric result + march line. Verified end-to-end in browser (combat/counter/wounded/loot all resolve on live numbers).
- **Resolved by Codex:** `resolveCombat` now gates loot to wins and reads injected troop/building tables correctly in tests and admin-tuned sessions.

### 🔧 Outdoor model CORRECTED → first playable build done (Claude → Codex)
The first `/?expedition` lab was built on **wrong SLG assumptions** — it is now **superseded** (keep it as a
dev harness only). Re-researched RoK / Last War / WoS; corrected model in **bible §23** + **DIRECTION §9**.
The 5 corrections:
1. **World is a coordinate map, not player-centric.** Your city is at a random (x,y); camera opens on you but
   you're not the world center; map pans/zooms; fixed center = the Circle; distance-from-center gates level.
2. **Enter the world from the Town** ("World" button) — not a standalone page.
3. **Academy is a passive account-wide modifier** (`global.accountModifiers`), auto-applied. Gather speed comes
   from it (+heroes), **never chosen at a node.** (Removed the node-side academy slider concept.)
4. **Troops are account-bound**: dispatch only what you actually have; limited by single-march capacity +
   `global.march.marchQueueSlots` (=2); out until return; losses/wounded apply.
5. **Scout only on enemy cities/monsters**, never resource nodes.

**First corrected build (DONE locally):**
- `src/World.tsx` is the real player surface: coordinate SVG world, drag/pan/zoom, wallet-deterministic outer spawn, fixed Circle center, distance-gated target zones, Town ↔ World navigation.
- `src/lib/world.ts` persists one local world per wallet and owns NPC targets, march queues, reports and return settlement.
- Dispatch reads **actual standing troops** from `GameState`, enforces single-march capacity and 2 active queues, removes troops immediately, then returns survivors and applies wounded/dead/resource outcomes.
- Gather speed, march speed, attack and load hooks are passive `global.accountModifiers`; the old per-node Academy slider is gone. Scout is rejected for resource fields in UI and engine.
- Combat loot is now win-only; depleted-node gather time uses the amount actually hauled rather than unused carry capacity.
- Local GM gained **Fill troops** and **Finish marches**. `/?world&gm` opens a walletless dev harness for fast World testing; normal players enter from Town.
- Browser-verified: 67K → dispatch 10 internal troop batches → 57K standing → GM return → 67K; reports/resources settle; zoom, Circle recenter, 2/2 queue limit and third-dispatch rejection work with no console errors.
- Current scope remains **local NPC simulation**, not a shared multiplayer server: rival casualties/respawn and cross-player concurrency are deliberately not implemented yet.

### 🧠 Headless Personal World MVP core + local UI adapter (Codex)
- Contract: `docs/WORLD-MVP.md`; implementation: `src/lib/world-engine.ts`; acceptance tests:
  `src/lib/world-engine.test.ts`.
- One 512×512 State supports **1,024 deterministic, farthest-first city anchors**. The first players
  are intentionally sparse; later joins fill gaps. The Circle reserve, five zones and spatial-hash
  nearby queries are enforced without storing empty tiles.
- Full target lifecycle: resource field claim/depletion/relocation; monster engage/defeat/respawn;
  city shield/raid/Wall burn/recovery/relocation without destroying Townhall, Might or permanent progress.
- Full march lifecycle: real troop reservation, queue/capacity validation, travel, gather contention,
  Energy + sequential monster unlocks, scout, city combat, recall, return settlement and troop conservation.
- Feedback is no longer deferred or ambiguous: combat produces an immutable attacker report (and city
  defender report) **at arrival**; surviving troops, loot and rewards enter inventory only **on return**.
- Retry-safe dispatch idempotency prevents duplicated troop reservation/Energy cost/rewards.
- Hero seam is locked now: every march stores two nullable hero slots, resolved modifier/effect snapshot
  and balance version. Adding Heroes later supplies that snapshot and does not rewrite world/march logic.
- Acceptance now covers 1,000 cities + 10,000 deterministic scheduled events. Full repo check:
  **74 tests, TypeScript and production build green**.
- **Balance v0.7 complete:** `npm run balance:world` evaluates weak/standard/strong PvE, gathering,
  equal-progression PvP, travel, Energy and target density against declared target bands. The old data
  exposed 86–99.8% matching-monster win rates, 10–343.9h field occupancy and late-game Wall drift.
  Explicit tables now hold matching PvE at ~56%, field occupancy at ~4h and equal PvP attacker ratio
  at 47% from TH5–30. Rationale and exact reference profile: `docs/WORLD-BALANCE.md`.
- All headless World knobs now live in `docs/numbers.json`: State size, population, lifecycle, Energy,
  city integrity/damage, monster levels/power/rewards/counter identities and balance targets. Existing
  browser-local v0.6 Admin overrides migrate to v0.7 without losing edited values.
- Admin gained a human-readable **World** page with grouped settings, editable L1–10 monster rows and
  live scenario results. Browser-tested: deliberately breaking L1 power raised warnings immediately;
  Undo restored a clean report; no console errors.
- **UI adapter complete:** `src/lib/world-adapter.ts` is now the sole browser-local bridge between
  Town `GameState` and the headless authority used by `src/World.tsx`. Training/resources earned while
  troops are away merge safely instead of overwriting a march result. Existing legacy marches are
  force-settled once, troops/rewards are recovered, then their old save is removed.
- The live local map now renders a 512×512 State with 48 sparse test cities (configurable in Admin),
  real fields/crews, Energy, queue capacity, shield/Wall state and immutable arrival/return reports.
  New players start on the outer rim; the camera clamps to the State instead of exposing off-map space.
- Browser-verified gather, scout and city-attack flows: troops reserve and return correctly, gather
  rewards arrive only on return, scouting does not reserve a preselected force, and defeat applies
  wounded/dead before returning survivors. Report values use the same large-number denomination as Town.

## 🎯 Decisions locked (this session)
- **No medieval theme.** Current leading visual exploration is **Degen Freeport**: a prosperous,
  dangerous Crypto industrial port in a readable chibi 2.5D SLG style. The V3 concept is preferred
  for exploration, but still needs an explicit production lock; see `docs/ART-DIRECTION.md`.
- Economy: 3 resources **Cash / Oil / Power**; 14 city buildings (see bible §20); troops **Army/Navy/Air, T1–T10**.
- **Townhall → L30**; shield lifts at L10; all buildings unlock by TH10.
- **Prerequisites** (numbers.json → townhallPrerequisites): TH→L needs buildings ≥ L−1, **Warehouse anchor**,
  count **2/3/4** across L2–19 / 20–24 / 25–30, fixed & known (not random).
- **Pacing**: L1→L10 in ~2–3 days; L1→L30 in ~4–5 months F2P. Numbers reference real SLG (WoS/CoC/RoK).
- Combat: loot & gather = troop **load**; casualties → wounded (to Hospital cap) then dead; counter **+10% atk** (air>ground>sea>air).
- Offline: collector model, **12h cap, auto-collect on login, no AFK/online mode**.

## ✅ Done
- **Wallet connect** (MetaMask / Phantom / OKX / Coinbase / Uniswap) via EIP-6963 + fallbacks.
- **Read-only chain reads** on Robinhood Chain mainnet (4663): ETH balance, ERC-20 holdings
  (with icons), tx counters — via Blockscout `api/v2` through the dev `/bs` proxy. **Verified
  live** with a real wallet (read 12 real memecoins).
- **Start screen** (`stage` machine): connect → holdings → optional faction pledge (pick one,
  or Start Solo) → **found Townhall**. Resume detection for returning wallets. Top-factions
  board (seed data). Auto-name (`Ruglord…`). Consumer-facing copy. Shield-until-Lv.10 note.
- Player-facing on-chain-activity/tasks **removed** (kept for backend only).
- Dev telemetry sink `/__report` → `/tmp/ruglands-report.json` (lets us inspect the real
  local connect→read→analyze result without a screen).
- **Solo Townhall** playable: 3 resources (Cash/Oil/Power) + 14 city buildings + 3 troop arms
  (Army/Navy/Air), build queue, offline progress, training, might — data-driven from `docs/numbers.json`.
- **Numbers admin** at `/?admin` (hidden): edit ~1,900 explicit values, Save & reload / Reset / Export
  numbers.json. Game reads effective numbers via `src/lib/numbers.ts` (localStorage override or defaults).
  **Tuning workflow:** tune in /?admin → Export → overwrite `docs/numbers.json` → commit (team-shared).
- Docs: `docs/DIRECTION.md`, naming bible (§20 = full building/resource/troop roster), numbers v0.6.
- **Explicit number tables (v0.6):** every building has editable Lv.1–30 rows; every troop arm has editable T1–T10 rows. Runtime building values are table lookups (no `base × growth`).
- **Townhall prerequisites enforced:** `startUpgrade` blocks invalid upgrades and Town UI lists the exact building/level requirements.
- **Local pacing simulator:** `/?admin` models prerequisites, 2 builders, starting resources, production, storage, 12h collection behavior and queue uptime. Default 3 sessions/day + 85% uptime baseline: **TH10 ≈ 3.0d, TH30 ≈ 122d**.
- **Per-level admin tables:** building and troop rows are directly editable; simulator recalculates immediately before save/export.
- **Config validation:** Admin checks missing/negative rows, troop unlock order, prerequisite bands, impossible unlocks, Warehouse/TH capacity deadlocks and pacing drift. Errors block Save.
- **Playable T1–T10 training:** Town UI exposes tier unlocks; training cost/time, completion and Might use the selected tier's row. Old numeric troop saves migrate safely to T1.
- **Three specialized training branches:** Army Camp / Naval Base / Airfield each owns its levels, troop capacity, speed, batch limit and simultaneous queue. Tiers unlock from the matching building level rather than Townhall; old Barracks saves migrate without losing levels or active training.
- **Human-readable Balance Lab:** `/?admin` is organized into Pacing / Buildings / Troops / Game rules / Advanced. Buildings are grouped by purpose; table columns are grouped by cost, timing, output, unlock, training and combat. System keys/notes stay out of the normal workflow.
- **Wallet-bound local GM mode:** open `/?gm` in the Vite dev server and connect the test wallet once. Town gets Fill resources / Finish queues / Selected building +1 / Townhall +1 / Reset city / Disable GM controls. Reset creates a clean but playable TH1 save with zero resources/troops. The grant is stored only for that browser + wallet, no address is committed, and production builds ignore `?gm`.
- **Large-number denomination:** the UI presents resources and troop headcount at ×1,000. Costs, capacity and production use the same display denomination, so pacing and queue timing do not change. Both multipliers are editable under Admin → Game rules.
- **Might v0.6:** total Might is split into permanent Infrastructure Might + fielded Troop Might. Building rows carry explicit cumulative Might; troop Might is displayed headcount × tier power. With all buildings Lv.30 and each arm at 60% capacity in T10, the current baseline is **23.9% infrastructure / 76.1% troops**. Might is a progression/status score, not the battle formula.
- **Alliance/Solo onboarding separation:** wallet-held memecoins are the only cards in the Alliance picker. Solo is a separate Personal Mode path and is stored/displayed as “no alliance,” never as a synthetic alliance or banner.
- **Local test suite:** `npm run check` runs TypeScript, 74 tests and the production build. Dependency audit is clean (0 vulnerabilities).
- **Art-direction exploration (concept only):** three desktop SLG concepts are saved under
  `docs/art/concepts/`. V1 establishes Degen Freeport, V2 broadens the audience with civic life and
  NFT identity, and V3 converts it to a chunkier, more readable chibi 2.5D toy-diorama style.
- **Playable coordinate World (local Personal Mode):** Town → World → select field/crew/rival → scout/gather/attack → timed outbound/work/return march → troop/resource/casualty settlement. The scalable headless engine is authoritative; a temporary local adapter persists it per wallet until the shared server exists.

## 🔜 Next up (immediate — for whoever picks this up)
1. Add force presets (25%/50%/max), recommended counter composition and march-cap explanations to the
   visual shell after the engine adapter is stable.
2. Playtest target density, Wall damage/burn duration and Energy behavior; adjust declared target bands
   before retuning explicit values when the desired experience changes.
3. Add resource source/sink breakdown to the pacing simulator, then playtest/tune the full L1→L10 city loop.
4. Before a real multiplayer alpha: put this authority behind authenticated server commands, server time,
   atomic target locks and durable persistence. LocalStorage remains a test-only adapter.
5. Art remains independent: lock/revise V3 chibi Degen Freeport and build one vertical slice when mechanics are stable enough.

## 🩹 Known issues / polish
- `oldestSeen` (wallet age) reads null for contract addresses; tx-history endpoint shape
  differs for contracts. Low priority.
- Auth is a display-only `personal_sign`. Real login must handle **EIP-1271** (smart wallets).
- Blockscout dev proxy is dev-only → needs a **Cloudflare Worker proxy** for any deploy.

## ❓ Open decisions
- Backend stack final call (leaning Cloudflare Workers + D1 + DO alarms).
- When to move persistence local → D1, and identity stub → real SIWE/EIP-1271.
- Faction "official registry" (which CAs are canonical factions) vs. any-held-memecoin.
- Lock V3 chibi Degen Freeport as the production art direction, or request one more visual iteration.
- NFT avatar scope: Robinhood Chain only for MVP, or later multi-chain discovery (Ethereum/Base/etc.).

## ▶️ Run
```bash
npm install
npm run dev            # http://localhost:5173  (open in a browser WITH a wallet extension)
# For local GM tools, use http://localhost:5173/?gm once with the test wallet.
# Walletless World test harness: http://localhost:5173/?world&gm
```
Read what the local app actually connected to & read:
```bash
cat /tmp/ruglands-report.json
```

## 🗂 Where things live
- `docs/DIRECTION.md` — vision, structure, rules, tech, roadmap.
- `docs/naming-bible.md` — feature Keys + concepts + themed names (**build by Key**).
- `docs/numbers.json` / `docs/NUMBERS.md` — numeric source of truth.
- `docs/ART-DIRECTION.md` / `docs/art/concepts/` — visual proposal, constraints and concept images.
- `src/lib/wallet.ts` — EIP-6963 connect / chain switch / sign.
- `src/lib/blockscout.ts` — read-only chain records.
- `src/lib/profile.ts` — per-wallet save (localStorage), auto-name.
- `src/lib/gm.ts` — localhost-only, wallet-bound GM grant and test helpers.
- `src/lib/simulator.ts` — pure local build/resource pacing model used by Admin.
- `src/World.tsx` / `src/lib/world-adapter.ts` — coordinate-map player UI + temporary local GameState/persistence bridge.
- `docs/WORLD-MVP.md` / `src/lib/world-engine.ts` — scalable World contract + deterministic authority engine (current UI and future server source of truth).
- `src/lib/world.ts` — legacy local engine retained only for one-time safe save migration; do not add new gameplay here.
- `docs/WORLD-BALANCE.md` / `src/lib/world-balance.ts` — reproducible outdoor balance targets, scenarios and operator report.
- `src/lib/factions.ts` — pledgeable-from-holdings + seed top-factions.
- `src/lib/tasks.ts` — derive signals from records (backend/telemetry only for now).
- `src/App.tsx` — start-screen stage machine.
- `vite.config.ts` — `/bs` Blockscout proxy + `/__report` dev telemetry sink.

## 🤝 Handoff protocol
- boxiwang says when work is handed to another collaborator, and when it comes back.
- Whoever finishes a chunk: update **✅ Done / 🔜 Next / ❓ Open** above + the date/by line.
- Simple, well-scoped tasks are delegated to Sonnet to save tokens; complex/context-heavy
  work stays with the lead.
