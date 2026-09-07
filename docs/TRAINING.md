# Training and promotion v0.8

Army Camp, Naval Base and Airfield use one shared mechanical model and separate queues. Theme names can
change later; code and data continue to use the stable building/troop Keys.

## Kingshot reference shape

The building ladder uses Kingshot's Barracks values as the baseline:

| Troop tier | T1 | T2 | T3 | T4 | T5 | T6 | T7 | T8 | T9 | T10 |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| Building level | 1 | 4 | 7 | 11 | 13 | 16 | 19 | 22 | 26 | 30 |
| Base seconds / troop | 12 | 17 | 24 | 32 | 44 | 60 | 83 | 113 | 131 | 152 |

Base batch capacity is stored explicitly for building levels 1–30 and rises from 17 to 209. Academy
Development research adds a flat capacity bonus after the building row is read. The UI displays the
project's ×1,000 troop denomination, so 17 internal units appear as 17,000 troops.

References:

- [Kingshot Barracks level data](https://kingshotdata.com/buildings/barracks/)
- [Kingshot troop training and promotion data](https://ks-toolkit.com/data/troops/infantry/)

## RUGLANDS adaptation

Kingshot's four troop resources are mapped to the project's three-resource economy: Bread → Cash,
Wood → Oil, Stone + Iron → Power. The resulting per-unit costs and base times are explicit in
`docs/numbers.json`. Army/Navy/Air attack, defense, load, power and Might values are not imported from
Kingshot; they retain the existing RUGLANDS balance.

For a new batch:

- maximum quantity = minimum of remaining arm capacity and effective queue capacity
- duration = base seconds × quantity ÷ effective training-speed multiplier
- cost = target tier per-unit cost × quantity

For promotion from tier A to a higher unlocked tier B:

- promotion unlocks at the matching training building's level 13
- resource cost = `(B cost − A cost) × quantity`
- duration = `(B base time − A base time) × quantity ÷ training speed`
- batch maximum = `floor(effective normal batch × B base time ÷ (B base time − A base time))`
- source troops are reserved immediately; target troops and their Might arrive only when the queue finishes

## Queue invariant

The state layer, not only the buttons, enforces:

- Research Institute researching → building upgrade rejected
- Research Institute upgrading → new research rejected
- training building training/promoting → building upgrade rejected
- training building upgrading → new training/promotion rejected

Old saves migrate idle/active legacy training queues to `mode: train`. New promotion queues persist their
source tier so reloads and GM queue completion cannot duplicate troops.
