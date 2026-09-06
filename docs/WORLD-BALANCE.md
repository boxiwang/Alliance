# Personal World — balance baseline v0.7

This is the repeatable baseline for outdoor Personal Mode. Run it after editing
`docs/numbers.json`:

```bash
npm run balance:world
```

The command is diagnostic and does not write files. The Admin **World** page runs the same
scenarios live and raises warnings while values are edited.

## Reference player

Each monster level maps to an expected Townhall and the best troop tier unlocked there. The
reference force contains 60% of the combined capacity of Army Camp, Naval Base and Airfield,
split evenly across the three arms. This is a stable balancing ruler, not a forced player loadout.

## Targets

- A 75% reference force should lose to its matching monster.
- A 100% reference force should have a 55–58% win ratio.
- A 125% reference force should win.
- Winning PvE casualties remain under 2%; PvE casualties are wounded first and use Hospital space.
- A matching resource field occupies its march for 2–6 hours; the current baseline is about 4 hours.
- A monster's resource reward equals 10–30% of the matching resource field; baseline is 20%.
- An equal-progression city attacker has a 45–50% ratio. Baseline is 47%, so defense wins unless
  the attacker brings better composition, more troops or future hero/research advantages.
- A typical 20-tile round trip takes 2–10 minutes; baseline is 4 minutes.
- Regeneration supports 8–30 monster attacks per day; baseline is 24, with 10 stored at full Energy.

## Why v0.7 changed the old values

The first executable report exposed two curve failures:

- Matching monster win rates rose from 86% at L1 to 99.8% at L10. Monster power grew much more
  slowly than troop capacity and troop attack, so the PvE progression stopped functioning.
- Matching resource-field occupancy rose from 10 hours at L1 to 343.9 hours at L10. Supply doubled
  each level while gather rate grew too slowly, so later gathering was effectively unusable.
- Equal city PvP drifted from a 52.6% attacker ratio at TH5 to 32.4% at TH30 because Wall defense
  outgrew the fielded troop curve.

The v0.7 tables bake explicit per-level values that hold the reference behavior across progression:

| System | v0.7 result |
|---|---:|
| Matching PvE win ratio | 55.9–56.0% |
| Winning PvE casualty share | 0.48–0.83% |
| Matching field occupancy | 3.8–4.0h |
| Monster reward / matching field | 20% |
| Equal city attacker ratio, TH5–30 | 47.0% |
| Typical 20-tile round trip | 240s |
| Energy-regenerated hunts/day | 24 |

These are transparent MVP defaults, not claims that balance is finished. Real playtests should
change the target bands first when the desired experience changes, then tune explicit rows until
the report is clean again.
