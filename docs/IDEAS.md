# Ideas — parking lot (NOT P0)

> Spontaneous "just thought of it" ideas live here so we don't lose them. **None of
> this is P0.** Nothing on this page gets built until the hard/core requirements are
> done — see the priority stack in [`docs/PRODUCT.md`](PRODUCT.md) (server-authoritative
> multiplayer, real Alliance system, real chat, etc.). This is a backlog to revisit
> *after* the must-haves ship, not a to-do list.
>
> Format per idea: what it is, why it fits, the gotchas, and roughly when it could
> slot in (P2 / P3 per PRODUCT.md).

---

## Commander Card frames — cosmetic 名片框

**Idea (owner, 2026-09-28):** the card other players see when they tap your planet on the
Star Map gets a customizable background and frame, sold as a cosmetic (like planet skins
and Name Signals).

**Hook already in place** — `WorldAnchor` renders `.commander-card[data-frame]`; the card's
surface and edge are CSS variables (`--card-surface`, `--card-edge`). A frame item only
needs to set `cosmetics.cardFrame` on presence and add one `[data-frame="…"]` style block.

**Gotchas** — must stay readable over any map background; animated frames respect Reduced
Motion; the frame is identity only (no stats), same as other cosmetics.

**When** — with the next cosmetics drop (P2).

---

## Warp Arrival signatures — cosmetic 跃迁到达特效

**Idea (owner, 2026-09-29):** how your city appears at its new coordinate after a warp, sold
as a cosmetic (like Strike Signatures). Everyone keeps the basic arrival (flash + two rings,
`src/WorldArrivalLayer.tsx`). Four premium designs are kept, playable in
[`docs/cosmetics/warp-arrivals.html`](cosmetics/warp-arrivals.html):

| | Name | Look |
|---|---|---|
| A | Wormhole Fold 虫洞折叠 | violet vortex opens, the city spins out, the hole snaps shut with a flash (2.1 s) |
| B | Hyperspace Drop 超光速降落 | stars stretch into light, the city streaks in and brakes with a shock ring (1.75 s) |
| C | Phase Assembly 相位重组 | hex lock-on, particles stream in, a scan line prints the city (2.3 s) |
| D | Singularity Bloom 奇点绽放 | matter falls into a pinpoint, nova + lens cross, the city is born out of the light (2.0 s) |

**Hook already in place** — each design is one pure 2D-canvas draw function `(ctx, x, y,
radius, elapsed)`, the same shape as `drawWarpArrival`; an owned signature swaps the draw
function in `WorldArrivalLayer`.

**Gotchas** — decide whether other players see your arrival (location privacy: only if they
can already see your city); respect Reduced Motion; keep it under ~2.5 s so the map is usable.

**When** — with the next cosmetics drop (P2).

---

## Meme-token bounty — "Warrants" (escrow) 悬赏令

**Idea (owner, 2026-09-11):** an alliance can post a bounty on a target and lock the
payment as tokens in a smart contract; whoever fulfills the contract gets the tokens.

**What it is**
1. An alliance (or player) posts a **Warrant** on an in-game target and locks tokens in
   an escrow contract.
2. A hunter achieves a **qualifying defeat** of the target.
3. The **server signs a kill-proof**; the contract releases the escrow to the hunter
   (minus a fee to the protocol / alliance treasury).
4. If unclaimed by the deadline, the escrow **refunds** to the poster.

**Why it fits** — lands squarely on PRODUCT.md's sanctioned crypto uses: player-to-player
settlement + Alliance Treasury + verifiable events checkpointed on-chain. Ties together
Alliance, war, treasury and battle reports. Extremely on-theme for a memecoin-war game
(put a bounty on the alliance that rugged you).

**The one hard technical piece — oracle.** The chain can't see the game (we're
server-authoritative), so the server must **attest (sign) the defeat event** and the
contract releases against that signature. Battle reports are the natural attestation
source.

**Gotchas that decide success**
- **Collusion / self-farming** (biggest): target + hunter collude to split the pot. Needs
  anti-collusion — can't bounty yourself/alliance-mates, combat thresholds, cooldowns,
  no repeat-claims by the same hunter.
- **No real-world targeting.** Target is an in-game entity (city / faction), never a real
  identity. No doxxing; keep language and mechanics strictly in-game so it never reads as
  real-world harassment/threat.
- **Never reward power (P2W red line).** Payout is tokens/settlement, not a stronger army.
  Winning the fight must never be buyable.
- **Offline protection.** PRODUCT.md forbids destroying offline/shielded players without
  warning — only legitimately attackable targets can be claimed.
- **Escrow hygiene:** expiry-refund, cancel rules, fee, anti-sybil / anti-spam bounties.

**Sequencing**
- Prototype the loop first with the **internal soft currency (Credits)** — it's already
  fun without real money and validates the social/war loop.
- Real **on-chain token escrow is P3** — only after server-authoritative state + review
  (PRODUCT.md: don't connect real value until browser-local state is migrated to server).

**Open questions**
- Target = single city/player, or a whole alliance? (alliance-level = more political,
  harder to collude)
- Payout to the individual hunter (mercenary economy) or split across the contributing
  alliance (collective war)?
