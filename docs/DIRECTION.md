# RUGLANDS — Direction & Decisions

> Repo: **Alliance** · Standalone project (separate from Blockwick).
> This is the single place to understand *what we're building and why*. Pair it with
> `STATUS.md` (where we are right now) and the two sources of truth in `docs/`.

Last updated: 2026-09-05.

---

## 1. What it is
An **on-chain meme-war strategy game (SLG)** on **Robinhood Chain (chainId 4663)**.
- Your **wallet is your stronghold** (permanent, survives selling any coin).
- A **memecoin you hold is your faction/nation** (your "banner").
- Players build, explore, raid, ally, and wage faction wars.

**One-line pitch:** *Memecoins become nations; wallets become strongholds.*

**The thesis we must validate first:** *will holders of different memecoins keep coming
back to fight for their faction?* Everything in the MVP serves testing that — not
shipping a full game.

## 2. Theme
**Degen Wasteland** — Mad Max × crypto slang. Dark comedy, **revenge not victimhood**:
you're a hardened survivor of the rug who now hunts the whales. (Names are being locked
separately — see the naming bible. Build by Key, theme last.)

## 3. Structure — three separate surfaces
| Surface | What it is | Key |
|---|---|---|
| **Personal mode** | Your own persistent classic-SLG: open world, Townhall (TC) level, troops, might, random spawn, explore, non-destructive PvP. **Always safe.** | `mode.personal` |
| **Alliance build** | A separate co-op screen where all faction members build/upgrade the faction homeland. The "third space." | `mode.alliance_build` |
| **Alliance war** | An on-demand battle instance that loads both factions' built homelands **+ members' TC snapshots** into one map and fights. **Results never touch personal mode.** | `mode.alliance_war` |

Personal-mode output feeds the alliance build; personal power + alliance build both feed
the war. `war.isolation` (snapshot in, no write-back) is retention-critical.

## 4. Core rules & decisions (the guardrails)
- **Faction = membership by wallet**, not by map location. No forced relocation.
  Pledging is **optional** (`faction.pledge_optional`); you can **Start Solo** and pledge later.
- **Switch factions anytime** you hold that coin — MVP has no season lock (`faction.switch`).
  Multiple holdings → pick **one** at start (`faction.pick_one`).
- **No memecoin → prompted to acquire one**; a **Top Factions** board is shown so big
  factions create buy-pressure for their coin (`faction.leaderboard`, `growth.buy_to_join`).
- **Non-destructive PvP** (`pvp.nondestructive`): raids take resources & wound troops;
  **Townhall level & permanent progress are NEVER lost.** Hospital heals wounded.
- **Personal TC is attackable only in solo mode** (`pvp.solo`), never inside the alliance-war instance.
- **Newbie protection until Townhall Lv.10**, or until the player attacks first (shield drops).
  Shields are also **purchasable** (monetization) — `sys.shield`.
- **Dual progress:** personal (permanent, survives selling) vs seasonal alliance progress.
- **Auto-name at start** (e.g. `Ruglord0189374`); **first rename free, then paid** (`sys.rename`).
- **Townhall prerequisites** (`numbers.json → townhallPrerequisites`): TH→L needs listed buildings ≥ L−1;
  **Warehouse is the always-anchor**; count escalates 2/3/4 across L2–19 / 20–24 / 25–30; fixed & known (not random).
- **F2P pacing targets**: Townhall L1→L10 in ~2–3 days (newbie), L1→L30 in ~4–5 months (no speedups).
  First-version numbers reference real SLG curves (WoS/CoC/RoK), not guesses; `numbers.json → designTargets` holds the calibration.
- **Read-only / non-custodial always.** We only read the wallet + one optional signature.
  Never a fund-moving transaction. (Consumer-facing copy — never spec-speak in the UI.)

## 5. Sources of truth (do not duplicate these elsewhere)
- **`docs/naming-bible.md`** — every game feature has a stable `Key` + `Concept` (the anchor)
  + an editable Themed Name. **All code references the `Key`, never the themed name.**
  New features: ADD `Key`+`Concept`, leave the themed name for the product owner. Package (themed copy) LAST.
- **`docs/numbers.json`** (+ human-readable `docs/NUMBERS.md`) — the numeric source of truth,
  CoC-early-game-tuned, formula-driven (`value(L)=base*growth^(L-1)`). Tune curves, not code.

## 6. Tech decisions
- **Standalone repo (Alliance)**, separate from Blockwick.
- **Read-only reads on Robinhood Chain MAINNET** (4663). Off-chain first: chain is only for
  wallet sign-in + balance/record reads. **No funds custody, no token, no contracts in MVP.**
- **Client:** Vite + React, **no wagmi** (plain `window.ethereum` + **EIP-6963** multi-wallet
  discovery). Direct connectors: MetaMask, Phantom, OKX, Coinbase, Uniswap.
- **Reads:** balances via RPC/Blockscout; tokens + tx history + counters via Blockscout
  `api/v2`, through a **dev proxy `/bs`** that adds a browser User-Agent (the explorer sits
  behind a Cloudflare UA gate) and dodges CORS. **Production → a Cloudflare Worker proxy.**
- **Backend (later):** leaning Cloudflare Workers + D1 + Durable Object alarms for the tick
  engine. Persistence starts as localStorage, swaps to D1. Architecture rule: **game logic =
  pure functions keyed by bible Keys**, so render / persistence / identity / tick-authority
  are all swappable.
- **Known gotcha:** users may have **smart-contract wallets** (Uniswap/Coinbase smart wallet →
  `is_contract:true`). Real auth must support **EIP-1271**; don't use `is_contract` as a bot filter.
- The map render uses **Phaser** (prototyped a "living map"); the hex grid stays as invisible
  logic under the art. Art later = CC0 packs (Tiny Swords / Kenney).

## 7. Roadmap
**Phase 1 — Personal-mode MVP** (current). Scope:
Townhall(Keep) leveling + build queue · 3 resources + storage/protection · barracks/troops ·
hospital (wounded) · wall · living world map (explore/gather/PvE monsters/raid NPC keeps) ·
might · offline progress · shields · start screen (connect → holdings → optional pledge →
found Townhall) · local persistence + stub-then-real identity.

**Phase 2+ backlog** (deferred, NOT dropped — scheduled later):
heroes/commanders · research tree · more troops + counters · rally/reinforce · **real-player
PvP + matchmaking + rankings + revenge** · **alliance build + alliance war** · faction season
locks · local clusters · relocation/teleport · market · VIP/events/daily · **our own token** ·
mobile/WalletConnect wallets.

## 8. Prototypes (this planning phase)
- Three-mode concept mock: https://claude.ai/code/artifact/fa365a02-6f90-4a78-b04f-4daf73d467fc
- Phaser living-map: https://claude.ai/code/artifact/620b7d2e-2b4b-4161-81a3-979551ebdaed
- **The real beta lives in this repo** (`/src`) — wallet connect + read + start screen.
