# Friends / Contacts Contract

New requirement (owner, 2026-09-13): the Contacts page needs a real friends
system — **search + add**, **accept / reject** incoming requests, and **remove**
existing contacts. Ties into map privacy: locating a player on the star map is a
**friends-only** capability (strangers are found only by navigating/scouting;
spawns are random so no one can be found by spawn order — see below).

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
  keepLevel,online,coords?}], incoming:[...], outgoing:[...] }`. **coords only
  for accepted friends**, never for pending/strangers.
- Broadcast a `friend` event to the two parties on request/accept/reject/remove
  so both UIs update live.

Persist the friend graph per player id (D1). Requests expire? optional later.

## Client UI (Claude, once server shapes land)
- Contacts page: a search field → results with "Add" buttons; a "Requests"
  section (incoming = accept/reject, outgoing = pending/cancel); the friends list
  with "Message" + "Locate on map" + "Remove".
- Star map: a friends-only "locate" (jump camera to a friend's coord). Do NOT add
  a locate for arbitrary online strangers — that would leak position.

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
