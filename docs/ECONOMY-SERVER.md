# Moving the economy to the server — incremental roadmap

Goal: make the game economy (resources, buildings, troops, research, timers)
**server-authoritative**, so combat can change both players' state cleanly and
cheating (editing localStorage) stops working. Done gradually — every step ships
on its own, keeps the beta working, and is reversible.

## Why this is feasible (not a rewrite)
`src/lib/game.ts` (the economy engine: `project()`, build/train/research/heal/
capacity…) is **pure** — zero `localStorage`/`window`/DOM. The server already
stores each player's `game_json` in D1. So this is "run the existing engine on the
worker as the authority + turn client mutations into validated commands", not new
game logic.

## Cross-cutting rules (apply to every step)
- **Shared engine, one source of truth**: client and worker import the *same*
  `game.ts` + numbers config. Never fork the logic. Client and worker deploy
  **in lockstep** (same engine version) — a divergence desyncs authority.
- **Optimistic UI**: the client applies a command locally for instant feel, then
  reconciles to the server's returned state. Latency must never block gameplay.
- **Lazy ticking, no cron**: the server computes current resources with
  `project(state, now)` on every read/command — same as the client does today.
  Offline players "catch up" on next read.
- **Idempotency + revision**: every command carries an idempotency key; writes use
  the existing `player_state.revision` optimistic lock (409 = re-pull + retry).
- **No dataloss on migration**: when a player first becomes server-authoritative,
  seed the server from their current local save (idempotent); then the server
  owns it. Never wipe a local save until the server copy is confirmed.
- **Reversible**: until Step 4, the client can fall back to its local engine if a
  server path errors, so a bad deploy degrades to today's behaviour, not a break.

## Steps

### Step 0 — Shared-engine boundary (no behaviour change)
Make `game.ts` + its deps (numbers, research) importable by the **worker** and
bundle the numbers config server-side. Add a worker unit test that runs `project()`
and a couple of reducers and asserts parity with the client. Ship nothing
user-facing. *Proves the engine runs identically on the server.*

### Step 1 — Server serves state (read-only authority)
Worker `GET /game` → authoritative `game_json`, `project()`-ed to now. Client can
optionally read it (behind a flag) and diff against its local state to confirm
they match; still writes locally + mirrors. *Read-only, low risk; validates the
server engine against live data.*

### Step 2 — Command pipeline, ONE action end-to-end
Define `POST /command { type, args, idempotencyKey }`. Server: load → `project()`
→ validate + apply → save (revision++) → return new state. Implement **one**
command first (recommend **collect resources** or **start a building upgrade**).
Client sends that command optimistically and reconciles to the response; falls
back to local on error. *Establishes the pattern.*

### Step 3 — Migrate the write surface, one command per sub-step
Move each mutation to a server command, verifying each before the next:
build upgrade → training/promotion → research → healing → speedups (tie into the
existing server inventory) → resource collect / away gains → faction join.
After each, that action's local reducer becomes optimistic-only (server decides).

### Step 4 — Flip authority (server owns the save)
Once all mutations are commands: on login, hydrate from `/game` (seed from local
once for existing players), then the server is the authority. Client keeps a local
`project()` only for smooth between-command ticking, re-synced periodically. Retire
the local write path. *This is the point of no return — do it after Step 3 is
solid on all actions.*

**Private-alpha status:** implemented for city build/train/promotion/research/
healing/speedups and personal World dispatch/scan/recall/arrival/gather/return.
Every authenticated player now migrates automatically on first entry to City or
Star Map. The one-time migration binds both snapshots to the authenticated player,
seeds `game_json` and `world_json` together, and records an account audit event;
afterward `/state` cannot overwrite either field. World ticking is event-driven: the client calls
`world.advance` only when a scheduled event is due, and offline progress settles
on the next command/read cycle.

### Step 5 — Combat on the authoritative economy (real Phase 3)
Battle resolution now applies casualties/loot to the authoritative state via the
shared engine (attacker-disadvantage math from `docs/COMBAT.md` §H). Both players'
economies change correctly; reconciliation is free; anti-cheat is solid. This is
the payoff — replaces the Phase 2 telegraph's no-op arrival with a real battle.

### Step 6 — Hardening
Command validation/anti-cheat, rate limits, richer conflict handling, optimistic-UI
polish, offline edge cases, telemetry on command latency/failures.

## Sequencing with combat + beta
- The **friends beta does NOT need this** (cheating tolerated, dataloss not). It
  can ship on the current client-local economy + Phase 2 telegraph.
- Two orders are valid: (A) do Steps 0–4 first, then Step 5 gives clean combat; or
  (B) ship combat for the beta with a lighter post-battle reconciliation now, and
  do Steps 0–6 right after the beta. Either way this roadmap is the destination.
- Best co-owned with Codex (owns backend/mirror). Client-side steps (0, 1, parts
  of 2–3, optimistic UI) are doable solo meanwhile.
