# City effects integration

The live renderer is in `src/lib/city-fx.ts`, ported from
`docs/mockups/city-fx-claude.html`'s `script#claude-fx`.

- Quadrant wedges, arcs, 120 ticks, labels, building positions, core lattice,
  selection beams and attack trajectories share the same measured pixel coordinates.
- ResizeObserver measures the map and core. The geometry retains Claude's
  center (50%, 45%), rotation (-7°), outer radii (44% W, 35% H), and inner
  radii (28% W, 22.5% H).
- The lattice retains the original 11px cells, 34px shell, opacity and shimmer.
  It is a persistent visual layer, not an assertion that the account is protected.
- Queue links and core upgrade progress use account timers. Resource comets use
  the original staggered cadence and do not award or change account resources.
- Animation stops when the document is hidden; low/reduced motion draws static
  effects and retains readable alerts. Canvas DPR follows the graphics setting.

## Realtime alerts

MiniComms forwards snapshot marches, live march, march_done and report events
to Town using its existing socket. Town filters by the snapshot's player ID:
only incoming marches are shown. Snapshot/live duplicates are collapsed.
Reconnect restores active incoming marches; stale scans do not replay.

Scouted reports show Claude's amber Watchtower radar/ripple and banner.
Incoming marches show red vignette/radar, one trajectory per march, server-time
progress and ETA, and the count of additional attackers. Arrival clears the
trajectory and briefly shows an arrival message. A generic battle report cannot
trigger an inbound alarm, since the server also sends those to the attacker.

Entry bearings derive from the march ID, never the attacker's home coordinates.
GM's Test city attack and Test city scan call the same Town handlers used by the
socket; the test fixtures are created only by these GM buttons.

The worker's current PvP arrival handler still produces placeholder battle
reports; these visual alerts do not implement combat resolution.

## Verification

- TypeScript, Worker types, tests and production build via npm run check.
- Regression tests in src/lib/city-alerts.test.ts cover reconnect filtering,
  outgoing/foreign/expired marches, duplicate events, malformed timers and old scans.
- Browser checks cover 1280/1440/1728px, building selection, scan feedback,
  multiple simultaneous incoming marches and alert expiry.

Pages production branch is **production**, not main. After deployment verify
that https://alliance-7q2.pages.dev/ references the built JS/CSS asset hashes.
