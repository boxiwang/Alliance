# STATUS — Alliance / RUGLANDS

**The handoff doc.** Update this every time work changes hands. Read `docs/DIRECTION.md`
for the *why*; this file is the *where we are right now*.

---

**Last updated:** 2026-09-05 · **by:** Claude (with boxiwang) · **← HANDOFF POINT**
**Current focus:** Phase 1 — personal-mode MVP (in-city). Design locked; next is the per-level data migration.

## 🎯 Decisions locked (this session)
- Theme: **Degen Wasteland** functions, BUT the economy reads as modern-military (Bank/Oil/Power, Navy/Army/Air)
  — **OPEN: confirm setting = modern-military vs re-skin to wasteland** (build-by-key, so functions are unaffected).
- Economy: 3 resources **Cash / Oil / Power**; 12 city buildings (see bible §20); troops **Army/Navy/Air, T1–T10**.
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
- **Solo Townhall** playable: 3 resources (Cash/Oil/Power) + 12 city buildings + 3 troop arms
  (Army/Navy/Air), build queue, offline progress, training, might — data-driven from `docs/numbers.json`.
- **Numbers admin** at `/?admin` (hidden): edit all ~199 values, Save & reload / Reset / Export
  numbers.json. Game reads effective numbers via `src/lib/numbers.ts` (localStorage override or defaults).
  **Tuning workflow:** tune in /?admin → Export → overwrite `docs/numbers.json` → commit (team-shared).
- Docs: `docs/DIRECTION.md`, naming bible (§20 = full building/resource/troop roster), numbers v0.3.

## 🔜 Next up (immediate — for whoever picks this up)
1. **Publish this repo to GitHub as `Alliance`** (see "Publishing" below — needs boxiwang auth).
2. **Per-level data migration**: `numbers.json` cost/time/production are still FORMULA placeholders
   (base·growth). Migrate to explicit **per-level tables** baked to `designTargets` (the agreed curves),
   so every level is an editable value. Then game.ts reads table lookups instead of the formula.
3. **F2P pacing simulator** (in the admin): compute time-to-TH10 and time-to-TH30 from current tables +
   prerequisites + resource production; tune curves until L10 ≈ 2–3 days and TH30 ≈ 4–5 months.
4. **Enforce prerequisites** in game logic (`startUpgrade`): block a TH upgrade until
   `townhallPrerequisites[L]` buildings are ≥ L−1; surface the requirement in the Town UI.
5. **Per-level admin dashboard**: extend `/?admin` so each building/troop opens a Lv-by-Lv table (editable rows).
6. Then: outside-city **world map** (explore / gather / raid), and building special-functions
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

## ▶️ Run
```bash
npm install
npm run dev            # http://localhost:5173  (open in a browser WITH a wallet extension)
```
Read what the local app actually connected to & read:
```bash
cat /tmp/ruglands-report.json
```

## 🚀 Publishing to GitHub (repo: Alliance)
`gh` isn't installed on this machine and there's no token available, so this must be run by
boxiwang. Everything is committed locally and ready:
```bash
# option A — GitHub CLI (after: brew install gh && gh auth login)
gh repo create Alliance --private --source=. --push

# option B — create an empty private "Alliance" repo on github.com, then:
git remote add origin https://github.com/boxiwang/Alliance.git
git push -u origin main
```

## 🗂 Where things live
- `docs/DIRECTION.md` — vision, structure, rules, tech, roadmap.
- `docs/naming-bible.md` — feature Keys + concepts + themed names (**build by Key**).
- `docs/numbers.json` / `docs/NUMBERS.md` — numeric source of truth.
- `src/lib/wallet.ts` — EIP-6963 connect / chain switch / sign.
- `src/lib/blockscout.ts` — read-only chain records.
- `src/lib/profile.ts` — per-wallet save (localStorage), auto-name.
- `src/lib/factions.ts` — pledgeable-from-holdings + seed top-factions.
- `src/lib/tasks.ts` — derive signals from records (backend/telemetry only for now).
- `src/App.tsx` — start-screen stage machine.
- `vite.config.ts` — `/bs` Blockscout proxy + `/__report` dev telemetry sink.

## 🤝 Handoff protocol
- boxiwang says when work is handed to another collaborator, and when it comes back.
- Whoever finishes a chunk: update **✅ Done / 🔜 Next / ❓ Open** above + the date/by line.
- Simple, well-scoped tasks are delegated to Sonnet to save tokens; complex/context-heavy
  work stays with the lead.
