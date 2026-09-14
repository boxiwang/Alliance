# Friends / Contacts Contract

New requirement (owner, 2026-09-13): the Contacts page needs a real friends
system — **search + add**, **accept / reject** incoming requests, and **remove**
existing contacts.

## LOCATION PRIVACY — DEATH RULE (owner, 2026-09-14)
Location is **absolutely private**. **Nobody** gets your coordinates — **not even
friends** (guard against a friend turning traitor). The ONLY exceptions:
- Members of the **same alliance** see each other's coordinates / can locate.
- Anyone else can only find you by **manually panning + zooming the star map**
  ("放大一点点找"). Cities render on the map (that IS the find-by-exploring
  mechanism), but no coordinate is ever handed out **by identity**, and there is
  **no locate/jump-to-player shortcut** outside your alliance.

Consequences already applied client-side (World.tsx remote-commander card): the
card shows name / faction / core, but LOCATION = "🔒 HIDDEN" and there is **no
CENTER/locate button**. When the alliance system ships, same-alliance members get
coord + locate; everyone else never does.

**Search key:** exact **username** (globally unique via `name_key`) or a pasted
**0x address** — exact match only, returns 0 or 1, never fuzzy/prefix enumeration.

## Split
- **Server (Codex)** — friend graph + request inbox + directory search. This is
  shared, persisted state; belongs in the realtime backend (DO + D1), same place
  as presence.
- **Client (Claude)** — Contacts UI: search box, request list (incoming/
  outgoing), accept/reject, remove, and a friends-only "locate on map".

## Server surface (proposal — confirm shapes with client)
Over the existing WS (or a small HTTP API on the worker):
- `friend.search { query }` → up to N players by name/id (public fields only:
  id, name, faction, keepLevel, online). Never expose coords in search.
- `friend.request { to }` → create a pending request (dedupe; block if already
  friends or a reverse request exists → auto-accept that case).
- `friend.respond { from, accept }` → accept (add both to each other's list) or
  reject (drop the request).
- `friend.remove { id }` → remove from both sides.
- `friend.list` (in snapshot or on demand) → `{ friends:[{id,name,faction,
  keepLevel,online}], incoming:[...], outgoing:[...] }`. **NEVER include coords —
  not even for accepted friends** (death rule above). Coordinates are exposed
  only through the alliance channel, to same-alliance members.
- Broadcast a `friend` event to the two parties on request/accept/reject/remove
  so both UIs update live.

Persist the friend graph per player id (D1). Requests expire? optional later.

## Client UI (Claude, once server shapes land)
- Contacts page: a search field → results with "Add" buttons; a "Requests"
  section (incoming = accept/reject, outgoing = pending/cancel); the friends list
  with "Message" + "Locate on map" + "Remove".
- Star map: **NO locate for friends** (death rule). A locate/jump-to-player
  shortcut exists ONLY for same-alliance members (ships with the alliance system).
  Friends list actions are Message + Remove only — no coord, no locate.

## Related correction: spawns must be RANDOM on the outer ring
Owner clarified spawns should be **random** around the outer ring, NOT sequential
/ adjacent — future players don't want their location inferable from join order.
`worker/world-coords.ts::assignOuterRingCoord` currently returns the first
unoccupied slot in ring order (so sequential joiners land adjacent). Change it to
pick a **random** unoccupied slot (seedable is fine), still on the outer ring,
still stepping inward as it fills. Keep the per-id persistence so a player's coord
stays stable across reconnects.

Also: before the real friends test, **clear the test players** left in the DO
storage from Claude's verification runs so the live ring is clean.
