# Shared ecology — P0-1 architecture (proposal, 2026-09-27)

Goal (`docs/BETA-P0.md` P0-1): resource planets, Rogues and marches exist **once** for
everyone. Two players see the same planet, one fleet occupies it at a time, a Rogue
killed by one player is gone for all, and arrivals resolve on time even when the
owner is offline. **Status: approved by the owner 2026-09-27; phases 1–2 built and verified
locally (unit tests + `src/lib/shared-world.e2e.test.ts` against `wrangler dev` + a headless
guest run of the Star Map); not deployed yet.**

Implementation map: `src/lib/shared-world.ts` (pure shared world: join, cutover settle,
command/sync, view, clusters, search), `worker/index.ts` (WorldRoom: in-memory world,
chunked storage `sw:*`, one lock for all world work, alarms, `/world/command`,
`/world/sync`, view/search messages), `worker/player-api.ts` (`SharedWorldPort`: the world
change commits only after the matching D1 write succeeds; `sharedCutover`; `GET /game` and
world commands of authority players are forwarded to the WorldRoom), client
`src/World.tsx` (renders own slice + view targets; server search and Strategic clusters).

## Today

- Every player's `player_state.world_json` holds a private `HeadlessWorld`: their city,
  ~480 resource planets, ~180 Rogues, their marches, reports and scheduled events.
- `src/lib/world-authority.ts` runs the pure engine (`src/lib/world-engine.ts`) on that
  private world inside the D1 command route and reconciles troops/resources with
  `game_json` through a `syncedGame` delta snapshot.
- The `WorldRoom` Durable Object only knows presence, coordinates, chat, reports and
  the PvP telegraph.

The engine is already multi-player: one `HeadlessWorld` has `players`, `entities`,
`marches`, `scheduledEvents`, and `advanceHeadlessWorld` processes events for all of
them deterministically (tested with 1,000 players and 10,000 events).

## Proposal: one engine world inside `WorldRoom`

```
Client ──/command (world.*)──► Worker (D1: game_json economy)
                                  │  1. project game_json to now
                                  │  2. POST DO /world/command {player, game snapshot, command}
                                  ▼
                           WorldRoom DO: ONE HeadlessWorld (all players + targets + marches)
                                  │  reconcile player ↔ snapshot (existing delta rule)
                                  │  engine command (dispatch / recall / scan / warp)
                                  │  advance to now; persist; set alarm to next event
                                  ◄── player's troops/resources/cargo after the command
                                  │  3. write game_json (revision guard)
Client ◄─ WS view_* (cities + targets + marches inside the viewer's rect)
DO alarm ──► advanceHeadlessWorld(now): arrivals, gather completion, returns, respawns
```

1. **Authority split (unchanged idea, new host).** `game_json` in D1 stays the economy
   authority (buildings, research, training, production). The shared world holds each
   player's world record (troops at home, resources, marches) and reconciles with the
   player's projected game state using the existing `syncedGame` delta rule — now
   stored per player inside the shared world.
2. **Real-time events.** The DO alarm fires at the next scheduled event and advances
   the whole world, so an arrival resolves at its arrival time (first fleet to land
   occupies the planet) even if every owner is offline.
3. **Deliveries.** Returned troops/cargo sit in the player's world record until the
   player's next world sync (any world command, and `GET /game` / City load), which
   writes them into `game_json`. The Worker is the only writer of `game_json`; the DO
   is the only writer of the world.
4. **Reads by view.** The existing `view` query grows into a view payload: cities,
   targets and marches inside the rect (same 420-tile cap). Search ("nearest free L5
   Cash") and Nearby Signals become DO queries from the player's home, so the client
   never holds the full target list.
5. **Persistence.** The world lives in DO memory and is written through to DO storage
   on every change, split into chunk keys (meta, players, marches, events, reports,
   entities by 32×32 sector) and only dirty chunks are rewritten.
6. **Population.** Shared targets follow the existing ecology rules: 3.2 planets + 1
   Rogue per active city, floors 480 / 180, caps 3,200 / 1,000, sector-balanced,
   radial difficulty, randomized respawn.

## Rules that change because the world is shared

| Topic | Rule (recommended) |
| --- | --- |
| Gather contention | First fleet to **arrive** occupies the planet. A later fleet **automatically attacks the occupying fleet** (after alliances ship: same alliance → it just returns). Winner holds the planet: a winning attacker starts gathering; the loser returns with its survivors and whatever it had gathered so far (not plundered). Casualties use `COMBAT.md` v3 (latecomer = attacker 35/65, occupier = defender 90/10, no Wall/home bonus, Core < 10 sides lose no troops). Attacking a gathering fleet counts as an attack (drops the Core < 10 auto-shield, starts the 30-minute shield lockout). Until P0-5 lands the v1 resolver is used. |
| Rogue kills | A defeated Rogue is gone for everyone and respawns elsewhere after **2–5 min**. |
| Deep Scan | Spawned Rogues are public (anyone may hit them). The per-player cooldown stays. |
| Rogue unlock progress | `highestMonsterDefeated` carries over per player. |
| PvP (P0-5) | City attacks become engine marches in the same world; the old WorldRoom telegraph march is retired. |

Owner decisions 2026-09-27: all rows above; cutover recalls in-flight private marches
instantly.

## Cutover (per player, on first shared-world sync)

1. Settle the private world: every in-flight march is recalled and **delivered
   instantly** (troops, wounded and cargo home) — nothing is lost.
2. Carry over: `highestMonsterDefeated`, Deep Scan cooldowns, energy, bookmarks
   (client), city cosmetics. Recent reports are dropped (they described a private map).
3. Add the player to the shared world at their shared coordinate.
4. Keep the old `world_json` untouched as a rollback copy; mark
   `economy_authority_version = 2` for shared-world players.

Local/GM mode (no backend) keeps today's private engine for offline testing.

## Build phases

1. **Server:** a `SharedWorld` module (pure: in-memory world + storage adapter + alarm
   scheduling) unit-tested without a DO; `WorldRoom` routes `/world/command`,
   `/world/sync`, view payload, search; command-route integration; cutover.
2. **Client:** the Star Map authority path renders from view payloads and uses server
   search / nearby; own marches and reports from the world record.
3. **Verify** with two accounts on production (contention, offline arrival, delivery),
   then P0-5 combat v3 on top.

## Risks

- **Engine cost:** the engine `structuredClone`s the whole world per call. Fine at beta
  scale (hundreds of entities, tens of players); must switch to in-place mutation
  before ~300 active players.
- **One DO = one thread:** every world command in the State serializes through it.
  Fine for the beta; sharding is P2.
- **Free-tier budget:** view queries and alarms count as DO requests (100k/day free).
- **Migration:** the settle step must be exactly-once; the rollback copy stays.
