# Friends-Beta Acceptance Script

Run this before inviting friends. Gate = every **P0** row passes. Prod:
https://alliance-7q2.pages.dev

## Setup
- **3 identities**: A = wallet, B = Google, C = guest (Quick Play).
- **3 browsers/devices**: e.g. Chrome desktop, Safari desktop, phone browser.
  Use separate browsers/profiles (not tabs) so localStorage is isolated.
- Before starting, ask Codex to **clear the DO test players** so the outer ring
  is clean (Claude's verification runs left ghosts).

## P0 — must all pass to invite

### Login (all three paths)
- [ ] A: connect wallet on RHC → enters game (or graceful error if chain wrong).
- [ ] B: Continue with Google → popup → enters game.
- [ ] C: Enter as Guest → enters game.
- [ ] Each lands on the **outer ring** (home near the map edge, not center).

### Identity
- [ ] Each player's name is unique and NOT "Commander".
- [ ] Rename in Profile → the new name shows in chat + on the map to others.

### Shared world (2+ online at once)
- [ ] A and B, both online, can find each other's city by panning/zooming.
- [ ] Clicking a stranger's city shows name/faction/core, **LOCATION = 🔒 HIDDEN**,
      **no CENTER/locate button**, Might = 🔒 SCAN. (Location privacy death rule.)
- [ ] Positions are random (not adjacent by join order).

### Chat
- [ ] Cosmos message from A appears for B and C in real time.
- [ ] DM between A and B works both directions.
- [ ] MiniChat (Town/Star Map) shows the same live feed; unread badge only counts
      others' messages while collapsed.
- [ ] Chinese / Japanese / Korean render aligned in the mini-chat peek.

### Persistence (the dataloss gate)
- [ ] Same browser refresh → progress intact, resumes (no "founded" restart).
- [ ] Google (B): sign in on a **second browser** → progress restored (city,
      level), not a fresh start.
- [ ] Guest (C): note that guests are device-bound (expected) — refresh keeps
      progress; a truly new device is a new guest (call this out to friends).

### Resilience
- [ ] Kill network briefly mid-game → no white screen; city/star map still work;
      chat reconnects when network returns.
- [ ] Force a render error (if a test hook exists) → recoverable panel with
      Reload, not a blank page; error shows up in the backend `client.error`
      telemetry.

### Audio / feel
- [ ] Tab switch, building/target select, chat send, channel/subtab switch all
      play at a consistent, non-jarring volume; SFX volume slider scales them.

## P1 — should pass, not blocking
- [ ] Onboarding/goal cue for a first-time player (what to do first).
- [ ] Feedback entry is visible and a submitted report reaches the backend.
- [ ] A "known-not-yet-built" note is shown (attacking real players, alliances,
      friends system) so testers don't report known gaps.

## Automatable slice (Claude)
Guest login, reach town + star map, send Cosmos chat, home-on-outer-ring, restore
after local wipe, and graceful-degrade (dead WebSocket) are all scriptable via
browser automation and have been spot-checked. Wallet + Google + true multi-device
need real credentials → manual rows above.

## Known limitations to tell testers
- Attacking / scouting real players: **not yet** (server combat = next).
- Alliances, friends system, marketplace: **coming soon**.
- If the realtime worker is down, login is blocked (auth-gated) — single hard
  dependency for the beta.
