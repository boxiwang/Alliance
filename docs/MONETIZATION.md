# Monetization — proposal (v0.1, not built)

> Status: **proposal only.** No paid items are implemented; the World/city engines leave `Credits`
> and a `Warp Engine` consumable as hooks. This doc is for discussion, not a spec. No mockups yet.

## Principles (must not break the pillars)
- **F2P stays whole.** The locked target — a free player reaches Command Core 30 in ~4–5 months and
  the F2P slow-lane always advances — is sacred. Money buys **time, convenience, cosmetics, and
  stakes-neutral boosts**, never raw military power or permanent advantage.
- **No pay-to-win that kills retention.** We do not sell troops, Might, or combat outcomes directly.
  Payers progress *faster* and look *cooler*; they do not make F2P players unable to compete or cause
  permanent loss (PvP is already non-destructive).
- **Non-custodial & safe.** The game never moves a player's funds. Purchases go through the platform's
  normal checkout (app store / on-chain checkout the user signs themselves). No lootboxes / gambling
  (trust + regulatory). Prices shown honestly; no dark patterns.
- **Target to turn on:** ~750 DAU is roughly where infra crosses the free tier — that's also a sane
  point to switch monetization on. Build the hooks now, price/tune after there's a live economy.

## Hard currency
- **Credits** (already in the nav): the single premium currency. Bought with money (or later, our token).
  Everything paid is priced in Credits so we can run sales/bundles without touching item logic.

## Item categories (ranked by fit)

**1. Time & convenience — the backbone (safest, biggest revenue in SLGs)**
- Build/research/training/healing **speedups** (minutes → instant), sold as timed items or Credits.
- **Extra build queue** / **extra march (fleet) slot** — permanent QoL unlocks. (Cap so it can't dwarf F2P.)
- **Auto-collect / longer offline window**, resource-production boosts (e.g. +25% for 24h).
- These map cleanly onto the existing Operations Queue + offline systems.

**2. Shields & logistics (stakes-neutral)**
- **Peace shields** (8h / 24h / 3d) — buy protection, not power. Anti-bully guardrail already fits.
- **Warp Engine** (already a Key): relocate your civilization to a legal coordinate — sold as a
  consumable. Convenience/positioning, not power.

**3. Cosmetics & identity — high margin, zero balance impact (lean in, it's a meme game)**
- **Civilization skins / city themes**, march-trail & fleet FX, name/tag flair, chat badges.
- **On-chain identity flex:** NFT-avatar frames, verified-holder cosmetic borders tied to the
  memecoin faction. Pure vanity; strong fit with wallet=identity + meme-war culture.
- **Alliance cosmetics:** banner, sigil, chat color — bought by officers, worn by the whole alliance.

**4. VIP / subscription — steady recurring revenue**
- Monthly VIP: a daily Credit stipend + QoL (queue slot, faster collect, extra daily scouts,
  chat perks). Priced so it's clearly worth it for regulars without gating F2P.

**5. Season / battle pass — pairs with the endgame treadmill**
- The Circle/Wormhole is a **seniority cohort season**. A **battle-pass per season** (free track +
  paid track) rewards playing the season, not paying to win it. Cosmetic + convenience rewards.

**6. Starter & value packs**
- One-time **starter pack** (great value, converts new payers), event bundles, resource packs.
  Resource packs are fine (F2P farms the same resources); keep them convenience, not exclusive power.

## On-chain-native angles (Phase-2, needs a separate economic/security review)
- **Pay in the faction memecoin** (or our own token later) for some items → a real token sink; ties
  spending to the meme-war fiction. Requires token design, custody/settlement, and legal review.
- **Alliance treasury**: members contribute (Credits/token) to fund alliance cosmetics/perks.
- Anything touching a token, faucet/sink, or paid Warp is **gated behind that review** — do not ship
  on browser-local authority.

## Explicitly avoid
- Selling troops/Might/combat wins directly. Lootboxes / gacha / gambling. Anything causing permanent
  loss for the loser. Pay-to-skip that breaks the ~4–5-month F2P curve. Predatory FOMO timers.

## Rough priority to build (when the time comes)
1. Credits + checkout + a couple of speedups + extra queue/fleet slot (proves the loop).
2. Shields + Warp Engine consumable. 3. Cosmetics/identity (recurring, safe). 4. VIP. 5. Season pass.
6. Token-native items — only after the economic/security review.
