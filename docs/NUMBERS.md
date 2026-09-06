# RUGLANDS — Numbers (human map of `numbers.json` v0.6)

`docs/numbers.json` is the machine **source of truth**. This file is the readable map +
the **per-level tunable-field inventory**. Buildings now have explicit `levels.1`–`levels.30`
rows and troops have explicit `tiers.1`–`tiers.10` rows. Runtime and admin both read these rows directly.

## Resources (3 + premium)
`res.cash` (🏦 Bank) · `res.oil` (🛢️ Oil Well) · `res.power` (⚡ Power Plant) · `res.premium` (gems).
All three are the base cost for upgrades/training; stored in the Warehouse (capped).

### Display denomination

The UI displays resources and troop headcount at **×1,000** (`global.display`). This is a
denomination layer: costs, production, storage, troop capacity and training batches all scale
together, while underlying progression time and queue math remain unchanged. Troop Might uses the
displayed headcount; resource scale does not affect Might.

## Buildings — 14, all max **Lv.30**, gated by Townhall level (unlock @ Townhall Lv)
Every upgradable building has, **per level**: cost `{cash, oil, power}` · upgrade `time` · Might contribution.
Building-specific per-level fields:

| Key | unlock | per-level fields (beyond cost/time) |
|---|---|---|
| `building.keep` (Townhall) | start | — (gates all; L10 lifts shield; → L30) |
| `building.bank` / `oilwell` / `powerplant` | 1 | **productionPerHour** |
| `building.storage` (Warehouse) | 2 | **capacityPerResource**, **protectedFraction** (raid protection) |
| `building.armyCamp` | 1 | Army **troopCapacity**, **trainSpeedMult**, **trainQueueSize**; its level unlocks Army tiers |
| `building.navalBase` | 2 | Navy **troopCapacity**, **trainSpeedMult**, **trainQueueSize**; its level unlocks Navy tiers |
| `building.airfield` | 4 | Air **troopCapacity**, **trainSpeedMult**, **trainQueueSize**; its level unlocks Air tiers |
| `building.hospital` | 3 | **woundedCapacity**, **healTimePerTroopSec**, **healCostPerTroop** |
| `building.embassy` | 5 | **reinforcementCapacity** (allied troops) |
| `building.wall` | 2 | **defenseValue** |
| `building.academy` | 4 | **researchBranches** (troops/economy/development — nodes later) |
| `building.watchtower` | 3 | **soloTaskSlots** |
| `building.milestone` | start | none — **not upgradable** (server-progress display) |

## Troops — 3 arms × T1–T10
`troop.army` (🪖) · `troop.navy` (⚓) · `troop.air` (✈️). Per (arm × tier): train time/troop,
cost/troop `{cash,oil,power}`, attack, defense, power, load. Each arm has its own training building,
capacity and queue. A tier's `unlockAtTrainingBuilding` is checked against that building's level.
Counter **+10% attack**, **air > ground > sea > air**.

## Might

`Total Might = Infrastructure Might + Troop Might`.

- Every building level row stores its **cumulative** Infrastructure Might explicitly, so Admin can
  tune a single level without changing code.
- Troop Might is `displayed troop count × tier power`. The shared T1–T10 power curve is
  **2 / 4 / 8 / 16 / 24 / 36 / 52 / 72 / 96 / 128**.
- At all buildings Lv.30 and all three armies filled to 60% capacity with T10, the current baseline
  is **23.9% infrastructure / 76.1% troops**. Early accounts are naturally more building-heavy.
- Might is a visible progression/status score. Combat continues to use troop stats, counters,
  wall and later modifiers; two players with similar Might need not have equal combat strength.

## Townhall prerequisites (`townhallPrerequisites`)
To upgrade TH→L, listed buildings must be **≥ L−1**. Fixed & known (not random). **Warehouse anchor**
from L3+. Count escalates **2** (L2–19) / **3** (L20–24) / **4** (L25–30). Full per-level list (L2–30) in JSON.

## Design targets (`designTargets`) — first calibrated baseline
- Pacing: Townhall **L1→L10 in ~2–3 days** (newbie), **L1→L30 in ~4–5 months** F2P (no speedups, 2 slots).
- Values are explicit, not formulas. The initial seed used segmented cost/time/production curves, then was calibrated row-by-row compatible.
- Production is **per hour** everywhere. Building families use distinct time ratios; there is no global “all side buildings are 40–50% of TH” rule.
- Troops: cost ×1.7/tier, time ×1.3/tier, attack ×1.3/tier, def/hp ×1.15/tier; counter +10%.
- Combat: **loot & gather = troop `load`**; casualties → wounded (to Hospital cap) then dead; `woundedRatio` 0.7.
- Offline: 12h collector cap, auto-collect on login, no AFK/online mode.

## Local pacing simulator
`/?admin` runs the same explicit tables through a deterministic build/resource scheduler. Default calibration:

- 3 sessions/day, 85% build-queue uptime, 12h collector cap.
- Starting resources + passive city production included.
- Tutorial, tasks, gathering, PvE, events and speedups excluded.
- Current baseline: **TH10 ≈ 3.0 days; TH30 ≈ 122 days**.

Early passive production is intentionally generous because outside-city faucets do not exist yet.
Rebalance it downward when those faucets ship; do not silently stack new rewards on top.

*v0.6 — large-number display denomination + explicit building/troop Might model.*
