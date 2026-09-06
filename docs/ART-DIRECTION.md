# RUGLANDS — Art direction handoff

**Status:** exploration only; no concept image below is implemented in the game yet.

## Current direction

Medieval has been rejected. The leading direction is **Degen Freeport**: a prosperous, dangerous
and eccentric Crypto free-trade city built around the player's wallet. It keeps the current
Cash/Oil/Power economy and Army/Navy/Air functions legible without becoming a generic realistic
military base or neon-cyberpunk cliché.

The current preferred exploration is **V3 chibi 2.5D**:

- fixed oblique isometric camera and desktop SLG interface;
- central Exchange as `building.keep`, surrounded by functional city buildings;
- chunky, vertically exaggerated buildings with 2–3 unmistakable motifs each;
- toy-diorama proportions, hand-painted low-poly materials and readable silhouettes;
- industrial/military capability balanced with markets, citizens and civic life;
- dark navy, brass, sand and teal foundation; acid-lime and restrained violet accents;
- Crypto expressed through wallet identity, syndicates, public wealth, market culture and meme
  humor—not Bitcoin logos, candlestick wallpaper or blockchain hexagons.

Do not copy Kingshot assets or UI. It is a reference for camera readability, approachable scale
and city liveliness only. RUGLANDS architecture, color system and interface must remain original.

## Concept progression

| Version | Purpose | Preview |
|---|---|---|
| V1 | Establish industrial Degen Freeport and SLG information architecture | [`degen-freeport-ui-v1.png`](art/concepts/degen-freeport-ui-v1.png) |
| V2 | Replace default masculine identity/skull language with NFT identity, Alliance crest, civic life and a warmer city | [`degen-freeport-ui-v2.png`](art/concepts/degen-freeport-ui-v2.png) |
| V3 | Convert V2 to a chunky, readable chibi 2.5D toy-diorama style | [`degen-freeport-ui-v3-chibi.png`](art/concepts/degen-freeport-ui-v3-chibi.png) |

V3 should be treated as a mood/composition target, not a literal final screen. A real desktop build
should reduce the NPC count by roughly 20%, simplify the two side rails and protect large clickable
building footprints.

## Audience guardrail

Available benchmarks show a male-leaning but not male-only audience: Google/Ipsos reported a
six-market mobile 4X average of 63% male / 37% female; Sensor Tower reported Japan at 60/40 for
Whiteout Survival, 70/30 for Kingshot and about 75/25 for Last War in its leading markets.

Product implication: keep hardcore strategy and combat, but do not unnecessarily narrow the
audience through default armed-male identity, skull-heavy navigation or an all-military city.
Target a gender-neutral surface over hardcore mechanics—without pink coding or turning the game
into a cozy farm.

References:

- [Google/Ipsos — 4X SLG gamer study](https://www.ipsos.com/sites/default/files/ct/news/documents/2022-09/Enhance%20your%204X%20SLG%20Gamers%E2%80%99%20Immersiveness.pdf)
- [Sensor Tower — Kingshot and Whiteout Survival audience](https://sensortower.com/ja/blog/kingshot-and-whiteout-survival-JP)
- [Sensor Tower — Last War audience](https://sensortower.com/ja/blog/last-war-survival-JP)

## No-artist production plan

Use an asset-driven pipeline rather than a conventional concept-art/modeling team:

1. Start from one coherent CC0 or inexpensive low-poly kit; do not mix unrelated finished sprites.
2. Kitbash the 14 building Keys in Blender using a single palette, material library, camera and light rig.
3. Create only four visual stages per building: Lv.1–9, Lv.10–19, Lv.20–29 and Lv.30.
4. Batch-render transparent WebP/PNG sprites, shadows and selection masks from the fixed camera.
5. Render the city with Phaser; keep HUD, panels and scalable 9-slice frames in HTML/CSS/SVG.
6. Use AI for concepting, portraits, banners, decals and paint-over guidance—not for separately
   generating every building level or animation frame, where visual consistency will drift.
7. Create 8–12 reusable ambient loops (smoke, flags, lights, cranes, vehicles and citizens) before
   adding more unique geometry. Motion supplies much of the perceived production value.

Useful commercially permissive starting libraries:

- [Quaternius Medieval Village Pack](https://quaternius.com/packs/medievalvillage.html) — CC0 modular base pieces; re-theme them heavily.
- [Kenney assets](https://kenney.nl/assets) — CC0 props/UI foundations.
- [Poly Haven](https://polyhaven.com/license) — CC0 textures, HDRIs and selected models.

Expected first-pass asset spend: **$0–120**. Expected solo implementation time after direction lock:
**3–5 working days for a vertical slice**, then roughly **3–5 weeks for the complete in-city visual
replacement**. Validate the vertical slice before producing all buildings.

## NFT wallet avatar — proposed, not implemented

An NFT can be selected as the player's profile portrait. Robinhood Chain uses Blockscout, whose V2
API supports owned NFT lookup:

```text
GET /api/v2/addresses/{wallet}/nft?type=ERC-721,ERC-1155
```

MVP flow:

1. Fetch once when the avatar picker opens, not on every render.
2. Let the player select an NFT, then store `chainId + contract + tokenId` in the profile.
3. Cache the result for 24 hours and revalidate ownership on a new session or avatar change.
4. If sold, remove the verified-holder badge and fall back to the wallet identicon or chosen policy.
5. Normalize IPFS/Arweave URLs and proxy images later; reject unsafe HTML, sanitize SVG and handle
   broken/spam metadata.

Robinhood-only discovery is nearly free using the explorer integration already in the repo, but may
return few avatars. Ethereum/Base/Arbitrum discovery should be a later multi-chain indexing decision,
not silently added to the first implementation.

References:

- [Robinhood Chain connection/explorer documentation](https://docs.robinhood.com/chain/connecting/)
- [Blockscout API v2 specification](https://github.com/blockscout/blockscout-api-v2-swagger/blob/main/swagger.yaml)
- [ERC-721 metadata standard](https://eips.ethereum.org/EIPS/eip-721)
- [ERC-1155 metadata standard](https://eips.ethereum.org/EIPS/eip-1155)

## Next visual deliverable

Do **one real in-engine vertical slice**, not another full static concept:

- Exchange/Townhall;
- Army Camp;
- Bank;
- terrain, road and coast treatment;
- one NFT/identicon player portrait;
- top resources/Might HUD;
- selected-building panel;
- smoke, flag and citizen loops.

Approval criteria: the three buildings are identifiable at a glance, the world remains the focus,
all controls are usable at desktop resolution, and the same production recipe can scale to the
remaining 11 building Keys without hand-painting every level.
