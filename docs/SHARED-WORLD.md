# Shared World Contract (Batch 2)

Goal: one shared star map where every real player sees every other real player at
the **same** coordinates. This is the SLG foundation. Owner decision (2026-09-13):
**server is the coordinate authority; every player spawns on the OUTER RING of the
map (not random, not a grid); no migration of old local coords** — there is
effectively one real player today. The central wormhole (256,256) is the
contested endgame objective, so players start at the edge and push inward.

Status: the shared presence overlay, persistent outer-ring coordinate assignment,
and authoritative personal PvE/gather/march state are implemented. Real-player
combat remains the next batch.

## Current authority split

- The WorldRoom Durable Object owns stable shared-map coordinates and realtime
  presence.
- D1 owns each player's authoritative city and personal World snapshot.
- On the one-time GM migration, the Worker reads the player's coordinate from
  WorldRoom and writes it into the personal World before accepting commands.
- The client sends `world.dispatch`, `world.advance`, `world.recall`, and
  `world.scan` commands. It no longer uploads World snapshots after authority is
  enabled.

## Contract

### Server (Codex)
1. Remains coordinate authority. On join, assign a spawn coord **on the outer
   ring** and persist it per player id. Replace the current 10x10 grid
   `assignCoord` in the DO: place spawns near the playable-boundary radius
   (~0.9R of `worldPlayableRadius`, centered on 256,256), distributed by angle so
   they don't overlap; as the ring fills, step the radius inward slightly rather
   than falling back to the center. Never spawn inside the central reserve.
2. The `snapshot` message already carries `you` (my id) and `players[]` with
   `coords`. **No protocol change required** — the client can read its own coord
   as `players.find(p => p.id === you).coords`. (If convenient, echo it as a
   top-level `you.coords` too, but not required.)
3. Presence stays authoritative for might / keepLevel / faction / cosmetics /
   online (implemented).

### Client (Claude)
1. `World` reads its own server coord from the snapshot (which is on the outer
   ring per the server rule above).
2. World init positions the player's **home at that server coord**, with the
   local PvE cluster generated around it — this is an engine-level change to
   `spawnPlayers` / `spawnAnchors` (accept an explicit anchor for the human
   player) rather than a post-hoc shift, so the circular boundary + central
   wormhole (256,256) invariants and the existing world tests stay intact.
3. Until (2) lands, the read-only overlay already gives "see each other"; only
   the owner's own-home position is not yet unified.

## Explicitly NOT in this batch
- Scouting / attacking real players (needs **server-side combat** so both sides
  get one consistent battle report) — that is Batch 3.
- Real-player combat settlement — the existing realtime march is still only a
  telegraph until both player states are locked and resolved atomically.

## Launch note
"See each other" (done) + Batch 1 (identity + no-dataloss, Codex) is enough for a
friends alpha. Own-home coordinate unification (client step 2 above) can land as a
fast-follow; it is not launch-blocking because the mismatch is invisible to any
single player.
