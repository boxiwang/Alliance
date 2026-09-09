# ALLIANCE

An on-chain meme-war strategy game (SLG) on **Robinhood Chain (4663)**.
*Memecoins become nations; wallets become strongholds.* Standalone project (separate from Blockwick).

**Read-only & non-custodial.** The app only reads a connected wallet and asks for one optional
signature. It never requests a fund-moving transaction.

## Start here
- **`HANDOFF.md`** — shortest current-state, testing and next-work brief. **Read this first when picking up work.**
- **`docs/DIRECTION.md`** — what we're building and why (vision, structure, rules, tech, roadmap).
- **`STATUS.md`** — full implementation history and decisions.
- **`docs/naming-bible.md`** — feature Keys + concepts + themed names. **Build by Key, not themed name.**
- **`docs/numbers.json`** / **`docs/NUMBERS.md`** — explicit building Lv.1–30 and troop T1–T10 numeric source of truth.
- **`docs/ART-DIRECTION.md`** — current 2.5D Degen Freeport exploration, concept images, no-artist production plan and NFT-avatar notes.

## Run
```bash
npm install
npm run dev     # http://localhost:5173 — open in a browser that has a wallet extension
npm run check   # typecheck + local tests + production build
```

## Local GM testing

Open `http://localhost:5173/?gm` directly in the Vite development server and
connect the wallet you use for testing. Existing players go straight to Town;
new players enter Town after founding it. The wallet gets a browser-local toolbar with **Fill
resources**, **Finish queues**, **Selected building +1**, **Townhall +1**, **Reset city**, and
**Disable GM**. Reset returns the save to a playable blank Townhall Lv.1 with zero resources and
troops. The flag stays
with that browser + wallet until you disable it.

The route is restricted to Vite development mode on `localhost` / `127.0.0.1`.
It is inert in a production build, and no wallet address is stored in this repo.

## Current state
Phase 1 Personal Mode is playable locally: wallet/read-only onboarding → persistent City →
building, training, promotion, research and healing → 512×512 Star Map → gather, scout,
fight Frontier I's L1–20 rogues, raid test civilizations, recall and settle reports. The hidden `/?admin`
route provides explicit level tables, validation and progression/World simulations. See
`HANDOFF.md` for the exact boundary and next work.

## Stack
Vite + React, no wagmi (plain `window.ethereum` + EIP-6963). Reads via Robinhood Chain RPC +
Blockscout `api/v2` (dev proxy `/bs`). Star Map render: React + SVG. Backend (later): authenticated
server authority with durable persistence; Cloudflare Workers + D1 remains a candidate.
