# ALLIANCE — Product Decision Summary (canonical)

> **Authoritative product direction (owner-written, 2026-09-09).** This is the north star for
> what to build and in what order. When a feature is proposed, check it against the core loop and
> the priority stack below. Pairs with `docs/DIRECTION.md` (why) and `STATUS.md`/`HANDOFF.md` (where).

## One-line definition
**ALLIANCE is a text- and minimal-visual-driven persistent social SLG: AI makes the universe change,
crypto owns the assets that matter, and alliance politics + the player economy drive long-term retention.**

Do NOT build it as "a generic SLG + Token + NFT store." The real differentiation is four things:
1. An AI universe that changes and remembers players.
2. Real production/consumption relationships between players.
3. Social ties via Alliance, Comms, Rally.
4. A civilization identity worth leaving a history of and showing off.

## The core loop (the test for every feature)
```
Log in → read Captain's Log → pick 2 of 3 Daily Signals → handle Rogue / Cosmo Anomaly / gather
→ get materials → craft/upgrade/fill market orders or contribute to the alliance
→ show results on map / Comms / battle reports → schedule new build/research/train/expedition
→ log off, universe keeps changing
```
**Rule:** does the new feature strengthen this loop? If not, it goes to backlog.

## Priority stack

### P0 — become a real multiplayer game (biggest current gap)
Server-authoritative state (replace browser-local authority); production wallet auth incl. smart
wallets; shared Star Map with real players; atomic resource locks + idempotency + server time;
Alliance create/join/roles/member management; real Alliance/Cosmos/DM chat; a basic Rally / shared
alliance objective; analytics + GM tools + backup/restore; basic anti-cheat + chat moderation.
> The game is called ALLIANCE but the alliance core loop is not actually built yet.

### P1 — build the retention loop
Captain's Log; Daily Signal Board (pick 2 of 3); one full Cosmo Anomaly system; Cosmic Codex; richer
battle reports; mobile/PWA; three high-quality procedural planet skins.
First Cosmo events (only three): moving Black Hole; cross-universe Echo Rogue; Distress-Signal choice event.
> AI only owns names, narrative, dialogue, personalization. Rules/combat/rewards/rarity are
> deterministic on the server.

### P2 — economy & monetization
Inventory; Warp Reserve / speedups; ~3 high-tier materials; Relic Modules; player purchase (work)
orders; internal Credits market; cosmetic store; Season Pass; shields/Warp/limited convenience.

### P3 — only after validation
Commander/Hero system; on-chain marketplace; USDG settlement; rare-item NFTs; multi-chain; token;
DAO; staked realm launches / Realm Operator.

## Retention design
| Cadence | Content |
|---|---|
| Every login | Captain's Log + one signal to decide |
| Daily | pick-2-of-3, limited Overdrive, dispatch |
| Every 2–3 days | one Cosmo event chain |
| Weekly | world anomaly, alliance op, boss, purchase orders |
| Seasonal | Wormhole, server history, permanent memorial |

Rules: no "miss a day, lose everything"; missed content → Rested Bonus / make-up; black holes never
destroy offline players without warning; dangerous events show path + countdown in advance; every
battle gives at least deterministic progress (not pure RNG drops); click-to-farm is only a limited
Overdrive, never an infinite source of tradable materials.

## Economy (most important decisions)

### Resource tiers
- **Cash/Oil/Power** — city build, research, train, heal.
- **World Energy** — map actions & anomaly events.
- **Warp Reserve** — remove build/research/train/heal time.
- **Scrap / Relic Dust** — craft & upgrade.
- **Cipher** — reforge & commander skills.
- **Anomaly Matter** — legendary modules, alliance engineering, historical cosmetics.
- **Credits** — cosmetics, speedups, shields, warp, convenience.

### High-tier material sources (server-wide new supply)
40–45% high-level Rogue & Expedition · 25–30% Cosmo Anomaly · 15–20% alliance ops & world boss ·
~10% season milestones & first-time achievements · daily tasks ≈ zero (daily gives Energy / Deep
Scan charges / access to high-tier content, not the materials themselves).

### Drains
Build/research/train/heal; relic craft/fuse/upgrade/reforge; commander promotion; alliance
facilities & world engineering; warp/shield/logistics; seasonal historical cosmetics; market fees.
Good drains feel like building or choosing, not paying tax → prefer crafting, alliance engineering,
fusion, customization; use durability / inventory rent / expiry sparingly.

## Market = Work Orders, not Sell Listings
```
Spender posts a purchase order → Farmer sees explicit demand → produces at the named content
→ delivers to the order → buyer crafts/upgrades → materials consumed → new demand appears
```
Notes: marketplace is a transfer, not a faucet; the store must not sell unlimited tradable materials
players are producing; speedups must not accelerate tradable-material production; official high-tier
material boxes directly hurt Farmers; validate demand on an internal server market first; **do not
connect real value until browser-local state is migrated to the server.**

## Hero & equipment
Don't build a traditional hero-army for the sake of drains. The engine already reserves two hero
slots: **Primary Commander** (combat Doctrine) + **Specialist** (gather/scout/heal/transport). Ship
**at most six Commanders**, promoted with a universal `Memory Core` (no dozens of hero-specific
shards). Equipment = one layer only: **Core / Drive / Lens**. Do NOT ship hero gear + six slots +
gems + runes + exclusive shards + random affixes + sets + gear reforge at once — that's the SLG
content pit.

## Where crypto belongs
Crypto handles: rare-item ownership; historical relics; high-tier cosmetics; player-to-player
settlement; Alliance Treasury; verifiable server & season history.
Crypto does NOT handle: every battle; ordinary resources; build queues; training; high-frequency
durability; daily rewards; real-time game state.
On-chain stores stable info + ownership; levels/durability/gear-state/kills/usage live on the game
server, with major events checkpointed. Wallet tasks must be optional, low-frequency, cosmetic-first.
Don't require daily swaps; don't grant combat/build advantage from token holdings or trade counts.
> Change the current draft's "hold 3 tokens → Build Slot" and "trade count → lots of Gems" into
> Titles, Glyphs, Halos, or memorial badges.

## Cosmetics
Minimal-game cosmetics are about civilization identity, not character art:
```
Planet Body + Surface Pattern + Halo + Glyph + Trail + Colorway + Title
```
Must appear in public, high-frequency places: Star Map, Comms nameplate, Rally Card, Battle Report,
War Passport, Alliance page. Premium skins can use WebGL shaders (glowing cracks, energy flow,
orbiting rings, particle trails, gravity warp, accretion disk, surface that evolves with record).
LOD: zoomed-out = simple outline+halo; selected = full shader; profile/report = max quality. A
player's black-hole skin must be clearly distinct from the dangerous black-hole event and must not
change map hitbox or occlude other players.

## Explicitly DO NOT do (before real retention exists)
No token; no DAO; no multi-chain; no paid random high-tier boxes; no full hero-army; no gem/gear
nesting; no Map II; no multi-operator economy; no letting token price/balance/trade-count affect
combat; no more wholesale visual-direction redos; **don't treat commit count as market progress.**

## Acceptance criteria for the next phase
Not just "feature done" — also: do new players understand the first-hour goal; can they build/gather/
Rogue without guidance; do they join an alliance on their own; do they self-organize in Comms; do
they come back for events/queues/orders; will they pay for pure cosmetics/convenience; is there
retention with zero token rewards.
**Playtest gate (after real multiplayer): invite ≥50 non-friends → 25 finish day-1 loop, 10 return
on day 7, 5 join an alliance activity, 3 pay for a cosmetic/convenience.** If not met, fix the core
loop first — do not add heroes/NFT/DAO.

## Five principles to keep
1. **Game first; crypto only where ownership is truly needed.**
2. **AI is the World Director, not the referee of combat and economy.**
3. **The market is driven by real player demand; the official side must not compete with Farmers.**
4. **Cosmetic value comes from public display, history and scarce sourcing — not art complexity.**
5. **The biggest challenge is not whether Codex can build it, but whether we can stop expanding scope
   and put the product in front of real players.**
