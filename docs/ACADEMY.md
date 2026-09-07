# Academy / Research v0.8

The playable Academy is modeled after Kingshot's three-tree research ladder, then adapted to
RUGLANDS' three resources and Army / Navy / Air combat model. It is not a copy of Kingshot's
economy: all costs, durations, effects and Might values were rescaled for the current TH1–30
timeline.

Reference: [Kingshot research database](https://kingshotdata.com/research/). At the time of the
v0.8 pass it listed 45 Development technologies / 129 levels, 44 Economy technologies / 132
levels, and 102 Battle technologies / 453 levels. RUGLANDS keeps the same Development and Battle
family structure; Economy has 36 technologies because RUGLANDS has three resources rather than
Kingshot's four.

## Shape and baseline totals

| Branch | Technologies | Upgrade levels | Base queue time | Purpose |
| --- | ---: | ---: | ---: | --- |
| Development | 45 | 129 | 61.6 days | Compound build, research, training and recovery |
| Economy | 36 | 108 | 43.3 days | Separate city output and World gathering for all three resources |
| Battle | 102 | 459 | 278.5 days | Universal stats, arm specialization and march capacity |
| **Total** | **183** | **696** | **383.4 days** | Before completed research-speed bonuses |

The Academy has one queue. Every research level requires its explicit Academy level, the previous
level of the same technology, all listed prerequisite technologies and its Cash / Oil / Power cost.
Completed research is permanent. A queued level provides no benefit until completion.
Every one of the 696 level rows explicitly declares `category: development|economy|battle`.
Validation rejects missing/mismatched categories and effect keys that are not registered to a live
account system. See `docs/RESEARCH-EFFECTS.md` for the runtime wiring matrix.

## Academy gates

- Phase 1: Academy 1–5
- Phase 2: Academy 6–10
- Phase 3: Academy 11–15
- Phase 4: Academy 16–20
- Phase 5: Academy 21–25
- Phase 6: Academy 26–30

Technology rows may use only part of a phase. For example, early three-level technologies require
three consecutive Academy levels. Final Development VII rows remain gated at Academy 30, matching
the Kingshot pattern where the final band continues after the building reaches its level cap.

## Maximum completed effects

Development:

- construction speed +28%; research speed +28%; all-arm training speed +57%
- training batch capacity +204 internal units (stacks with the training building's 17–209 base batch)
- healing speed +148%; Hospital capacity +1,023,600 internal wounded units
- three Command Tactics milestones, for +3 World march queues

Economy, independently for Cash, Oil and Power:

- city production +66%
- matching World gathering speed +148%

Battle:

- all-troop attack / defense / health / lethality +23% each
- Army, Navy and Air attack / defense / health / lethality +48% each
- single-march capacity +50%

Troop tiers are deliberately **not** unlocked in the Academy. T1–T10 remain gated by Army Camp,
Naval Base and Airfield levels. This avoids two independent hard gates for the same troop.

## Source of truth and tuning

All 696 upgrade rows live in `docs/numbers.json → research.techs`. Each row explicitly stores:

- `category`
- `academyLevel`
- `cost.res.cash`, `cost.res.oil`, `cost.res.power`
- `timeSec`
- cumulative `might`
- cumulative `effect.key`, `effect.value`, `effect.unit`

Use **Admin → Research** to edit the rows by branch and Academy phase. Exporting the dashboard and
committing the exported `numbers.json` remains the shared balancing workflow. `scripts/bake-research.mjs`
is only the reproducible v0.8 seed generator; after human tuning, the explicit JSON rows are authoritative.

The player-facing Research Institute renders Development, Economy and Battle as text-only vertical
dependency trees. Layout depth is derived from each technology's `requirements`: every prerequisite is
placed above its dependent node and the connecting path is highlighted when either end is selected.
Clicking a node shows its level, Academy gate, prerequisites, cost, time and effect in a sticky detail panel.
For walletless local UI testing, use `/?town&gm`; this route exists only in development builds.
