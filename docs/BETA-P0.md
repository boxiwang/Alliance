# Multiplayer beta — P0 plan (owner decisions 2026-09-27)

What a real multiplayer closed beta still needs, **excluding Alliance features**.
Derived from a code review on 2026-09-27 and settled with the owner the same day.
Combat details live in `docs/COMBAT.md` (v3). Nothing here is implemented yet
unless marked.

**Why:** today the shared layer is presence + chat + scout + an attack telegraph.
Resource planets and Rogues live in each player's own `world_json`, 47 fake NPC
cities are generated per client, offline players vanish from the map, and attacks on
real players never resolve. Players see each other but effectively play alone.

## Progress

| Item | State (2026-09-27) |
| --- | --- |
| P0-6 Coordinate input | ✅ built locally (COORD search, Warp X/Y, nearest-open-tile hint, bottom bar = WARP only) |
| P0-8 Dual clock | ✅ built locally (nav bar; Admin event times come with P0-7) |
| P0-2 No fake cities | ✅ built locally — `localNpcCities` = 0; `removeSimulatedCities` strips old saves on load (client), on every server world command and in `GET /game`; fleets flying at a removed city are recalled. Ghost cleanup = Admin → Live Ops → World roster (GM). |
| P0-3 Offline on map | ✅ built locally — no `online` filter; `WorldRoom.retireDormant` (hourly, on join) releases Core ≤ 5 / 14-day slots, D1 untouched; returning players respawn on the outer ring with a "relocated" System report; server world commands re-sync the home city to the shared coordinate. Needs a worker deploy to verify. |
| P0-4 Location privacy | ✅ built locally — snapshot/presence carry other players' coords only for cities inside the viewer's map view (`view` query, ≤ 420 tiles/axis, 250 ms throttle, ≤ 600 cities); scout results carry no coords; incoming/battle reports carry `attackerCoords` → "LOCATE ATTACKER" in System and a clickable inbound banner on the Star Map; `world.warp` limited to 10 attempts/minute (`rate_limited`), rejected attempts spend nothing. |
| P0-1, P0-5, P0-7 | not started |

## P0 items

### P0-1 Shared world
Resource planets and Rogues move into the server's shared world (`WorldRoom`):
spawn, occupation, depletion and respawn happen once for everyone. One planet can be
occupied by one fleet at a time; everyone sees the same Rogue.

### P0-2 No fake cities
Remove the per-client NPC cities (`world.population.localNpcCities`, currently 47) —
the map shows real players only. Clear leftover test/ghost players from the
`WorldRoom` before launch.

### P0-3 Offline players stay on the map
- Every city is always on the map; **no online indicator** is shown
  (`src/World.tsx` currently filters to `p.online`).
- Cleanup: Core ≤ 5 **and** 14 days without login → removed from the map. **The
  account and all progress stay in the database forever.** On the next login the city
  lands on a random free outer-ring slot (same rule as a new player) and System says
  it moved.

### P0-4 Location privacy (death rule)
- The server sends only the cities inside the viewer's viewport, never the full roster
  (today every player's coordinates are pushed to every client).
- Scout and march results carry no coordinates.
- **Exception:** a player who was attacked can jump to the attacker's city from the
  battle report until the attacker warps away (`COMBAT.md` §9).
- Warp keeps both ways to choose a destination — click a tile or type X/Y — and keeps
  the specific rejection reason (the GO camera jump already reveals the same), never
  naming whose city is there. Server rate limit: 10 attempts/minute; a rejected
  attempt consumes no item. When a typed coordinate is invalid, suggest the nearest
  valid tile (one click to select).

### P0-5 PvP in the beta
The full `COMBAT.md` v3 model: round-based resolver, losses/loot applied to both
players' saves, casualty rules, Wall turret, shields (Core < 10 auto-shield, weekly
item, 30-minute lockout), retaliation locate, and the Admin no-death switch.

### P0-6 Coordinate input
- Star Map Search gets a **COORD** kind: enter X/Y → the camera glides there and marks
  the tile.
- The Warp panel gets its own X/Y fields.
- (Search jumps the camera instantly, like HOME; no animated glide.)
- The bottom bar drops its X/Y inputs and keeps only WARP.

### P0-7 Admin reward tool
Admin campaigns: item + amount, audience (all / Core-level filter / listed players),
one-off or **weekly (Monday 00:00 UTC)**. One grant per player per campaign period
(idempotent across logins); delivery posts a System notice. First campaign: the weekly
8-hour shield for every player. Future server-wide rewards are configured here, no
deploy needed.

### P0-8 Dual clock
The nav bar shows UTC and the player's local (machine) time side by side, e.g.
`UTC 14:32 · Local 07:32`. Admin event times also show both.

## Deferred (not P0)
- Friends system and online status (chat/DM is enough for the beta).
- P1 from the review: chat moderation (report / mute / ban), GM ops tools (inspect,
  compensate, ban, clear ghosts), client↔worker version handshake, HTTP rate limits
  (guest sign-up, `/command`), server-derived presence Might/Core (today
  client-reported), onboarding, a mobile layout pass.
- P2: Might leaderboard, sharding beyond one `frontier-1` room, Warp item pricing.

## Decision log (2026-09-27)
- Beta includes PvP (option B), not PvE + social only.
- Offline cities stay visible; online status is not shown on the map.
- Removed-for-inactivity players keep all data and respawn at random on return.
- Warp: map click + typed X/Y, specific reasons, rate limit, nearest-valid hint.
- Weekly period starts Monday 00:00 UTC; nav bar shows UTC + local time.
- Friends/online status postponed.
