# Research effect runtime matrix

Every research level belongs explicitly to exactly one of three categories. A level is valid only when
its effect key is registered to a live account system and belongs to the same category as its technology.

## Development

| Effect | Account result |
| --- | --- |
| Construction speed | Shortens every new building upgrade timer |
| Research speed | Shortens every new Research Institute timer |
| Training capacity | Adds to each Army/Navy/Air building's batch maximum |
| Training speed | Shortens training and promotion queues |
| Healing speed | Shortens the Hospital healing queue |
| Hospital capacity | Adds real wounded beds used by World combat |
| March queues | Adds simultaneous World dispatch slots |

`Command Tactics I/II/III` are one-level milestones gated at Academy 9/19/29. Each contributes +1 to
the wallet's `marchQueueBonus`; the current base is 2, producing 3/4/5 simultaneous World marches.

## Economy

Cash, Oil and Power each have separate Production and Gathering effects. Production changes the matching
city building's hourly output; Gathering changes work time only on the matching World resource field.
Both are account-wide and automatic.

## Battle

| Effect family | Account result |
| --- | --- |
| All-troop attack + lethality | Multiplies outgoing Army/Navy/Air attack power |
| All-troop defense + health | Multiplies defending Army/Navy/Air power |
| Army/Navy/Air attack + lethality | Multiplies only the matching arm's outgoing power |
| Army/Navy/Air defense + health | Multiplies only the matching arm's defending power |
| March capacity | Increases the maximum troop count of one dispatch |

Completed levels persist on `GameState.research`. The city derives modifiers from those levels; the World
adapter snapshots them onto the wallet's player record and refreshes that snapshot during reconciliation.
Future hero effects remain a separate per-march snapshot, avoiding double counting permanent research.

## Wounded and healing integrity

World casualties retain a tiered wounded roster. Hospital healing keeps them unavailable during recovery,
restores the original Army/Navy/Air arm and T1–T10 tier, charges its configured cost, and uses completed
healing-speed research. Existing occupied beds are subtracted from researched Hospital capacity before each
battle, so overflow becomes dead. Legacy scalar wounded saves remain recoverable as Army T1 because those
saves never recorded their original tier identity.
