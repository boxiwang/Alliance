# Personal World MVP — headless contract

This document is the implementation contract for the outdoor Personal Mode. The current
`src/World.tsx` map is a visual test shell powered by this headless engine through a local adapter.

## Implementation status — 2026-09-06

The headless engine is implemented in `src/lib/world-engine.ts`, covered by
`src/lib/world-engine.test.ts`, and now powers the current map UI through
`src/lib/world-adapter.ts`.

Implemented:

- 1,024 deterministic farthest-first city anchors, five zones, Circle exclusion and spatial queries.
- Resource, monster and city target lifecycles with respawn, burning and non-destructive relocation.
- Account troop reservation, two march slots, per-march capacity, travel timing and recall.
- Gather contention, Energy-gated sequential monsters, scouting and asynchronous city combat.
- Arrival reports, defender reports and return delivery reports; idempotent dispatch commands.
- Two nullable hero slots plus immutable modifier/effect and balance-version snapshots on every march.
- Batched deterministic event catch-up; the test suite advances 10,000 events in a 1,000-player State.

Local integration:

- The temporary adapter reconciles Town training/resource progress with troops and cargo held
  by active marches, then projects the authoritative player state back into `GameState`.
- Browser-local saves remain per wallet. A one-time migration safely settles active legacy
  `src/lib/world.ts` marches before removing the old save.
- Local test States contain one real player plus a configurable small NPC population; the
  engine itself still accepts 1,024 real player records.

Still intentionally separate:

- Shared persistence, authenticated commands and cross-process locking require the future server-authority slice.
- Balance values are provisional; target density, power, rewards, burn damage and Energy pacing need playtests.

The first deterministic balance pass is recorded in `docs/WORLD-BALANCE.md`. Run
`npm run balance:world` to reproduce it; the Admin **World** page uses the same scenarios.

## Product boundary

- One State is a sparse 512 × 512 coordinate world designed for up to 1,024 cities.
- Empty tiles are not persisted. Only cities, resource fields, monsters, POIs, marches,
  scheduled events and reports exist as records.
- Spawn anchors are deterministic and allocated farthest-first. Early populations are sparse;
  later populations fill the gaps while preserving a minimum city distance.
- The Circle is fixed at the center. Five geographic zones become harder toward the center.
- A city can be routed, burned and relocated, but buildings and permanent progression are never destroyed.

## MVP loops

1. Spawn and discover nearby targets.
2. Dispatch actual account troops through a limited march queue.
3. Gather a resource field; reserve it on arrival; deplete and respawn it elsewhere.
4. Spend Energy to attack a monster; defeat and respawn it elsewhere.
5. Scout or attack a city; apply shield, casualties, loot, Wall damage, burning and relocation.
6. Emit arrival-time battle reports and return-time delivery reports.

## Target lifecycle

- Resource: `available → occupied → depleted → respawning → available`
- Monster: `alive → engaged → defeated → respawning → alive`
- City: `normal/shielded → breached → burning → normal` (relocate when Wall reaches zero)
- March: `outbound → gathering/fighting → returning → completed`, with recall support

## Hero compatibility (locked before hero implementation)

Every march stores a `commanderSnapshot` with two nullable hero slots, resolved passive
modifiers, version metadata and an effects array. For now the slots are null and modifiers are
zero. A later Hero system only produces this snapshot; it does not own or change world timing,
target lifecycle, troop reservation, combat reports or persistence.

## Beta, not this MVP

Real shared-server authority, alliance rallies, reinforcement/garrison, alliance territory,
facilities, resource-tile PvP, teleport items, world bosses, seasons, cross-State migration,
push notifications, free-path movement and open-field interception.

## Headless acceptance gates

- 1,000 cities spawn without overlap or entry into the Circle reserve.
- Early players are farther apart than the final dense population.
- Nearby queries do not scan or return the whole map.
- One idempotency key cannot dispatch or reward twice.
- One resource field cannot be occupied by two marches.
- `home + marching + wounded + dead delta` conserves troops.
- Depleted/defeated targets disappear and respawn at a new legal coordinate.
- Combat resolves and reports at arrival; loot reaches inventory only on return.
- 10,000 scheduled events can be advanced deterministically in tests.
