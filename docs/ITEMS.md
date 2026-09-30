# MVP items (owner, 2026-09-29)

The catalog lives in `src/lib/mvp-items.ts` (shared by the client and the Worker). Every
effect is applied on the server: speedups by `speedup.use`, everything else below by
`item.use` (Warehouse), warp jumps by `world.warp`, the Rename Signal by `/profile/name`.
Resource amounts are internal units; the game shows them x1000.

| Warehouse tab | Item | Id | Effect | Rarity |
|---|---|---|---|---|
| Resources | 1M / 10M / 100M Cash Crate | `resource.cash.small/medium/large` | +1K / 10K / 100K Cash | common / uncommon / rare |
| Resources | 1M / 10M / 100M Oil Crate | `resource.oil.*` | +1K / 10K / 100K Oil | same |
| Resources | 1M / 10M / 100M Power Crate | `resource.power.*` | +1K / 10K / 100K Power | same |
| Resources | Stamina Cell / Stamina Pack | `energy.cell.10/50` | +10 / +50 Stamina, may go above the cap (no regen while above) | common / rare |
| Speedups | 1m–24h Speedups, 5 queues | `speedup.<queue>.<1m..24h>` | Removes time from a matching queue (auto-picked orders) | by duration |
| Boosts | Peace Shield 8h / 24h | `war.shield.8h/24h` | Shield item: can't be attacked; extends a running shield; public | rare / epic |
| Boosts | March Boost 1h / 8h | `boost.march.1h/8h` | Fleets you send travel +25% faster; stacks in time | uncommon / epic |
| Other | Drift Jump / Precision Jump | `war.relocator.random/advanced` | Warp to a random / chosen spot (Star Map → WARP) | common / epic |
| Other | Quantum Warp | `war.relocator.quantum` | Recalls every fleet home instantly, then warps to a chosen spot; works with an attack on its way, not while one is landing (5 s lock → resolved) | legendary |
| Other | Rename Signal | `identity.rename` | Rename during the free-rename cooldown (Profile) | rare |
| Other | Supply Chest | `chest.supply` | 3 weighted rewards per chest (speedups, crates, Stamina, rarely a March Boost or Peace Shield) | uncommon |
| Gear | — | — | Hero gear arrives with Heroes | — |

Not in the MVP: Relic Key (`relic.key.standard`, nothing to open yet); attack / defence
boosts arrive with PvP (P0-5).

## Rules

- Quantities: up to 99 per use (chests 20).
- World effects (shield, Stamina, March Boost) are applied after the item is paid; if the
  world refuses (e.g. the city is not on the Star Map yet) the items are given back.
- Chest loot is rolled on the server and lands in the same transaction as the chest spent.
- Active shields and March Boosts show in the nav buff bar with their countdown.
- GM: "Stock MVP items" fills every active item to 99 for testing.
