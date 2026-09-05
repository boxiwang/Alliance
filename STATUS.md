# STATUS — Alliance / RUGLANDS

**The handoff doc.** Update this every time work changes hands. Read `docs/DIRECTION.md`
for the *why*; this file is the *where we are right now*.

---

**Last updated:** 2026-09-05 · **by:** Claude (with boxiwang)
**Current focus:** Phase 1 — personal-mode MVP. Start screen + wallet read pipeline.

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
- Docs: `docs/DIRECTION.md`, naming bible, numbers.

## 🔜 Next up (immediate)
1. **Publish this repo to GitHub as `Alliance`** (see "Publishing" below — needs boxiwang auth).
2. **The world/townhall itself** — after "found Townhall", the player currently hits a
   placeholder. Build the personal-mode world: Townhall screen + build queue + resources +
   offline progress, reading `docs/numbers.json`. (Phaser living-map is the world surface.)
3. Wire the game logic as **pure functions keyed by bible Keys** (`resolveTick`, `computeMight`,
   `canUpgrade`, `resolveRaid`), persistence via a swappable repository (localStorage now).

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
