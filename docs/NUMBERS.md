# RUGLANDS — Numbers (human map of `numbers.json` v0.3)

`docs/numbers.json` is the machine **source of truth**. This file is the readable map +
the **per-level tunable-field inventory** the per-level migration must cover.
⚠️ Current cost/time/production values are **FORMULA placeholders** (`value(L)=round(base·growth^(L-1))`);
NEXT step = bake explicit **per-level tables** to `designTargets`, verified by a pacing simulator.

## Resources (3 + premium)
`res.cash` (🏦 Bank) · `res.oil` (🛢️ Oil Well) · `res.power` (⚡ Power Plant) · `res.premium` (gems).
All three are the base cost for upgrades/training; stored in the Warehouse (capped).

## Buildings — 12, all max **Lv.30**, gated by Townhall level (unlock @ Townhall Lv)
Every upgradable building has, **per level**: cost `{cash, oil, power}` · upgrade `time` · Might contribution.
Building-specific per-level fields:

| Key | unlock | per-level fields (beyond cost/time) |
|---|---|---|
| `building.keep` (Townhall) | start | — (gates all; L10 lifts shield; → L30) |
| `building.bank` / `oilwell` / `powerplant` | 1 | **production** (target: per-minute) |
| `building.storage` (Warehouse) | 2 | **capacityPerResource**, **protectedFraction** (raid protection) |
| `building.barracks` | 1 | **troopCapacity** (shared max troops), **trainSpeedMult**, **trainQueueSize** |
| `building.hospital` | 3 | **woundedCapacity**, **healTimePerTroopSec**, **healCostPerTroop** |
| `building.embassy` | 5 | **reinforcementCapacity** (allied troops) |
| `building.wall` | 2 | **defenseValue** |
| `building.academy` | 4 | **researchBranches** (troops/economy/development — nodes later) |
| `building.watchtower` | 3 | **soloTaskSlots** |
| `building.milestone` | start | none — **not upgradable** (server-progress display) |

## Troops — 3 arms × T1–T10
`troop.army` (🪖) · `troop.navy` (⚓) · `troop.air` (✈️). Per (arm × tier): train time/troop,
cost/troop `{cash,oil,power}`, attack, defense, power, load. Trained in Barracks (shared capacity).
Counter **+10% attack**, **air > ground > sea > air**.

## Townhall prerequisites (`townhallPrerequisites`)
To upgrade TH→L, listed buildings must be **≥ L−1**. Fixed & known (not random). **Warehouse anchor**
from L3+. Count escalates **2** (L2–19) / **3** (L20–24) / **4** (L25–30). Full per-level list (L2–30) in JSON.

## Design targets (`designTargets`) — first-version numbers reference real SLG (WoS/CoC/RoK)
- Pacing: Townhall **L1→L10 in ~2–3 days** (newbie), **L1→L30 in ~4–5 months** F2P (no speedups, 2 slots).
- Curves: building cost growth ~×1.5 (L1–10) / ~×1.65 (L11–30); time growth ~×1.6 / ~×1.37 tail (keep base 45s);
  other buildings ≈ 40–50% of Townhall time. Production **per-minute**, ~×1.3/level.
- Troops: cost ×1.7/tier, time ×1.3/tier, attack ×1.3/tier, def/hp ×1.15/tier; counter +10%.
- Combat: **loot & gather = troop `load`**; casualties → wounded (to Hospital cap) then dead; `woundedRatio` 0.7.
- Offline: 12h collector cap, auto-collect on login, no AFK/online mode.

## Reconcile during migration
- `productionPerHour` fields are still **per-hour**; `designTargets.productionUnit` is **per-minute** — convert.
- Replace all `base/growth` curves with explicit per-level tables; game reads table lookup instead of the formula.

*v0.3 map — values are placeholders pending the per-level bake.*
