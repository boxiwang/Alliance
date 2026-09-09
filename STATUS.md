# STATUS — ALLIANCE

**The handoff doc.** Update this every time work changes hands. Read `docs/DIRECTION.md`
for the *why*; this file is the *where we are right now*.

---

**Last updated:** 2026-09-08 · **by:** Codex (Frontier I public ecology, L20 ceiling, sector-balanced density, randomized refill, search-first Deep Scan)
**Current focus:** Local World loop is playable and now behaves like shared geography rather than a personal quest generator. Next: fresh L1→L5 + gather/scout playtests from the UI, tune the full L1→20 Frontier I account, design Wormhole graduation/Map II resources, then server authority and alliance layers. **Full details are in `HANDOFF.md` → "Latest changes (Codex, 2026-09-08)".**

### 💬 Circular World + shared Messages mock (Codex, 2026-09-08)
- Corrected the geometry mismatch: World rendering and every placement path now share one circular radius. Spawn grid 40 preserves 1,024 city slots after circle clipping; a full 5,200-entity State is acceptance-tested inside the circle.
- Local World save v6 migrates square-corner cities and idle targets inside once without resetting City progression.
- Added `MESSAGES` beside City / Star Map in the shared command bar. The interactive UI mock covers Alliance, World, System and PM channels, plus coordinates, rally cards, context panels and local composing. It has no backend yet.

### 🌌 Frontier I public ecology (Codex, 2026-09-08)
- Frontier I exposes Rogues **L1–20** and resource planets **L1–8**. Higher explicit rows remain reserved for Map II rather than leaking into the starting State.
- Removed the reconcile-time `ensureLocalTargets` quest bubble. Public targets are distributed through 32×32 ecology sectors, trend upward toward the Wormhole with ±1 level overlap, and do not react to an individual kill.
- Young State floor: 480 planets + 180 Rogues. At 1,000 active cities: 3,200 planets + 1,000 Rogues (hard caps), about 6.2 tiles characteristic spacing inside the circular annulus.
- Rogue recycling is randomly delayed 3–10 minutes; planet recycling 5–15 minutes. Level is conserved, coordinate changes, and population stays stable.
- `NEXT ROGUE` searches the public ecology first. An explicit click can Deep Scan only L1–6 when no matching target exists within 55 tiles; discovered targets appear 28–50 tiles away and are limited per player/per level with a 10-minute cooldown.
- `numbers.json` schema is **v0.10**. Admin World exposes the population, cap, level ceiling, sector, Deep Scan and lifecycle windows. Engine coverage is 116 tests; balance remains clean at L1–20.
- Only World content is capped in this pass. City L21+ stays testable until the future Map II/Wormhole/new-resource gate is specified and implemented as one system.

### 🛠 World-experience fixes (Claude, 2026-09-08)
Built on Codex's Star Map pass; `npm run check` = 110 tests + build green, `balance:world` = 0 issues at that commit. Highlights: fixed the old-save load white-screen; bounded winner casualties by enemy strength; established low-outer/high-inner geography and level-preserving respawn; added the NEXT ROGUE/lock guidance; made scout a fast unarmed rival-city recon; improved entity spacing and name-plate/march-line legibility. Its reconcile-time local-supply rule was superseded by the public-ecology pass above.

### ⚔ Star Map player identity + load/PvE closure (Codex)
- Rival test civilizations now read like players, not map resources: tactical view shows a Kingshot-shaped
  circular **city-level number + player-name plaque**, with no `TH` prefix. The player's own live profile name and
  Command Core level use the same visual grammar. Local NPCs are deterministically spread across levels 1–30;
  browser-local World sessions migrate once without resetting the player's City.
- Gathering is now **load-authoritative**. Army/Navy/Air tiers retain distinct `load` values; `AUTO MIN` and row
  `FILL MAX` stop at the smallest useful troop set for the planet's remaining supply and march headcount. The
  engine rejects only genuinely removable excess troops and no longer scales harvest by a legacy crew fraction.
- Rogue planets now have explicit **L1–30** rows: six levels per radial zone, rising toward the Wormhole. Each level
  targets a 57% reference win at the matching Command Core level. Prepared wins have small but real casualties;
  casualties enter the Medical Bay first and overflow becomes permanent deaths.
- Rogue power is public; scanning reveals counter identity. Selecting troops shows an estimated
  `VICTORY/DEFEAT + wounded/dead`, while arrival/return reports remain authoritative. Admin World exposes all 30 rows.
- `numbers.json` schema is **v0.9**; v0.8 local Balance Lab overrides preserve unrelated tuning during migration.

### ✦ Product-console visual/interaction pass (Codex)
- Star Map geography no longer manufactures resource/rogue halos around each city. Targets are distributed
  across the full legal map, and both initial spawn and respawn recalculate difficulty from radial geography:
  resources use L1–2 then +2 per inward zone; rogues use L1–6 then +6 per zone toward the Wormhole. Existing local sessions migrate
  once to this rule without touching active marches or Town progression.
- Tactical planets now use integrated SVG surface emblems (coin stack, fuel drop, energy bolt and rogue skull)
  plus subtle contouring instead of an emoji pasted over the sphere. Empty-tile coordinate labels stay at a
  constant compact screen size even at 16× zoom, and troop-row `FILL MAX` is visibly styled/labeled as an action.
- Depleted fields remain hidden, retain their configured respawn delay and return full at a new legal coordinate;
  lifecycle and radial-level migration are covered by engine tests.
- Star Map now shares City's exact `GameNav` without a World-specific variant. Its new black hole and slow-moving
  starfield live in the **page backdrop**, outside the draggable/zoomable SVG map, so camera movement never moves
  or scales the background effect. The Wormhole remains a separate actionable landmark inside map coordinates.
- Field zoom renders Cash/Oil/Power as small shaded planets with rings; Tactical zoom switches resources and rogues
  to larger planet bodies with centered 💰/⛽/⚡/💀 and a compact numeric level badge instead of letter markers.
  Tactical names/status/ETA stay in the click-through inspector rather than overlaying the map, keeping it readable
  like a native SLG; selection is communicated by the lock ring instead of another text label.
- Resource occupancy has a live visual protocol based on the occupying march: blue ring/pip for the player's fleet,
  green for the same meme alliance CA and red for a rival alliance. Player alliance identity is carried in the World
  model now; legacy saves remain compatible while server/NPC alliance data can populate the same field later.
- Fleet movement uses a larger directional triangle cursor rather than a tiny rocket emoji. It rotates from the actual
  outbound/return heading, retains route/ETA feedback and changes to the combat color for hostile marches.
- Deep Tactical zoom now reaches **16×** (previously 8×) through multiplicative button/wheel steps. Ordinary markers
  remain stable through Field view, then grow gently up to 2× screen size at maximum zoom so planet bodies, emoji and
  level badges become readable without turning into oversized map overlays. Grid strokes, sector rings and star points
  retain constant screen weight at deep zoom instead of inflating into distracting bars and blobs.
- The right console now defaults to live nearest signals and real sensor events, opens the existing target/dispatch
  controls on selection, and returns to signals through an explicit close.
- City now renders a deterministic, randomly distributed Canvas starfield instead of tiled CSS dots: three depth
  bands drift at different speeds, bright stars breathe subtly, and a slow blue-violet nebula supplies spatial
  movement without image assets or runtime requests. Reduced-motion clients receive a static frame.
- **Might** is a prominent gold account metric in the sticky command bar, beside a unified segmented
  **City / Star Map** control. Cash/Oil/Power, Energy, fleets, standing and wounded remain stable across views;
  the top bar now keeps only current balances, uses larger labels and reserves a visible **Credits** purchase slot.
- Wallet identity now generates a compact civilization sigil, and City gives the player's live **Civilization Core**
  its own command landmark. The right inspector defaults to placeholder **Daily Tasks**, with a second **Signals**
  tab assembled from real build, training, research, fleet and wounded state.
- City's former Build Queue is now one **Operations Queue** for the whole account: two real build slots,
  independent Army/Navy/Air training slots, Research, Medical and Rally. Every implemented system reads its
  persisted live timer, target, quantity and progress; Rally stays an honest available/empty slot until its
  server-backed engine lands rather than presenting a fake countdown.
- Research details now name the exact affected account system (for example all building timers, Army attack,
  Cash gathering or three-service training capacity) and separate the currently active bonus from the selected
  level's bonus. The dependency-tree cards were reduced to technology name, Institute gate and level state;
  duplicated effect values remain only in the dedicated details surface.
- Building and Resource Network cards now show only identity, level/production and a compact status such as
  `READY`, `NEEDS RESOURCES`, `BUILDERS BUSY` or the relevant TH lock. Selecting any unlocked building opens
  its real upgrade surface in the right inspector.
- Upgrade requirements are no longer squeezed into the small cards. The inspector gives Cash/Oil/Power separate
  requirement cells with required and available amounts; sufficient cells turn green, shortages turn red, and
  the action only turns green when resources, prerequisites, build slots and building-operation locks all pass.
- Star Map copy was reduced to control/data language: shorter map status and coordinate controls, compact intel,
  facts, fleet, saved-signal and report labels, and a minimal empty state. Mission results remain verbose enough
  to explain outcomes.
- Browser-verified City default, Townhall detail/upgrade, all eight operation slots, compact Research tree/detail
  and Star Map target panel/radial geography. Full repo check: **108 tests + TypeScript + production build green**.

### 🧭 Personal-mode navigation/UI mockup (Codex)
- Product name is now **ALLIANCE** in the app chrome, page title, Balance Lab and naming sources. Existing
  `ruglands:*` localStorage keys intentionally remain unchanged so test wallets do not lose progress.
- Returning-player card now shows only the player name and the Townhall level read from the live saved game;
  stale profile level and the meaningless “No alliance” label are gone. The prompted Personal Mode explainer
  was removed, while Choose an Alliance remains untouched for its later dedicated pass.
- City and Star Map now share one sticky **Command Nav** in the same screen position. It keeps player/TH/Might,
  sector/home coordinates, Cash/Oil/Power balance + production, Energy, fleets, standing troops and wounded
  visible through both views. The old duplicate World status bar and City resource deck were removed.
- The nav inherits the higher-quality **City Liquidity / Resource Network** language: three color-coded balances
  and stable metric cells. Production rates remain in Resource Network where they are actionable instead of being
  repeated in the global bar. The old bottom-of-page “Enter the World” gateway is removed,
  so building/research/training and outdoor actions behave like two views of one persistent account.
- City is now a stable two-column workbench instead of a stack of every subsystem: equal-height, higher-contrast
  building cards stay visible on the left while a non-modal sticky inspector on the right shows upgrade details,
  Train/Promote, Hospital recovery or the Research tree. There is no backdrop or full-screen transition. The
  permanent Training Grounds section is removed.
- City copy now follows a strict **name / level / state / cost / time / unmet gate** hierarchy. Building blurbs,
  duplicate facility headings, research teaching copy, empty bonus explanations and already-satisfied prerequisites
  were removed. Locks and disabled controls carry the rules; hover titles preserve secondary explanations.
- Bank/Oil Well/Power Plant now live in a compact **Resource Network** strip with production and click-through
  upgrade status. Command and operational facilities are separate groups; cards use one integrated state footer
  and send detailed requirements to the inspector. A dependency-free monochrome SVG set replaces inconsistent
  building emoji.
- Opening Research Institute now changes the same City workspace into a **220px facility rail + wide research
  canvas**. It is not a modal or route change; other buildings in the rail remain clickable, and leaving research
  restores the normal building grid plus inspector layout.
- Research no longer has its own vertical scroll container: the selected category renders to full height and the
  main City page owns vertical scrolling. Tree nodes are smaller but use larger type/level badges, tighter rows and
  near-hidden non-focused connectors. Ordinary buildings now use a three-column 94px grid with larger labels,
  replacing the previous oversized two-column cards and empty space.

### 🧪 Integrated personal-mode simulator + dispatch closure (Codex)
- Admin → Pacing now has a deterministic **whole-account simulator** alongside the original rush-TH model.
  It runs two builders, the Research Institute, Army/Navy/Air queues and configurable full-planet gathering
  against one resource wallet, with Growth/Balanced/Military strategies and TH10/TH30 targets.
- The simulator reports a reconciled Cash/Oil/Power source/sink ledger, Warehouse overflow, queue utilization,
  research branch completion/effective bonuses, end-state troop totals/Might and the dominant bottleneck.
- Current bundled-number baseline (Balanced, 3 visits/day, 85% builder, 80% research, 75% training,
  1 full planet/day): **TH10 ≈ 4.6d; TH30 ≈ 140d**. This does not replace the 3.0d/123d rush-TH
  target; it exposes the cost of maintaining all personal-mode systems at the same time.
- First actionable balance signal: Cash remains the dominant constraint. At TH10 training queues are only ~3%
  utilized while research is ~78%; at TH30 Warehouse overflow is extremely high, so late economy/capacity
  needs tuning rather than simply adding more production.
- Pulled Claude's latest tactile World dispatch pass: empty-tile coordinates, per-tier sliders/MAX, selected
  fleet totals, live harvest drain, rocket/ETA and live fleet/archive feedback. Fixed harvest preview/live drain
  to include the wallet's Academy load modifier, and fixed recalled rockets to reverse from their actual
  outbound position instead of visually teleporting.
- Added integrated simulator and World rendering regression coverage. Browser-verified TH10/TH30 Admin output,
  resource selection → MAX → Academy-aware estimated haul, dispatch rocket and live recall state.
  Full repo check: **105 tests + TypeScript + production build green**.

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
- Resource and rogue targets are globally distributed neutral geography; this supersedes the earlier
  per-civilization 6–18/10–26-tile halo rule. Existing local World v1/v2 saves migrate idle targets once without
  resetting Town progress or changing active march destinations.
- Mature-State density is now **3 resource planets + 1 rogue per civilization** (young-State floors remain
  240/120). Resource rounds rotate Cash/Oil/Power so a complete local cycle cannot randomly omit one economy.
- All selectable targets show research-adjusted one-way march ETA. Resource dispatch derives the minimum useful
  fleet from per-tier carry capacity; `AUTO MIN` never adds troops whose load would be wasted. Nodes below 25%
  retire after the fleet withdraws before returning through the timed respawn loop.
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
- Admin gained a human-readable **World** page with grouped settings, now expanded to editable L1–30 rogue rows and
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
1. Finish fresh-player rogue guidance: show the sequential unlock requirement, disable impossible dispatches
   and add a **find next rogue** action so L1 is discoverable without manually searching the full map.
2. Browser-playtest L1→L5 rogues plus one complete gather/return cycle, including Energy, Medical Bay overflow,
   reports, rewards and target respawn. Unit coverage exists; this step validates the visible player loop.
3. Add one recommended counter composition action plus optional 25%/50%/useful-max presets; keep the existing
   engine combat and per-tier load rules authoritative.
4. Tune the **L1→10 playable account** with fresh sessions and the integrated simulator: decide whether 4–5
   balanced days is correct, then address early training starvation, Cash pressure and late Warehouse overflow.
5. Playtest target density/travel, L1 availability, city raid damage/burn and Energy cadence. Change declared
   target bands before retuning explicit rows.
6. Before a real multiplayer alpha, put World authority behind authenticated server commands, server time,
   atomic target locks and durable persistence. Then replace NPCs with real players; alliance systems come after.

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
