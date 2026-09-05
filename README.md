# Alliance — RUGLANDS

An on-chain meme-war strategy game (SLG) on **Robinhood Chain (4663)**.
*Memecoins become nations; wallets become strongholds.* Standalone project (separate from Blockwick).

**Read-only & non-custodial.** The app only reads a connected wallet and asks for one optional
signature. It never requests a fund-moving transaction.

## Start here
- **`docs/DIRECTION.md`** — what we're building and why (vision, structure, rules, tech, roadmap).
- **`STATUS.md`** — where we are right now + handoff notes. **Read this first when picking up work.**
- **`docs/naming-bible.md`** — feature Keys + concepts + themed names. **Build by Key, not themed name.**
- **`docs/numbers.json`** / **`docs/NUMBERS.md`** — the numeric source of truth (tune curves, not code).

## Run
```bash
npm install
npm run dev     # http://localhost:5173 — open in a browser that has a wallet extension
```

## Current state
Phase 1 (personal-mode MVP): wallet connect → read Robinhood Chain records → start screen
(optional faction pledge or start solo → found Townhall). The personal-mode world is the next build.
See `STATUS.md`.

## Stack
Vite + React, no wagmi (plain `window.ethereum` + EIP-6963). Reads via Robinhood Chain RPC +
Blockscout `api/v2` (dev proxy `/bs`). Map render: Phaser. Backend (later): Cloudflare Workers + D1.
