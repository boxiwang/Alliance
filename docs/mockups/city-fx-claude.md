# City FX layer — handoff notes (Claude → Codex)

Mockup: `docs/mockups/city-fx-claude.html` (open directly in a browser, ≥1440×900).
It is Codex's *Star Grid Command V3* mockup, unchanged except for an effects layer.
Everything added is scoped under `#alliance-city-v3.fx-on` and lives in two blocks:
the CSS block starting `/* ===== Claude FX layer` and the `<script id="claude-fx">`
at the end of the file. Top-of-stage buttons: **FX · ON/OFF** (compare with Codex's
original, restores original node positions), **SIM · INCOMING ATTACK** and **SIM · SCOUTED**.

Changes to Codex's own code (everything else is the added layer):
- unpkg script URLs swapped for the same versions on jsdelivr (unpkg is blocked in
  the artifact CSP);
- **Research behaves like Warehouse** (owner request): clicking the Research building
  (or its Operations Queue row) no longer jumps to the skill tree. It selects the
  building and shows the detail panel (research speedups + an **OPEN RESEARCH
  INSTITUTE** button); only that button opens the tree. Implemented as `open:'research'`
  / `open:'warehouse'` on the `info` entries plus one `[data-action]` click handler, so
  the Warehouse's OPEN WAREHOUSE button now works too.

## Layout: four quadrants (owner-approved)
All 13 buildings sit on the outer ellipse, one district per 90° quadrant, evenly
spaced (angles are ellipse params, 0 = right, +90 = down, ellipse rotated −7°):

| Quadrant | District | Colour | Order (clockwise) | Centre / step |
|---|---|---|---|---|
| top-right | ECONOMY | `#e8b24c` | Bank, Oil Well, Power Plant, Warehouse | −45° / 19° |
| bottom-right | MILITARY | `#ff8a5c` | Army Camp, Naval Base, Airfield | 45° / 24° |
| bottom-left | BASTION | `#5fc8ff` | Embassy, Wall, Hospital | 135° / 24° |
| top-left | INTEL · SCIENCE | `#aa82ff` | Monument, Watchtower, Research | −135° / 24° |

Ring geometry (fraction of the map box): centre (50%, 45%), outer a=44% W, b=35% H;
inner a=28% W, b=22.5% H. Core moved to top 45% to match. Sized so the bottom row
clears the mini-comms dock. Quadrants: dashed dividers at 0/90/180/270°, a very faint
district tint between inner and outer ring, a glowing arc along the outer ring, and the
district label ("ECONOMY · 4") on the inner ring at the quadrant centre.

## Effects
1. **Resource harvest pulses** (owner asked for *refined, not continuous*): each
   producer fires ONE packet every 8 s, staggered (Bank 0 s, Oil 2.7 s, Power 5.4 s),
   so at most one is in flight. Packet = comet (white core + coloured glow, tapered
   gradient tail), 1.9 s ease-in-out along a quadratic curve into the core. Route is a
   near-invisible hairline that lights up behind the packet and fades after arrival.
   Launch = thin ring leaving the building; arrival = short arc lighting on the core rim
   at the entry point. Resource bar shows the per-hour rate and floats `+1.5K` on
   arrival (amount = perHour × 8 / 3600; stock actually increments).
2. **Queue progress rings**: conic ring around buildings with an active queue
   (training cyan, research violet, healing pink) + live countdown chip above; dashed
   animated link core → building. Replaces the 1px bottom bar.
3. **Core**: upgrade progress ring (cyan→violet, live countdown), hex-lattice
   novice-shield dome with a shimmer band, tag "NOVICE SHIELD · UNTIL CORE 10"
   (matches the shield-under-Keep-10 rule), chip under the core `CORE → L8 · mm:ss ·
   FLEETS ●●○○`. The orbiting F1/F2 fleet markers were removed at the owner's request.
4. **Depth**: nodes scale 0.86→1.10 and brighten top→bottom; slow perspective floor
   grid; ground glow under each node in its district colour.
5. **Selection**: corner brackets around the selected node + beam with pulses to the
   core; rotating arc brackets when the core itself is selected.
6. **Watchtower**: always-on radar sweep; turns red and ripples during an alert.
7. **Threat alerts — event-driven** (owner requirement: must respond to real combat).
   `window.cityFx` takes the same shapes as `src/lib/realtime.ts`:
   - `cityFx.sync(marches, me)` ← snapshot `marches` (worker already filters to
     attacker/defender) — restores an in-flight alert after reload/reconnect;
   - `cityFx.incoming(march)` ← live `march` where `march.defender === me`;
   - `cityFx.marchDone(id)` ← live `march_done`;
   - `cityFx.scouted(report)` ← live `report` with `kind: "scouted"` (instant, no ETA).
   Attack = red vignette, dashed trajectory + chevron whose progress is
   `(now − departAt) / (arriveAt − departAt)` from server times, entry ping, banner
   `⚔ INCOMING ATTACK · name · troops · ETA mm:ss` (+N MORE), watchtower red ripple;
   on arrival → "ATTACK ARRIVED · BATTLE REPORT → MESSAGES · SYSTEM". Scouted = amber
   watchtower ripple + banner. **The entry direction is a hash of `march.id`, never
   `march.from`** — the attacker's location must not leak (location-privacy rule).
8. Outer-ring tick marks with a slow scanning highlight.

`prefers-reduced-motion`: no animation loop; routes drawn as static dashed lines,
CSS animations off.

## Porting notes
- Single 2D canvas (`.fx-canvas`, z-index 3: above orbits, below core z4/nodes z5),
  DPR-capped at 2, geometry recomputed via ResizeObserver from `offsetLeft/Top`.
- All demo numbers (rates, timers, fleets 2/4, shield state) are hard-coded. In the
  game they must come from real state: production rates from the economy engine,
  queue remaining/total from the server timers, shield from Keep level + attack state,
  alerts from the realtime scout/incoming events. Nothing here should ship as a
  placeholder.
- Pause the loop when the City view is hidden.
- **Gap in the real game today:** on the City screen the only realtime socket is
  `MiniComms`, and it ignores `report` / `march` / `march_done` — so an attack that
  starts while you are in City currently shows no alert there (only `World.tsx`
  handles them). Wiring the alert means feeding those events (and the snapshot
  `marches`) into the City view.
- **Open privacy question for the owner:** the worker sends the defender the full
  `march` including `from` (attacker home coords). Decide whether that is allowed
  under the location-privacy rule; the City FX deliberately does not use it.
