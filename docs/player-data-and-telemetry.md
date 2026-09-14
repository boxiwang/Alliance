# ALLIANCE player data and telemetry

This is the minimum data contract for the friends-and-family alpha. It separates authoritative account history from product analytics so that game rules never depend on an analytics event.

## Data principles

- The server-generated player ID is the primary key. Wallets, Google accounts and guest installations are identities attached to it.
- Wallet addresses are public game identities when linked. Do not store private keys, signatures after verification, seed phrases or complete Firebase tokens.
- Economy, combat, inventory, alliance permissions and purchases must eventually be server-authoritative. Client snapshots are recovery aids during the alpha, not proof that an action was valid.
- Do not copy message text into analytics. Chat storage and moderation logs have their own access rules and retention.
- Collect precise coordinates only for game operations that require them. Product analytics should use sector/region, not a player's exact live location.
- Every table that can identify a player needs retention and deletion rules before public launch.

## Account record — required now

| Field | Purpose |
| --- | --- |
| `player_id` | Stable internal identity used across devices and login methods |
| `auth_method` | Guest, Google or wallet |
| `wallet_address` | Linked public wallet; nullable for Web2 players |
| `identity_provider_subject` | Firebase UID, normalized wallet or guest-install ID |
| `display_name` + rename history | Global-name enforcement, moderation and rename-card audit |
| `role` / `status` | Player, GM; active, suspended, banned or deleted |
| `created_at`, `last_login_at`, `last_seen_at` | Cohorts, retention and inactive-account policy |
| `language`, `time_zone`, client version | Support, localization and release diagnosis |
| terms/privacy versions and timestamps | Consent history; never overwrite the prior acceptance |

## Authoritative inventory history — implemented for alpha

`inventory_balances` is the fast current projection and `inventory_transactions` is the append-only source of every grant and consume. Consumption requires an authenticated session, an idempotency key and a non-negative conditional balance update. GM grants are also written to the same ledger. The city applies a speedup only after the server confirms consumption.

The remaining city economy, combat outcome, alliance state and credits still originate on the client. Their events are useful alpha telemetry, but are not yet authority for purchases or trade.

## Authoritative history — required before paid/tradable economy

Keep append-only ledgers for anything that can change value or power:

- Wallet link/unlink and alliance-token verification results.
- Alliance join, leave, suspension, kick, 24-hour cooldown, R4/R5 appointment and governance votes. Ballots need secrecy: record eligibility and that a vote was cast separately from encrypted/aggregated choice data.
- Credits: purchase, grant, spend, refund and chargeback with one immutable transaction ID.
- Inventory: item mint/grant, consume, equip, unequip, trade/list/cancel/sale and ownership transfer.
- Economy: resource source/sink, speedup use, construction/research/training/healing start and completion.
- Combat: march dispatch/arrival/recall, scout, rally join, strike result, casualties, loot and battle-report ID.
- Security/moderation: login failures, suspicious session changes, reports, mutes, sanctions and GM actions.

Never represent balances as a mutable number without a ledger behind it. The current balance should be a projection that can be rebuilt from transactions.

## Alpha product events

### Session and onboarding

- `auth.login`, `auth.failed`, `session.started`, `session.ended`
- `onboarding.step_viewed`, `onboarding.step_completed`, `onboarding.completed`
- Properties: auth method, new/returning, app version, locale, device class. Do not include Firebase tokens or signatures.

### Core loop

- `city.build_started`, `city.build_completed`
- `city.research_started`, `city.research_completed`
- `city.training_started`, `city.training_completed`
- `city.healing_started`, `city.healing_completed`
- `world.scan_started`, `world.scan_completed`
- `world.march_dispatched`, `world.march_arrived`, `world.march_recalled`
- `world.gather_started`, `world.gather_completed`
- `combat.strike_started`, `combat.strike_resolved`
- Common properties: target type/level, queue slot, duration bucket, outcome, power band and region. Avoid exact enemy coordinates in analytics.

### Alliance and social

- `alliance.eligibility_checked`, `alliance.joined`, `alliance.left`, `alliance.suspended`
- `alliance.help_requested`, `alliance.help_given`
- `alliance.rally_created`, `alliance.rally_joined`
- `alliance.challenge_started`, `alliance.vote_cast`, `alliance.governance_result`
- `chat.message_sent`, `chat.dm_started`, `chat.intel_shared`, `chat.translation_used`
- Properties may contain channel type and alliance ID, but never chat body or a voter's choice.

### Cosmetics and monetization

- `vault.item_viewed`, `vault.item_equipped`, `vault.item_unequipped`
- `store.offer_viewed`, `store.checkout_started`, `store.purchase_completed`, `store.purchase_failed`
- `market.listed`, `market.cancelled`, `market.sale_completed`
- Properties: item/offer ID, rarity, displayed price, currency and acquisition source. Payment provider IDs belong in the purchase ledger, not general analytics.

### Quality

- `client.error`, `client.crash`, `network.request_failed`
- `performance.sample`: page, graphics tier, FPS band, long-frame count, device-memory band and battery mode when permission/availability allows it.
- `audio.setting_changed`, `graphics.setting_changed`, `translation.setting_changed`

## Event envelope

Every event uses the same shape:

```json
{
  "name": "world.march_dispatched",
  "version": 1,
  "clientTs": 1789344000000,
  "page": "world",
  "properties": {
    "targetType": "resource",
    "targetLevel": 3,
    "marchSlot": 1,
    "graphicsTier": "high"
  }
}
```

The backend adds `event_id`, authenticated `player_id`, `session_id` and `server_ts`. The client is never allowed to submit those authoritative fields.

## Metrics for each alpha build

- Activation: reached the city, completed first building upgrade, sent first march, joined/formed an alliance.
- Retention: D1 and D7 return rate by login method and acquisition cohort.
- Engagement: sessions/player/day, active minutes, marches/day, help given/day, chat participation and alliance participation.
- Friction: wallet/Google login failure, abandoned onboarding step, insufficient-resource blocks, disconnected realtime sessions and client errors.
- Economy health: sources versus sinks, queue idle time, speedup use, inventory creation/destruction and concentration by player percentile.
- Social health: alliance size/activity distribution, unanswered help requests, rally fill rate, DM/report rate and governance participation.

## Retention starting point for the private alpha

- Auth challenges: delete after 24 hours.
- Product events: 90 days during alpha, then aggregate or delete.
- Chat and DMs: 7 days as currently designed; moderation holds are separate and explicit.
- Account and authoritative ledgers: for the life of the account plus the legally required deletion/grace period.
- Raw diagnostic logs: 14 days unless attached to an active incident.

Before opening beyond invited testers, add an in-game data/export/delete request path and publish the exact retention periods in the privacy policy.

## MVP item catalog

The canonical catalog lives in `src/lib/mvp-items.ts` and is shared by the Worker and client. `active` means the item has a complete grant → inventory → consume → gameplay-effect path. `planned` items already have stable IDs so future rewards, offers and migrations do not invent competing names.

| Group | Active in alpha | Planned next |
| --- | --- | --- |
| Universal speedups | 5m, 1h, 3h | — |
| Specialist speedups | Construction, Research, Training and Healing in 5m/1h | — |
| Resource packs | — | Cash, Oil and Power reserves |
| Star Map energy | — | 10-energy cell |
| War utility | — | 8h shield, random and precision relocators |
| Identity and relics | — | Rename Signal, standard Relic Key |

New alpha accounts receive ten Universal 5m, two Universal 1h, and five 5m charges for each specialist queue. The authenticated GM wallet can stock every active item to 99 from the City screen.
