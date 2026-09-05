# RUGLANDS — Numbers (v0.2, "new-account" early game)

Companion to `numbers.json` (machine source of truth) + the naming bible (names).
**Anchored to CoC's EARLY game — a brand-new account's first days**, not endgame CoC.
(CoC has no server resets — it's global matchmaking — but the intent, "match the fresh-start content & pacing," is what we're building to.)

## The one formula
```
value(L) = round(base × growth^(L-1))     // times in seconds, production per hour
```
Change a curve = change `base` (level-1 value) or `growth`. That's the whole knob set. Code doesn't change.

## What a brand-new account starts with (`startingLayout`)
- **Keep L1**, plus pre-built **Mine + Farm + Barracks** (L1).
- **2 build slots** (CoC's two builders — always something cooking).
- 500 build + 500 food + 50 gems. 0 troops. **48h newbie shield.**
- Storage/Wall/Hospital are **not visible yet** — they drip in as you raise the Keep.

## Content drip (`unlockAtKeep`) — the "new-server" feel
| Keep level | unlocks |
|--|--|
| **L1 (start)** | Keep, Mine, Farm, Barracks, T1 troop, map/gathering/monsters |
| **L2** | Storage, Wall |
| **L3** | Hospital (wounded healing) |
| L4–L10 | just deeper levels of the above (more content = Phase 2) |

So the first session shows ~4 buildings, not 30. Buildings also cap at your current Keep level.

## First 30 minutes (onboarding / pacing beat-sheet)
1. Spawn at your Keep (random spot), 48h shield on, tutorial arrow.
2. Mine + Farm already running. Start upgrading both (seconds) — both build slots busy.
3. Train a handful of T1 troops (6s each) at the Barracks.
4. March on a nearby **monster / NPC keep** → win → **first loot** + battle report.
5. Collect → upgrade **Keep to L2** (~1.3 min) → **Storage + Wall unlock**.
6. Keep upgrading (timers still tiny) → **Keep L3 unlocks Hospital**; a scripted raid hits you → you watch **wounded heal** → learn "nothing is ever destroyed."
7. Log off → return → **offline resources waiting** (the hook).

## Keep (`building.keep`) — the gate  ·  cost 200/150 ×1.6 · time 45s ×1.75
| L | build | food | time | maxTroops |
|--|--|--|--|--|
|1|200|150|45s|150|
|2|320|240|~1.3m|203|
|3|512|384|~2.3m|273|
|5|1,311|983|~7m|498|
|7|3,355|2,516|~21m|906|
|10|13,744|10,308|~1.9h|2,296|

## Producers (`building.mine`→build, `building.farm`→food)  ·  prod 120/hr ×1.35 · time 30s ×1.65
| L | prod/hr | upgrade time |
|--|--|--|
|1|120|30s|
|3|~219|~1.4m|
|5|~398|~3.7m|
|10|~1,836|~46m|
Offline: producers bank up to **12h**, then sit full until collected (also capped by storage).

## Storage (`building.storage`, unlock Keep L2)  ·  cap 3,000 ×1.5 · **protected 35%**
| L | capacity | protected |
|--|--|--|
|1|3,000|1,050|
|5|15,188|5,316|
|10|115,330|40,365|

## Barracks (`building.barracks`) · train ×(1+0.08·(L-1)) · queue 10 ×1.25 · time 40s ×1.7
## Wall (`building.wall`, unlock L2) · defense 100 ×1.5 · time 20s ×1.6
## Hospital (`building.hospital`, unlock L3) — the non-destructive keystone
wounded cap 100 ×1.4 · heal 2s + (3 food/2 build) per troop.
In a raid, **70% of casualties are WOUNDED** (healable, capped) and only **30% die**. No keep, no levels, ever lost.

## Troop (`troop.t1`)
12 food + 8 build · train 6s · atk 5 / def 4 / power 5 · load 10. (More tiers later: same fields, ×~1.8/tier.)

## Raid math (non-destructive)
```
AP = Σ(atkTroops × attack) × marchBonus
DP = Σ(defTroops × defense) + wallDefense + keepBonus(40/lvl)
winRatio = AP / (AP + DP)
loot     = min( Σ atkTroops × load , unprotectedResources × 0.5 )
loserLoss% = 0.6 × (enemyPower / (ownPower + enemyPower)) ; winner ≈ half
of losses: 70% wounded → hospital, 30% dead
```

## Might (`stat.might`)
`Σ building power(per-level × L) + troops × 5`. Per-level: Keep 30, Barracks 10, Mine/Farm 8, Storage/Hospital 6, Wall 4.

## Protection (`sys.shield`)
newbie 48h · auto 4h shield if a raid takes >15% of resources.

## Map
`map.node` gather 40/troop/hr (depletes) · `pve.monster` L1–5 power 300 ×1.6, reward 400 ×1.5 + 1 gem · `pve.npc_keep` might band 0.5–1.5× local.

## Tuning
Edit `base`/`growth` in `numbers.json`. Rule of thumb: growth 1.3–1.4 = production (gentle), 1.5–1.6 = costs, 1.65–1.8 = times (late upgrades gate on time). Sanity-check the loop in Machinations.io before locking if you like.

*v0.2 — starter defaults tuned to a fresh account. Retune after first playtest.*
