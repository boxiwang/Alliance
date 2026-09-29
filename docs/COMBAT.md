# Combat — v3 (owner decisions 2026-09-27)

Real-player combat and Rogue (PvE) combat share **one** battle model, resolved on the
server. v3 replaces v2's single-pass "total attack vs total defense" model and v2's
burning/relocation consequences. Every rule below was decided with the owner on
2026-09-27; see the **Decision log** at the end for the reasoning.

**Status:** design locked, **not implemented**. The live code is still the v1 model in
`src/lib/expedition.ts` (`resolveCombat`: one pass, attacker attack vs defender defense,
+10% counter vs the defender's dominant arm, no HP/speed/crit/randomness). The server
march (`worker/index.ts` `alarm()`) is still a telegraph with no resolution. Build plan:
`docs/BETA-P0.md` (P0-5).

---

## 1. Troop stats

Each Army / Navy / Air tier T1–T10 carries:

| Stat | Meaning |
| --- | --- |
| ATK | outgoing damage |
| DEF | reduces incoming damage |
| HP | damage one troop absorbs before it is knocked out |
| SPD | march speed only (never affects the battle); a march moves at its **slowest** arm |
| LOAD | carry for gathering and looting (existing values) |
| Counter crit | chance + multiplier, only when hitting the arm this arm counters (§4) |

**Arm identities:** Army = tank (high DEF/HP, slow, highest LOAD) · Navy = balanced ·
Air = glass cannon (highest ATK, low DEF/HP, fastest, lowest LOAD).

**Tier curve:** per-troop combat value (≈ ATK × HP) grows **×1.35 per tier** (ATK and
HP ≈ ×1.16 each; DEF grows slower, ≈ ×1.08). T10 ≈ 15× T1; T10 ≈ 4.4× T5.
**Cost curve:** training cost ×1.4–1.5 per tier, so higher tiers are slightly less
cost-efficient but far more efficient per march slot and per hospital bed. (Today's
T8–T10 costs are 7× less efficient than T1 — must be re-baked.)
**Might:** troop Might must be proportional to combat value (today T10 Might is 64× T1
while its attack is 10.7×).

## 2. Modifier stack (research now, heroes/gear later)

```
final stat = base stat × (1 + research% + hero% + gear% + buff% + home%)
```

- Additive inside the bracket (mainstream SLG convention; easiest for players to read).
- Sources: Battle research (all-troop and per-arm ATK / DEF / HP), Wall home bonus (§7),
  later heroes, hero gear, buff items, alliance tech.
- **Research target:** a fully researched account ≈ **+2 tiers** of strength, so
  research never erases the tier ladder.
- **Heroes (not in MVP, interface reserved):** each march has a lead + deputy slot
  (the existing `commanderSnapshot` already stores two nullable slots). A hero gives
  stat % to the troops it leads, march-size bonus, and skills in three separate
  families: battle (proc chance), gathering (speed / load), Rogue (damage vs Rogues).
  The strongest home hero leads the city defense. Gear only adds to the hero's stat %.
  Empty slots contribute 0, so adding heroes later changes no battle formula.

## 3. Relative weight of numbers, tier and counter

**Same-tier numbers > tier > counter.** Targets (validated by simulation, §5):

| Advantage | Worth about |
| --- | --- |
| +1 tier | +35% per troop |
| Full counter (+15% dmg + crit) | ≈ +10% troops ≈ half a tier |
| Full research | ≈ +2 tiers |
| 2× troops, same tier | decisive win |

## 4. Battle resolution

1. Build both sides' final ATK / DEF / HP per arm from the modifier stack.
2. Draw one **morale** factor per side for the whole battle: ×(1 ± 5%).
3. Fight in **rounds; both sides strike simultaneously** using the troop counts at the
   start of the round (no first strike, no initiative, no air opening volley).
4. Each round, for every attacking arm:
   - side volume: damage scales with the side's total troops **N^0.75** (compromise
     between linear "numbers crush" and square-root), shared among its arms by count;
   - damage is **split across the enemy arms by their share** of the enemy force
     (no more "defender's dominant arm");
   - **counter:** Air > Army > Navy > Air — **+15% damage** against the arm it counters,
     plus a **counter crit: 12% chance, ×1.5**, rolled **once per arm per round** (not
     per troop, or thousands of rolls average it away);
   - a per-round roll ×(1 ± 5%);
   - DEF reduces the hit; the remainder ÷ target HP = troops knocked out.
5. Subtract knock-outs from both sides at once, then repeat.
6. **End conditions**
   - **PvP:** no rout line — fight until one side has no fighting troops. Safety cap 60
     rounds; hitting the cap counts as an attacker failure (the defense held).
   - **Rogue (PvE):** the player's march **retreats once 50% of it is knocked out**
     (the attack fails, the fleet returns home).
7. **Deterministic replay:** the RNG seed is the battle id, so the server can recompute
   the exact result; retries never double-apply. The report shows procs ("Counter
   crits ×3") so surprises are visible.
8. **Pre-battle estimate** shows three bands only: Likely victory / Even / Likely
   defeat. For Rogues the estimate reads from the pessimistic side.

## 5. Simulation reference (prototype, 2026-09-27)

Same arm, no counter; A has x% more troops than B:

| A extra troops | 0% | +1% | +2% | +3% | +4% | ≥ +6% |
| --- | --- | --- | --- | --- | --- | --- |
| A win rate | 50% | 65% | 77% | 86% | 94% | 100% |

The "even fight" window is ±4% troops (≈ ±7% strength); beyond it the stronger side
wins reliably.

Counter side fielding **fewer** troops (the chosen +15% + crit row in bold):

| Counter setting | −0% | −5% | −8% | −10% | −12% | −15% |
| --- | --- | --- | --- | --- | --- | --- |
| +10% + crit | 100% | 82% | 51% | 30% | 15% | 4% |
| **+15% + crit** | 100% | 96% | 75% | **54%** | 33% | 11% |
| +20% + crit | 100% | 100% | 93% | 77% | 55% | 23% |

10k T10 attacking T5 (same arm): vs 10k T5 → attacker knocked out 11%; vs 20k T5 →
36%; vs ≥35k T5 → attacker loses.

## 6. Casualties — where knocked-out troops go

| Case | Knocked-out troops | End |
| --- | --- | --- |
| Rogue (PvE) | 100% wounded → Hospital, **no deaths** | retreat at 50% knocked out |
| PvP defender (Core ≥ 10) | **90% wounded, 10% dead**; wounded beyond Hospital capacity die | to the end |
| PvP attacker (Core ≥ 10) | **35% wounded (home Hospital), 65% dead**; overflow dies | to the end |
| Any side with Core < 10 | 100% wounded, **Hospital uncapped**, no deaths | to the end |
| Server "no-death" switch on | 100% wounded, Hospital uncapped, no deaths | to the end |

**Winner relief:** the winning side's death share is multiplied by the winner's own
knocked-out fraction:

```
winner death share = base death share × (winner knocked out ÷ winner fielded)
```

An easy win costs almost no dead (10k T10 vs 10k T5: 11% knocked out → 0.8% dead);
a bloody win approaches the base share. The loser always uses the base share.

**Hospital capacity (Core ≥ 10):** base capacity + Hospital level + research
(`hospitalCapacityBonus`). Occupied beds are subtracted before each battle.

**No-death switch:** a server-level setting with start/end times, controlled from
Admin without a deploy, for server events. Loot, healing time/cost and reports still
apply.

**Healing keeps its resource and time cost** — the cost of war is healing, which
drives players back to gathering.

## 7. Wall — turret + home bonus

The Wall no longer burns or breaks. It has three jobs:

1. **Turret (fixed, per Wall level only).** Every round the Wall knocks out a fixed
   number of attacking troops, independent of who attacks, the garrison, or the
   defender's research/heroes. Values are **T1-equivalents per round**; against tier
   t divide by that tier's HP multiplier (×1.16 per tier: ÷1.81 for T5, ÷3.80 for T10).
   Split across attacking arms by share; no counter, crit or randomness. Turret
   knock-outs follow the attacker casualty rules (65% dead, winner relief applies).

   | L | T1/round | L | T1/round | L | T1/round |
   | --- | ---: | --- | ---: | --- | ---: |
   | 1 | 1,000 | 11 | 12,000 | 21 | 140,000 |
   | 2 | 1,300 | 12 | 15,000 | 22 | 180,000 |
   | 3 | 1,600 | 13 | 20,000 | 23 | 230,000 |
   | 4 | 2,100 | 14 | 25,000 | 24 | 290,000 |
   | 5 | 2,700 | 15 | 32,000 | 25 | 380,000 |
   | 6 | 3,400 | 16 | 40,000 | 26 | 480,000 |
   | 7 | 4,400 | 17 | 50,000 | 27 | 600,000 |
   | 8 | 5,500 | 18 | 65,000 | 28 | 800,000 |
   | 9 | 7,000 | 19 | 85,000 | 29 | 1,000,000 |
   | 10 | 9,000 | 20 | 110,000 | 30 | 1,300,000 |

   Seeded at 1.5% of the same-level Army Camp `troopCapacity` (display units), then
   frozen as explicit rows — they are **not** linked to any player's strength. Tune rows
   directly after playtests. Replaces the old flat `defenseValue`.
2. **Empty city = 3-round breach.** If the city has no fighting troops (all out or in
   the Hospital), the turret fires for 3 rounds. An attacker who survives loots; one
   knocked out entirely fails.
3. **Home bonus:** defending at home, garrison DEF and HP +1% per Wall level (+30% at
   L30), entering the modifier stack as `home%`.

The Wall stays a Townhall prerequisite anchor.

## 8. Consequences of being attacked

Only troop losses (§6) and loot. **No burning, no Wall damage, no forced relocation,
no post-hit shield.** Loot = min(attacker LOAD, defender resources above the Warehouse
protection line × `lootRate`), applied on a win. A drained city with its army in the
Hospital has nothing left to take, so repeat raiding has no payoff.
Remove the existing `burning` / Wall-integrity / relocate logic in
`src/lib/world-engine.ts` and the Warp "city burning" block.

## 9. Shields, retaliation and escape

- **Core < 10:** the city is auto-shielded until it attacks anyone; attacking removes it
  **permanently** (no re-arm).
- **Weekly shield item:** every player (all levels) gets one **8-hour shield** each week
  (Monday 00:00 UTC), stockable, delivered by the Admin reward tool (`BETA-P0.md` P0-7).
- Attacking while shielded **breaks the shield immediately**.
- **How a shield looks (owner, 2026-09-28):** a shield-blue **hex-lattice dome** around the
  planet on the Star Map (outside halo + orbit; the selection lock wraps outside the dome;
  never a halo, which is a cosmetic). On the city page the core's hex lattice lights up
  shield-blue, with a light-up wave from the core when the page opens or the shield comes
  on; without a shield it stays a faint slate lattice. One rule for every view:
  `src/lib/shield.ts`. Shield status is public (no scout needed).
- **30-minute lockout:** after a battle you started resolves, you cannot raise a shield
  for 30 minutes; you also cannot raise one while an attack march of yours is outbound.
  Scouting is not an attack.
- During the lockout the only escape is **Warp**, which already requires all fleets
  home and **no hostile march inbound** — a victim who counter-marches fast pins the
  attacker in place.
- **Retaliation exception to location privacy:** the battle report lets the defender
  jump to the attacker's city until the attacker warps away.
- **Anyone may attack a Core < 10 city whose shield is gone** — a strong player gains
  little (the victim loses no troops, and loot stops at the Warehouse line) while its
  own attackers die at the attacker rate.
- **The Core 10 wall is intentional.** Experienced players may stay at Core 9 (max T3,
  because buildings cap at the Townhall level and T4 needs a level-11 camp) to enjoy
  consequence-free PvP and stockpile troops/speedups before jumping. Warn once before
  the Core 9 → 10 upgrade: deaths start and the auto-shield ends. Keep the Core < 10
  Warehouse protection line generous so newcomers keep their growth resources.

## 10. Rules carried over from v2

- Targets: not yourself, not your alliance (later); NAP players are attackable.
- Troops are locked while marching; the march-slot cap applies.
- Scouting alerts the target; intel carries a TTL.
- The defender is warned when an attack march launches (ETA).
- One identical, idempotent report to both sides, filed in Messages → System.

## 11. Implementation impact

- New `troops` stat tables (ATK/DEF/HP/SPD/LOAD/crit) and re-baked training costs and
  Might in `docs/numbers.json`.
- A shared round-based resolver used by both the worker and the client estimate; the
  worker applies losses/loot to both players' `game_json`.
- Re-tune Rogue rows for the new model (current goal: ~57% win at the matching Core
  level) and re-run `npm run balance:world`.
- Wall rows: `turretT1PerRound` + home bonus replace `defenseValue`.
- Hospital base capacity; shield items + lockout; no-death switch in Admin.
- Remove burning/relocation.

## Decision log (2026-09-27, owner + Claude)

- Numbers effect: compromise **N^0.75** (not linear, not square root).
- Counter: **+15% + 12% ×1.5 crit**, judged together with the randomness table.
- Randomness: yes, small (morale ±5% + per-round ±5%), seeded by battle id.
- Initiative: none — both sides strike simultaneously; SPD only affects marching.
- PvP has no rout line; Rogue retreats at 50% knocked out and never kills troops.
- Defender split 90/10 (was 70/30); attacker 35/65; winner relief multiplies the death
  share by the winner's own knocked-out fraction (an overwhelming T10 vs T5 win should
  cost almost nothing).
- Core < 10: no deaths and an uncapped Hospital for that side, attacked by anyone —
  no level brackets, because a drained city has nothing to farm; "camping" at Core 9
  is a feature.
- Healing keeps a cost so war drives gathering.
- No burning or Wall damage. The Wall is a fixed-value turret + home bonus; turret
  values are absolute per level because players of one level can differ hugely
  (troop totals, research, later heroes).
- Shields: weekly 8h item for everyone, stockable; 30-minute post-attack lockout;
  retaliation may locate the attacker until it warps.
- Hospital capacity (Core ≥ 10): base + level + research.
- A server no-death switch exists for events.
