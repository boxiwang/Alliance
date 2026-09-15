# Combat — full feature + outcome enumeration (Batch 3 contract)

Real-player combat is **server-authoritative**: the worker/DO resolves the battle
from each side's mirrored state (`/state` `game_json` already holds troops /
resources / wall / hospital) and delivers **one identical report to both sides**.
Reuses the existing engine model (`resolveCombat`, march states, troop arms).
This doc enumerates everything combat can do and every result it can produce, so
we build against a fixed spec. Numbers below are the current engine defaults.

---

## A. Player actions (combat features)
1. **Scout** a real player's city — recon march; returns an intel snapshot with a
   TTL (decays). See §E.
2. **Attack** a real player's city — march a chosen force (arms + tiers) to their
   coord; server resolves on arrival. See §C/§D.
3. **Gather / occupy** a contested resource planet — PvP over resource nodes
   (occupy → produce; another player can attack to seize). *(v1 optional — decide.)*
4. **Reinforce** a same-alliance member's city (send troops to defend).
   *(alliance-gated → later, ships with alliances.)*
5. **Rally** — multiple players stack one attack on a target.
   *(later; needs alliance + coordination UI.)*
6. **Recall** an in-flight march before it lands (`recalled` state) → troops
   return, no battle.
7. **Defend** (passive) — garrison + wall + shield decide the defense.
8. **Relocate** — after being attacked, city may random-teleport to escape
   (`relocateAt`). *(v1 optional — decide.)*

## B. Preconditions / gates to attack (all must hold)
- Target is **not you**, **not same alliance**, **not an ally/NAP**.
- Target is **not shielded** (72h beginner shield, or a shield item/post-attack
  shield). Attacking a shielded city is rejected.
- You have **idle troops** (not already committed to another march) and a **free
  march slot** (`marchSlots`).
- You **found** the target legitimately (explored the map / scouted / same
  alliance) — no locate-by-identity (location-privacy death rule, §G).
- Attacking usually **drops your own shield** (can't hide-and-hit).
- March time scales with **distance**; scout is faster (`scoutSpeedMultiplier`).

## C. Resolution inputs (server)
- **Attacker**: force by arm (army/navy/air) × tier → power; **dominant arm**
  (mixed-arm counter); carry capacity (loot cap); attacker hospital wounded cap
  (currently **0 while marching** → attacker casualties are all dead unless we
  change it).
- **Defender**: garrison troops → power; **wall integrity** (defense bonus, can be
  burning = reduced); might; resources with **protectedFraction 0.25** (75%
  lootable); defender **hospital capacity** (wounded cap).
- Casualty math: `lossFraction` from power ratio × `casualtyScaling`; casualties
  split **wounded/dead** by hospital capacity (overflow → dead).

## D. Possible OUTCOMES (results)
### Attacker
- **Win** / **Loss** / **Mutual wipe (draw)**.
- Casualties: `{wounded, dead}` — wounded to hospital up to cap, rest dead (see §C
  caveat: 0 wounded-cap while marching by default).
- **Loot** gained = min(defender unprotected resources, attacker carry capacity)
  → partial if carry < available.
- Surviving troops **return home** with loot; **might** updated; battle report.
### Defender
- Casualties `{wounded, dead}` (wounded to hospital up to cap).
- **Resources looted**: unprotected = total × (1 − protectedFraction); protected
  stays. Might updated.
- **Wall damage / burning** (`burningUntil`) → weaker defense for a window.
- Optional **post-attack protection shield** granted. *(decide §I.)*
- Optional **relocate** offer. *(decide.)*
- Receives a **"you were raided"** report + notification.
### Both
- **One consistent report** with identical numbers delivered to both sides.
- **Idempotent**: a refresh / reconnect never double-applies a resolved battle.
### Edge outcomes
- **Blocked**: target shielded / relocated / went offline mid-march → march
  bounces or fails with a "shielded/gone" report; no losses applied.
- **Rejected** (before dispatch): zero troops, self/ally/alliance target, no
  march slot, insufficient idle troops.
- **Loot capped** by carry; **wounded overflow → dead** when hospital full.
- **Mutual annihilation**: both forces reduced to zero.

## E. Scout outcomes
- **Success** → intel snapshot: estimated force / arms split, estimated
  resources, wall state, shield status, might; **TTL-limited** (decays, must
  re-scout). Shareable via the existing relay (coordinate/recon intel).
- Scouting a **shielded** city still returns recon (recon allowed under shield) —
  *decide if shield blocks scouting.*
- Optional: defender is **notified they were scouted**. *(decide — default off.)*

## F. Protections / anti-grief (rules)
- **72h beginner shield** on new cities (`beginnerShieldDurationSec`).
- **Troop lock**: troops on a march can't be used elsewhere until they return.
- **March-slot cap** limits concurrent attacks.
- **No** self / same-alliance / ally (NAP) attacks.
- Attacker **loses its shield** on attacking.
- *(decide)* **Post-attack shield** for the defender (anti-farm).
- *(decide)* **Might-gap / bully protection**: block attacking a far-weaker city.

## G. Location-privacy interaction (death rule)
You can only attack a target you **found by exploring the map**, **scouted**, or a
**same-alliance** member — never by looking someone up by name/id. No
locate-by-identity, no coord handed out except within your alliance. This shapes
"who can even be attacked": mostly your map neighbours.

## H. Server authority + anti-cheat (beta scope)
- Server resolves from **mirrored `game_json`** (troops/resources/wall) in D1.
- Attacker's declared force is **validated against** the server's mirrored troops.
- Losses/loot applied to **both** players' `game_json`; both clients re-sync from
  `/state`. Client economy is still locally mutable (beta-tolerated); full
  anti-cheat = server-authoritative economy, out of scope for the friends beta.

## I. Decisions needed before building (these change the build)
1. **Post-attack shield** for the defender? (recommend **yes**, short, anti-farm.)
2. **Might-gap bully protection**? (recommend a soft cap: can't hit cities far
   below you, or reduced loot.)
3. **v1 scope**: city attacks only, or also **resource-node PvP occupation**?
   (recommend **city attacks only** in v1.)
4. **Attacker wounded**: keep 0-while-marching (all-dead attacker casualties) or
   give attacker a hospital-backed wounded cap? (recommend keep default v1.)
5. **City relocation** after attack? (recommend **later**, not v1.)
6. **Reinforce / rally** → later with alliances (not v1).

## J. Build phases
1. **Scout a real player** — server snapshot from mirrored state (read-only, low
   risk).
2. **March to a real player** — server-tracked march, visible to both, distance
   time + shield/precondition checks + troop lock.
3. **Server resolves** — battle math on the server; apply losses/loot to both;
   write one report to each; idempotent.
4. **Protections** — beginner + post-attack shields, bully protection, cooldowns.
