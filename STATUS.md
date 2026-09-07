# STATUS — Alliance / RUGLANDS

**The handoff doc.** Update this every time work changes hands. Read `docs/DIRECTION.md`
for the *why*; this file is the *where we are right now*.

---

**Last updated:** 2026-09-06 · **by:** Codex (near-field growth + gathering rules)
**Current focus:** Personal-city progression and the local World loop are now playable. Next is balance playtesting and shared-world/server architecture before hero/alliance layers.

### 🌌 Degen Cosmos World + intelligence UX (Codex)
- Re-skinned the existing SVG World as an asset-free **onchain star map**: wallet civilization, resource
  planets, rogue planets, starfield/nebula, sector HUD, target lock, fleet routes and center Wormhole.
- Three zoom layers now enforce map readability: strategic view keeps only the player's landmark visible and
  clusters resource/hostile signals; field view expands non-player targets; tactical view adds names and detail.
- Camera/marker scale was corrected after playtesting: the player's node is the true default center even at a
  State edge, **MY NODE** restores that exact center through the full **1×–8×** range, and labels/ordinary icons
  keep a stable screen size instead of inflating with zoom. The old drifting home pulse was removed.
- Strategic view now hides rival players, enlarges only the player's node/Core, and groups non-player signals;
  rival wallet nodes appear only at search zoom. Tactical resource/hostile markers switch to 💰/⛽/⚡/💀,
  while 47 deterministic NPC cities use player-like crypto handles for local discovery testing.
- Preserved the locked **no-fog** rule. Cities and hostiles begin as public signals; scouting upgrades them to
  verified intel and reveals force/loot detail. Resource nodes stay fully public as open-ledger targets.
- Added coordinate viewing, layer toggles, persistent saved signals, report-to-target navigation, real-time fleet
  state, real engine recall, capacity-aware MAX and arrival/return mission notifications.
- `VIEW COORDS` is camera-only and leaves HOME unchanged. Real relocation is reserved for the future
  consumable **Warp Engine**; the current WARP control is visibly locked and never moves the player.
- Resource and rogue targets now round-robin around every active civilization (resources 6–18 tiles,
  rogues 10–26) and respawn into the living population band. Existing local World v1 saves migrate idle
  targets once without resetting Town progress or changing active march destinations.
- Mature-State density is now **3 resource planets + 1 rogue per civilization** (young-State floors remain
  240/120). Resource rounds rotate Cash/Oil/Power so a complete local cycle cannot randomly omit one economy.
- All selectable targets show research-adjusted one-way march ETA. Resource levels now define an explicit
  recommended crew and hard headcount cap; `AUTO ASSIGN` fills up to the player's available/capacity limit.
  Undersized high-load fleets can only harvest a proportional share, and nodes below 25% retire after the
  fleet withdraws before returning through the timed respawn loop. Admin exposes both crew and threshold.
- Removed the rotating Wormhole ellipse; only the star layer rotates very slowly (420s) for depth.
- Fixed a React Strict Mode authority bug found during browser testing: persistence side effects no longer run
  inside a repeated state updater, so recalled fleets cannot duplicate. Covered GM-fill→dispatch→recall paths.
- Browser-verified public → scanned target, filtering, coordinate jump, bookmarking, dispatch, recall, return
  conservation and mission feedback. Full repo check: **97 tests + TypeScript + production build green**.

### ✅ Research effect closure (Codex)
- All **696 research levels** explicitly store `category: development|economy|battle`. Validation rejects
  uncategorized/cross-category rows and effect keys not registered to a live account system. Admin shows Category.
- Research Institute shows completed bonuses currently active on the connected wallet.
- `Command Tactics` at Academy 9/19/29 is functional: each milestone adds one simultaneous World march,
  moving the default account from **2 → 3 → 4 → 5** queues, including existing sessions after reconciliation.
- Closed the previous healing gap: casualties retain Army/Navy/Air + Tier identity; Hospital now has a persisted
  healing queue, cost, time, slider and upgrade lock. Healing speed shortens the queue, Medical Expansion adds
  real available beds, and completion restores the original tiers. Legacy scalar wounded remain recoverable as T1.
- Runtime wiring matrix: `docs/RESEARCH-EFFECTS.md`. Acceptance covers all 30 effect families, category coverage,
  live march queues, city/gather/combat calculators, healing and migration. **89 tests + TypeScript + build green**.

### 🪖 Training + promotion v0.8 (Codex)
- Army Camp / Naval Base / Airfield now follow the Kingshot building ladder: T1–T10 unlock at building
  **1/4/7/11/13/16/19/22/26/30**; base batch capacity is an explicit **17→209** level table and
  building training-speed bonuses are explicit at every level. Our Army/Navy/Air attack, defense, load,
  power and Might values remain unchanged.
- Training quantity is a slider with a live maximum, full batch cost and adjusted completion time. Each
  building still owns one independent queue.
- Promotion unlocks at training-building Lv.13. Existing lower-tier troops can be reserved into the same
  queue and promoted to any unlocked higher tier; cost and time are target minus source, and promotion
  batch size scales by that time difference. Source troops leave standing forces immediately and the
  target tier arrives at completion, so troops cannot be deployed twice and Might gains only the tier delta.
- Operating buildings are hard-locked in both directions: an Academy cannot upgrade while researching and
  cannot research while upgrading; a training building cannot upgrade while training/promoting and cannot
  train/promote while upgrading. The invariant is enforced below the UI and respected by GM level controls.
- Kingshot unlock/capacity/training data changed the tier available at several World reference checkpoints;
  corresponding monster power and TH10/TH15 Wall reference values were rebaselined so declared PvE/PvP
  balance bands remain clean. Superseded by the 89-test research-effect closure check above.

### 🔬 Academy v0.8 — complete playable three-tree baseline (Codex)
- Researched Kingshot's live tree structure and adapted it rather than copying its economy. RUGLANDS now has
  **183 technologies / 696 upgrades**: Development **45/129**, Economy **36/108** (three resources rather
  than Kingshot's four), Battle **102/459**. Full baseline queue time = **383.4 days** before research-speed bonuses.
- Every upgrade is explicit in `numbers.json`: Academy gate, prerequisites, Cash/Oil/Power cost, time, cumulative
  effect and Might. Reproducible seed = `scripts/bake-research.mjs`; design/tuning guide = `docs/ACADEMY.md`.
- Real player state landed: permanent completed levels, one persisted queue, old-save migration, resource deduction,
  Academy/predecessor/prerequisite enforcement, offline completion and research Might.
- Effects are wired into the current game: construction/research/training/healing speed, training capacity,
  resource-specific production/gathering, Hospital capacity, march queues/capacity, and universal +
  Army/Navy/Air combat stats.
- Town's **Research Institute** card opens a dedicated full-screen secondary surface (GM also has a direct
  **Open Research** action). Development/Economy/Battle are long text-only dependency trees: prerequisites are
  always above dependents, lines are generated from `numbers.json`, and selecting a node highlights its direct
  paths plus a sticky requirements/cost/time panel. Admin gained an organized **Research** page with branch/phase filters and
  editable per-level tables. GM Finish queues completes the active Academy research; **Max research** completes all
  three categories so every account effect can be tested immediately; Reset city clears research.
- Validation checks all 696 rows and their references. Browser-verified Admin navigation/table layout; full repo
  check is green.

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
   the base 2 queues enhanced to 5 by Command Tactics; out until return; losses/wounded apply.
5. **Scout only on enemy cities/monsters**, never resource nodes.

**First corrected build (DONE locally):**
- `src/World.tsx` is the real player surface: coordinate SVG world, drag/pan/zoom, wallet-deterministic outer spawn, fixed Circle center, distance-gated target zones, Town ↔ World navigation.
- `src/lib/world.ts` persists one local world per wallet and owns NPC targets, march queues, reports and return settlement.
- Dispatch reads **actual standing troops** from `GameState`, enforces single-march capacity and the wallet's
  researched active-queue limit (base 2, maximum 5), removes troops immediately, then returns survivors and applies wounded/dead/resource outcomes.
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
  Current coverage is included in the **89-test** full repo check above.
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
- The live local map now renders a 512×512 State with 48 sparse test civilizations (configurable in Admin),
  real fields/crews, Energy, queue capacity, shield/Wall state and immutable arrival/return reports.
  New players start on the outer rim; the camera may render the surrounding deep-space grid so any edge home
  can still occupy the exact screen center.
- Browser-verified gather, scout and city-attack flows: troops reserve and return correctly, gather
  rewards arrive only on return, scouting does not reserve a preselected force, and defeat applies
  wounded/dead before returning survivors. Report values use the same large-number denomination as Town.

## 🎯 Decisions locked (this session)
- **No medieval theme. World direction is now Degen Cosmos:** wallets are civilizations, outdoor resources
  are planets, PvE targets are rogue planets, and the center progression gate is the Wormhole. Existing city
  art exploration remains non-binding until the later art-production pass; code continues to use stable Keys.
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
- **Kingshot-shaped training and promotion:** exact building unlock/capacity/speed and troop cost/time ladders,
  slider quantity selection, live total cost/time, same-queue lower-tier promotion, persisted promotion state,
  operating-building upgrade locks and save migration. See `docs/TRAINING.md`.
- **Human-readable Balance Lab:** `/?admin` is organized into Pacing / Buildings / Troops / Game rules / Advanced. Buildings are grouped by purpose; table columns are grouped by cost, timing, output, unlock, training and combat. System keys/notes stay out of the normal workflow.
- **Wallet-bound local GM mode:** open `/?gm` in the Vite dev server and connect the test wallet once. Town gets Fill resources / Fill troops / Finish queues / Max research / Open Research / Selected building +1 / Townhall +1 / Reset city / Disable GM controls. Reset creates a clean but playable TH1 save with zero resources/troops. The grant is stored only for that browser + wallet, no address is committed, and production builds ignore `?gm`.
- **Large-number denomination:** the UI presents resources and troop headcount at ×1,000. Costs, capacity and production use the same display denomination, so pacing and queue timing do not change. Both multipliers are editable under Admin → Game rules.
- **Might v0.6:** total Might is split into permanent Infrastructure Might + fielded Troop Might. Building rows carry explicit cumulative Might; troop Might is displayed headcount × tier power. With all buildings Lv.30 and each arm at 60% capacity in T10, the current baseline is **23.9% infrastructure / 76.1% troops**. Might is a progression/status score, not the battle formula.
- **Alliance/Solo onboarding separation:** wallet-held memecoins are the only cards in the Alliance picker. Solo is a separate Personal Mode path and is stored/displayed as “no alliance,” never as a synthetic alliance or banner.
- **Local test suite:** `npm run check` runs TypeScript, 89 tests and the production build. Dependency audit is clean (0 vulnerabilities).
- **Art-direction exploration (concept only):** three desktop SLG concepts are saved under
  `docs/art/concepts/`. V1 establishes Degen Freeport, V2 broadens the audience with civic life and
  NFT identity, and V3 converts it to a chunkier, more readable chibi 2.5D toy-diorama style.
- **Playable coordinate World (local Personal Mode):** Town → World → select field/crew/rival → scout/gather/attack → timed outbound/work/return march → troop/resource/casualty settlement. The scalable headless engine is authoritative; a temporary local adapter persists it per wallet until the shared server exists.

## 🔜 Next up (immediate — for whoever picks this up)
1. Add an Academy pacing/max-output simulator that runs research alongside TH1→30, reports resource contention,
   completion dates and max city/gathering/march/combat values; tune the v0.8 seed from real play sessions.
2. Add force presets (25%/50%/max), recommended counter composition and march-cap explanations to the
   visual shell after the engine adapter is stable.
3. Playtest target density, Wall damage/burn duration and Energy behavior; adjust declared target bands
   before retuning explicit values when the desired experience changes.
4. Add resource source/sink breakdown to the pacing simulator, then playtest/tune the full L1→L10 city loop.
5. Before a real multiplayer alpha: put this authority behind authenticated server commands, server time,
   atomic target locks and durable persistence. LocalStorage remains a test-only adapter.
6. Art remains independent: lock/revise V3 chibi Degen Freeport and build one vertical slice when mechanics are stable enough.

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
- `docs/ACADEMY.md` / `docs/RESEARCH-EFFECTS.md` — research tree design and account-runtime wiring matrix.
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
