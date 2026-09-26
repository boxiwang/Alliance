# Shop + Credits top-up — handoff notes (Claude → Codex)

Mockup: `docs/mockups/shop-flow-claude.html` (open directly in a browser, ≥1440×900).
Built on top of `city-fx-claude.html` (Codex's *Star Grid Command V3* + the City FX
layer), so City behaves exactly as described in `city-fx-claude.md`. The shop layer
lives in the CSS block starting `/* ===== Claude Shop + Top-up layer` and in
`<script id="claude-shop">` at the end of the file. **Every item, price and balance is
a placeholder** — the point is the structure and the flow.

Background decisions are in `docs/MONETIZATION.md` (money buys time / convenience /
cosmetics, never troops, Might or combat results; no gacha or paid random boxes; one
premium currency, Credits, and everything in the shop is priced in Credits).

## Entry points
- **Header Credits ＋** (`.ac2-credits`): opens the top-up dialog from any screen.
- **SHOP** — a 5th main-nav tab after MESSAGES. Inside the Shop the header Credits cell
  becomes the wallet (owner request: no second balance on the page): wider cell, lit
  violet, larger number, a one-off sheen, and the ＋ turns into **＋ TOP UP**. Leaving the
  Shop restores the normal header.

## Shop page
Left rail: four tabs; main area: card grid.

| Tab | Placeholder contents |
|---|---|
| DAILY | Free Daily Supply Crate (fixed contents, claim once/day, tab badge until claimed); 50%-off daily deal; small energy deal; reset countdown to 00:00 UTC |
| PACKS | Starter Pack (one-time), Monthly Card (◇100/day × 30), Alliance Gift Pack (every member gets a crate), Season Pass (PLANNED, disabled) |
| ITEMS | Universal speedups, Production Boost +25% 24h, Second Build Queue 7d, Resource Reserve, Energy Cell, Peace Shield (KEEP 10+), Drift Jump, Rename Signal |
| COSMETICS | Core, Halo, Orbit, Name signature, March signature |

Buying: confirm dialog shows price and balance after. **Not enough Credits** → "you need
◇ N more" → TOP UP opens the top-up with the smallest pack that covers the shortfall
preselected → after success, **CONTINUE** returns to that same item's purchase.

## Top-up flow (5 steps)
1. **Pack** — 6 tiers $0.99–$99.99 with bonus Credits; the first purchase of each tier
   doubles its base Credits ("1ST ×2"). Footer link *Paid but no Credits?* lets the player
   paste a tx hash to re-check (each transaction credits once).
2. **Pay with** — connected wallet (smart wallet), per-token balances; rails:
   USDG / USDC on Robinhood Chain, USDC on Base, USDT on BNB Chain; "any chain / ETH via
   router" shown as coming soon. Insufficient balances are disabled. Summary: you pay,
   network fee (paid by the player), recipient = Alliance Treasury (Safe), you get.
3. **Wallet** — network-switch step if the rail's chain differs from the wallet's; then
   the exact transfer request to verify (never an unlimited approval). Demo buttons
   simulate approve / reject; reject → "nothing was charged" + retry.
4. **On-chain check** — ticks mirror the server verification: tx found → official token
   contract → recipient = treasury → amount ≥ price and sent from the player's wallet →
   confirmations 2/2 → Credits added. The dialog can be closed; Credits still arrive
   (toast), matching the server-side backstop scanner.
5. **Done** — +Credits, order id, tx link, new balance; header balance counts up.

Footer everywhere: Credits are in-game only, non-refundable, non-transferable, cannot be
withdrawn (keeps us out of money-transmission territory).

## Server design this flow assumes (not built)
- `POST` create order → server fixes chain, token, exact amount (from the SKU, never the
  client), treasury address, expiry.
- Player signs an ERC-20 `transfer` to the treasury (Safe multisig; **no private key on
  the server** — the worker only reads chain data).
- Client submits the tx hash; the worker reads the receipt and checks: status success,
  token contract on the per-chain allowlist, `Transfer` to the treasury, `from` = the
  player's login wallet, amount ≥ order amount, N confirmations. Then in one D1
  transaction: mark `(chainId, txHash, logIndex)` used (unique), add Credits, write the
  ledger row.
- Use the token `Transfer` log, not `tx.from` — smart-contract wallets (the owner's
  Uniswap wallet is one) are sent by a bundler.
- Per-token decimals: USDT on BNB Chain has 18 decimals, USDC usually 6.
- A scheduled scan of treasury inflows credits payments whose tab was closed.
- Sanctions screening on the paying wallet before crediting.

## Porting notes
- Hook points in the real app: header Credits in `GameNav`, a Shop view next to
  Alliance / City / Star Map / Messages, item effects through the existing shared
  catalog `src/lib/mvp-items.ts` + server inventory.
- Nothing here should ship as a placeholder: prices, packs and rails come from config;
  balances and ownership from server state.
