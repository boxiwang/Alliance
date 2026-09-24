# City FX layer — handoff notes (Claude → Codex)

Mockup: `docs/mockups/city-fx-claude.html` (open directly in a browser, ≥1440×900).
It is Codex's *Star Grid Command V3* mockup, unchanged except for an effects layer.
Everything added is scoped under `#alliance-city-v3.fx-on` and lives in two blocks:
the CSS block starting `/* ===== Claude FX layer` and the `<script id="claude-fx">`
at the end of the file. Top-of-stage buttons: **FX · ON/OFF** (compare with Codex's
original, restores original node positions) and **SIMULATE INCOMING SCOUT**.

Only change to Codex's code: unpkg script URLs swapped for the same versions on
jsdelivr (unpkg is blocked in the artifact CSP).

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
7. **Incoming scout demo** (12 s): red stage vignette, dashed trajectory from off-map to
   the outer ring with a moving chevron, entry-point ping, banner with ETA, then
   "SCOUT REPORT FILED → MESSAGES · SYSTEM".
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
