# STATUS — Alliance / RUGLANDS

**The handoff doc.** Update this every time work changes hands. Read `docs/DIRECTION.md`
for the *why*; this file is the *where we are right now*.

---

**Last updated:** 2026-09-05 · **by:** Claude (expedition engine + lab; outdoor model corrected → rework next)
**Current focus:** Tasks 2+3 outdoor expedition. Engine done; outdoor UX/model being reworked to real SLG (see "Outdoor model CORRECTED" below).

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

### 🌍 Tasks 2+3 — outdoor expedition engine (in progress, Claude + Sonnet)
- Design locked (bible §22, DIRECTION §9): personal mode = **async single-player PvP**; concentric
  **world rings** (edge spawn, center = the Circle); **NO fog** (scout = intel); leveled
  **gather nodes 1–10**; combat counter **air>army>navy>air +10%**; loot & gather capped by troop load.
- **Data landed in `numbers.json`:** `gatherNodes` (L1–10: ringZone/totalSupply/gatherRatePerHour +
  academy-speed & hero-carry hooks), `world` (rings/spawn), `global.combat.counter` matrix. `npm run check` green.
- **Endgame "the Circle"** (seniority cohort treadmill + guardrails) logged as Phase-2 in DIRECTION §9.
- **Building now (delegated to Sonnet):** `src/lib/expedition.ts` (pure logic: marchTime, carry,
  resolveScout/Gather/Combat, counter, wounded→hospital→dead, loot=load, shield check) + tests +
  a `gatherNodes` editor section in `Admin.tsx`. No UI in Town (logic-only per task 2).
- **Hooks left for later:** hero carry/combat bonus = 0 (task 4); real-player targets (NPC stub now); inner-ring opening (server, later).
- **DONE (Sonnet):** `src/lib/expedition.ts` + 19 tests (`npm run check` green, 40 tests total); `Admin.tsx` gained a **Gathering** tab editing `gatherNodes`.
- **DONE (Claude):** `/?expedition` **Expedition Lab** (`src/ExpeditionLab.tsx`) — hidden points-and-lines test harness: concentric rings, labeled dots (node/monster/rival), pick force → Scout / Gather / Raid → numeric result + march line. Verified end-to-end in browser (combat/counter/wounded/loot all resolve on live numbers).
- **Follow-up (minor):** `resolveCombat` returns `loot` even on a loss — should be gated to wins (or the caller/Lab should only show loot when `win`).

### 🔧 Outdoor model CORRECTED → rework next (Claude)
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

**Rework plan (next build):**
- Replace the player-centric ring lab with a **coordinate world map** (pan/zoom, city at random (x,y), world-center = Circle, tiles/monsters/rivals at coords).
- Add **Town → World navigation** (a "World" button; back to city).
- **Account-bound troop allocation**: read standing army from game state; enforce single-march capacity + march-queue slots; reserve on dispatch, return (minus losses) on completion.
- **Gather** = send troops; haul = load; **speed = base × `accountModifiers.gatherSpeedBonus`** (auto). No node-side academy.
- **Scout** shown only on rival/monster targets.
- Wire `accountModifiers` (gather/march speed, atk/def, load) as auto-applied hooks (sources: Academy research = Phase-2, heroes = task 4; default 0 now).
- **Data added (numbers.json):** `global.march.marchQueueSlots=2`, `global.accountModifiers` (all 0). `npm run check` green.

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
- **Local test suite:** `npm run check` runs TypeScript, 21 tests and the production build. Dependency audit is clean (0 vulnerabilities).
- **Art-direction exploration (concept only):** three desktop SLG concepts are saved under
  `docs/art/concepts/`. V1 establishes Degen Freeport, V2 broadens the audience with civic life and
  NFT identity, and V3 converts it to a chunkier, more readable chibi 2.5D toy-diorama style.

## 🔜 Next up (immediate — for whoever picks this up)
1. Product owner: explicitly lock or revise the V3 chibi Degen Freeport direction before producing assets.
2. Build one art vertical slice (Townhall/Exchange + Army Camp + Bank + terrain + core HUD) before commissioning or generating the full 14-building set.
3. Add resource source/sink breakdown to the pacing simulator.
4. Playtest the full L1→L10 city loop locally and tune individual rows from observed stalls/click cadence.
5. Then: outside-city **world map** (explore / gather / raid), and building special-functions
   (Academy research tree, Embassy reinforcement, Milestone server-progress, Watchtower tasks) — all
   defined in bible §20–21 / numbers, wired later.

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
- `src/lib/factions.ts` — pledgeable-from-holdings + seed top-factions.
- `src/lib/tasks.ts` — derive signals from records (backend/telemetry only for now).
- `src/App.tsx` — start-screen stage machine.
- `vite.config.ts` — `/bs` Blockscout proxy + `/__report` dev telemetry sink.

## 🤝 Handoff protocol
- boxiwang says when work is handed to another collaborator, and when it comes back.
- Whoever finishes a chunk: update **✅ Done / 🔜 Next / ❓ Open** above + the date/by line.
- Simple, well-scoped tasks are delegated to Sonnet to save tokens; complex/context-heavy
  work stays with the lead.
