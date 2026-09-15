# Combat — full feature + outcome enumeration (Batch 3 contract) — v2

Real-player combat is **server-authoritative**: the worker/DO resolves the battle
from each side's mirrored state (`/state` `game_json` holds troops / resources /
wall / hospital) and delivers **one identical report to both sides**. Reuses the
existing engine model (`resolveCombat`, march states, troop arms). v2 folds in the
owner's rules (2026-09-15): offline is not safe; only same-alliance is protected;
reports to System; scout/incoming alerts; attacker-disadvantage casualty math; and
the "shielded until keep 10 unless you attack" protection model.

---

## A. Player actions (combat features)
1. **Scout** a real player's city — recon march → intel snapshot with a TTL. The
   defender **is alerted** they were scouted (§E, §D-alerts).
2. **Attack** a real player's city — march a chosen force to their coord; server
   resolves on arrival. The march is **telegraphed to the defender** (incoming
   alert), so attacks are not a silent surprise.
3. **Gather / occupy** a contested resource planet. *(v1 optional — default: city
   attacks only in v1.)*
4. **Reinforce** a same-alliance city. *(ships with alliances — later.)*
5. **Rally** — multiple players stack one attack. *(later.)*
6. **Recall** an in-flight march before it lands → troops return, no battle.
7. **Defend** (passive) — garrison + wall + shield decide the defense.
8. **Relocate** after being attacked. *(later, not v1.)*

## B. Preconditions / gates to attack (all must hold)
- Target is **not you** and **not in your alliance**. **NAP / other-alliance
  players ARE attackable** (NAP is breakable — you can betray/attack a NAP).
- Target is **not shielded** (see §F shield model). Attacking a shielded city is
  rejected.
- **Offline does NOT protect** — an offline player can be raided; only a shield
  protects. (They get the report/alert when they return.)
- You have **idle troops** (not on another march) and a **free march slot**.
- You **found** the target legitimately (explored the map / scouted / same
  alliance) — no locate-by-identity (location-privacy death rule, §G).
- **Attacking drops your own shield** (see §F) — you can't hide-and-hit.
- March time scales with **distance**; scout is faster (`scoutSpeedMultiplier`).

## C. Resolution inputs (server)
- **Attacker**: force by arm (army/navy/air) × tier → attack power; **dominant
  arm** mixed-arm counter; carry capacity (loot cap); **attacker home hospital
  capacity** (now used — attacker gets *some* wounded, §H).
- **Defender**: garrison → defense power, **plus the defender edge** (wall
  integrity / home-ground multiplier → attacker needs more power to win; wall can
  be `burning` = reduced); might; resources with **protectedFraction 0.25** (75%
  lootable); defender hospital capacity.

## D. Possible OUTCOMES (results)
### Attacker
- **Win** / **Loss** / **Mutual wipe**. Attacker is structurally disadvantaged
  (defender edge + lower wounded-recovery, §H) — winning still costs, and the
  attacker's fallen skew toward **dead**.
- Casualties `{wounded, dead}`: some wounded return to the attacker's **home
  hospital** (up to capacity), the rest **die** (lower wounded ratio than the
  defender).
- **Loot** = min(defender unprotected resources × lootRate, attacker carry).
- Survivors + loot **return home**; **might** updated; battle report to System.
### Defender
- Casualties `{wounded, dead}`: **most go to the hospital** (wounded, recoverable)
  up to capacity; overflow dies. (Defender recovers far more than the attacker.)
- **Resources looted** = unprotected (total × 0.75); protected 25% stays.
- **Wall damage / burning** → weaker defense for a window.
- May receive a **post-attack protection window** *(decide duration)*.
- **Might** updated; battle report to System.
### Both
- **One consistent report**, identical numbers, delivered to **both** sides and
  **filed in Messages → System** (queryable there, §D-reports).
- **Idempotent**: refresh / reconnect never double-applies a resolved battle.
### Reports (point 3)
- Every scout / incoming-march / battle produces a **System report** for each
  affected player, visible in **Messages → System** (reuses `playerSystemReports`
  / the System channel). Battle report shows: result, both sides' losses
  (wounded/dead), loot, wall damage.
### Alerts (point 4)
- **Phase 1 (message alert)**: the defender gets a System notification when
  someone **scouts** them and when an **attack march is inbound** ("army on the
  way", with ETA). Uses the existing critical-notification channel.
- **Phase 2 (site-wide effect)**: a full-screen / global visual alarm for an
  incoming attack. *(later.)*
### Edge outcomes
- **Blocked**: target shielded / relocated mid-march → march bounces, no losses;
  "shielded/gone" report.
- **Rejected** (pre-dispatch): zero troops, self/same-alliance target, no march
  slot, insufficient idle troops.
- **Loot capped** by carry; **wounded overflow → dead** when hospital full.
- **Mutual annihilation** possible.

## E. Scout outcomes
- **Success** → intel snapshot: estimated force / arms, estimated resources, wall
  state, shield status, might; **TTL-limited** (decays; re-scout to refresh);
  shareable via the existing relay.
- **The defender is alerted they were scouted** (point 4) — scouting is not
  invisible.
- Scouting a shielded city still returns recon (recon allowed under shield).

## F. Shield / protection model (point 6 — REPLACES the old 72h beginner shield)
- **Before Keep level 10**: a city is **permanently shielded as long as it does
  not attack anyone.** New/low players are safe to grow untouched.
- **Attacking drops the shield.** Launching any attack marks you PvP-active and
  removes the sub-10 auto-shield; it **re-arms after a no-aggression cooldown**
  *(decide, e.g. 24h)* while still under Keep 10.
- **At Keep level 10+**: no automatic shield — protection is via **shield items**
  (bought / earned, timed). This is the P2W-adjacent late-game shield economy.
- Other invariants: **troop lock** during a march; **march-slot cap**; **no
  self / same-alliance** targets; NAP is attackable.
- *(decide)* short **post-attack shield** for a freshly-raided defender (anti-farm)
  — independent of the sub-10 rule.

## G. Location-privacy interaction (death rule)
You can only attack a target you **found by exploring the map**, **scouted**, or a
**same-alliance** member — never by identity lookup. No coord handed out except
within your alliance. So attackable targets are mostly your **map neighbours**.

## H. Casualty math (point 5 — attacker disadvantage, defender recovers more)
Convention borrowed from mainstream SLG (Lords Mobile / Clash of Kings style):
**the defender, fighting at home, sends most of its fallen to the infirmary
(recoverable) up to capacity; the attacker, away from home, loses a larger share
outright and recovers fewer.** There is no single universal constant — these
ratios encode that principle. Built on the existing engine (`resolveCombat`,
`splitCasualties`, `lossFraction`):

- **Defender edge**: defense power gets a home/wall multiplier so a ~equal force
  loses as the attacker → "攻方吃亏". Wall `burning` reduces this edge.
- **Winner loses less**: keep `winnerLossMultiplier` (0.5) — the victor takes a
  fraction of the loss share.
- **Wounded vs dead — split the single `woundedRatio` into two:**
  - `defenderWoundedRatio` ≈ **0.7** (keep) — 70% of the defender's casualties are
    wounded-eligible (to hospital up to capacity), 30% die outright.
  - `attackerWoundedRatio` ≈ **0.35** (new, lower) — only ~35% of the attacker's
    casualties are wounded-eligible, ~65% die.
- **Attacker now gets a real hospital cap** = its **home hospital woundedCapacity**
  (was hard-coded 0). So "攻打方有些兵直接死亡，有些进医院" — some recover, most of
  the fallen die.
- Wounded-eligible on each side is still **capped by that side's hospital
  capacity**; anything past the cap dies.
- Loot unchanged: `min(carry, unprotected × lootRate)`, only on a win.

Net: defender mostly recovers, attacker mostly dies-but-some-recover, and the
attacker needs a real power advantage to win at all.

## I. Server authority + anti-cheat (beta scope)
- Server resolves from **mirrored `game_json`** (troops/resources/wall/hospital)
  in D1; attacker's declared force **validated against** mirrored troops.
- Losses/loot applied to **both** players' `game_json`; both clients re-sync from
  `/state`. Client economy stays locally mutable (beta-tolerated).

## J. Build phases
1. **Scout a real player** + **defender scout alert** (System message). Read-only,
   low risk.
2. **March to a real player** — server-tracked march, visible to both,
   distance-timed, precondition + shield checks, troop lock, **incoming-attack
   alert** to the defender (System message).
3. **Server resolves** — casualty math (§H) on the server; apply losses/loot to
   both; write **one battle report to each (System)**; idempotent.
4. **Protections** — sub-10 auto-shield + attack-drops-it + re-arm cooldown; shield
   items (10+); optional post-attack shield.
5. **Site-wide incoming-attack effect** (visual alarm) — later.

## K. Decisions still open
1. Sub-10 shield **re-arm cooldown** after you attack (24h?).
2. **Post-attack** short shield for the defender, and its duration?
3. Exact `attackerWoundedRatio` / defender-edge multiplier (start 0.35 / tune).
4. v1 = **city attacks only** (recommended) vs also resource-node PvP.
