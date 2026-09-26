import { useEffect, useMemo, useState } from "react";
import type { Profile } from "./lib/profile";
import { capacity, mightBreakdown, prodPerHour, project, totalTroops, worldMarchSlots } from "./lib/game";
import { initGame, loadGame } from "./lib/gamestore";
import { energyAt } from "./lib/world-engine";
import { loadLocalWorldSession } from "./lib/world-adapter";
import { loadPlayerAccount, savePlayerAccount } from "./lib/player-account";
import { hasLocalGm } from "./lib/gm";
import {
  claimDailySupply, grantGmCredits, loadShopAccount, purchaseShopOffer,
  type ShopAccount,
} from "./lib/backend";
import { SHOP_OFFERS, TOPUP_PACKS, shopItem, type ShopCategory, type ShopOffer } from "./lib/shop-catalog";
import { speedupIconPath } from "./lib/mvp-items";
import GameNav from "./GameNav";
import CosmicBackdrop from "./CosmicBackdrop";
import MiniComms from "./MiniComms";

type Dialog = { kind: "buy"; offer: ShopOffer } | { kind: "topup"; selected: string } | null;

const TAB_COPY: Record<ShopCategory, { label: string; sub: string }> = {
  daily: { label: "DAILY", sub: "RESET · 00:00 UTC" },
  speedups: { label: "SPEEDUPS", sub: "BUILD · RESEARCH · TRAIN · HEAL" },
  cosmetics: { label: "COSMETICS", sub: "CORE · HALO · FLEET · NAME" },
};

function until(resetAt: number): string {
  const seconds = Math.max(0, Math.floor((resetAt - Date.now()) / 1000));
  return `${String(Math.floor(seconds / 3600)).padStart(2, "0")}:${String(Math.floor(seconds % 3600 / 60)).padStart(2, "0")}:${String(seconds % 60).padStart(2, "0")}`;
}

export default function Shop({ address, profile, onAlliance, onCity, onWorld, onMessages, onProfile }: {
  address: string;
  profile: Profile;
  onAlliance: () => void;
  onCity: () => void;
  onWorld: () => void;
  onMessages: () => void;
  onProfile: () => void;
}) {
  const [tab, setTab] = useState<ShopCategory>("daily");
  const [account, setAccount] = useState<ShopAccount | null>(null);
  const [dialog, setDialog] = useState<Dialog>(null);
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const [, tick] = useState(0);
  const gm = hasLocalGm(address);
  const now = Date.now();
  const game = project(loadGame(address) || initGame(address), now);
  const world = loadLocalWorldSession(address);
  const player = world?.world.players[world.playerId];
  const city = player ? world?.world.entities[player.cityId] : null;
  const energy = player ? energyAt(player, now, world!.world.config) : 100;
  const activeFleets = player ? Object.values(world!.world.marches).filter((march) => march.playerId === player.id && !["completed", "failed"].includes(march.state)).length : 0;
  const location = city?.kind === "city" ? `SECTOR ${world!.world.stateId.slice(-6).toUpperCase()} · HOME ${Math.round(city.position.x).toString().padStart(3, "0")}:${Math.round(city.position.y).toString().padStart(3, "0")}` : "FRONTIER I";
  const balance = account?.balance ?? loadPlayerAccount(address).credits;

  function syncCredits(value: number) {
    const local = loadPlayerAccount(address);
    savePlayerAccount({ ...local, credits: value });
  }

  async function refresh() {
    try {
      const next = await loadShopAccount(address);
      setAccount(next);
      syncCredits(next.balance);
    } catch {
      setNotice("SHOP LINK UNAVAILABLE");
    }
  }

  useEffect(() => { void refresh(); }, [address]);
  useEffect(() => {
    const timer = window.setInterval(() => tick((value) => value + 1), 1000);
    return () => window.clearInterval(timer);
  }, []);

  const offers = useMemo(() => SHOP_OFFERS.filter((offer) => offer.category === tab), [tab]);

  async function buy(offer: ShopOffer) {
    if (busy || offer.status !== "active") return;
    if (balance < offer.price) {
      const pack = TOPUP_PACKS.find((entry) => entry.credits >= offer.price - balance) || TOPUP_PACKS[TOPUP_PACKS.length - 1];
      setDialog({ kind: "topup", selected: pack.id });
      return;
    }
    setBusy(true);
    try {
      const result = await purchaseShopOffer(address, offer.id, `purchase:${crypto.randomUUID()}`);
      setAccount((current) => current ? { ...current, balance: result.balance } : current);
      syncCredits(result.balance);
      setDialog(null);
      setNotice(`${offer.name.toUpperCase()} SENT TO WAREHOUSE`);
    } catch (error) {
      if (error instanceof Error && error.message === "insufficient_credits") setDialog({ kind: "topup", selected: TOPUP_PACKS[0].id });
      else setNotice("PURCHASE FAILED · TRY AGAIN");
    } finally {
      setBusy(false);
    }
  }

  async function claimDaily() {
    if (busy || account?.dailyClaimed) return;
    setBusy(true);
    try {
      await claimDailySupply(address);
      setAccount((current) => current ? { ...current, dailyClaimed: true } : current);
      setNotice("DAILY SUPPLY SENT TO WAREHOUSE");
    } catch (error) {
      setNotice(error instanceof Error && error.message === "already_claimed" ? "DAILY SUPPLY ALREADY CLAIMED" : "CLAIM FAILED · TRY AGAIN");
    } finally { setBusy(false); }
  }

  async function fillGmCredits() {
    setBusy(true);
    try {
      const result = await grantGmCredits(address);
      setAccount((current) => current ? { ...current, balance: result.balance } : current);
      syncCredits(result.balance);
      setNotice("GM CREDITS ADDED");
    } catch { setNotice("GM CREDIT GRANT FAILED"); }
    finally { setBusy(false); }
  }

  return <section className="shop-page">
    <CosmicBackdrop address={address} />
    <GameNav view="shop" profile={profile} townhallLevel={game.buildings.keep.lvl} location={location}
      resources={game.res} incomePerHour={prodPerHour(game)} resourceCap={capacity(game)} energy={energy} energyCap={world?.world.config.energyCap ?? 100}
      activeFleets={activeFleets} fleetCap={player?.marchSlots ?? worldMarchSlots(game)} standing={totalTroops(game)} wounded={game.wounded}
      might={mightBreakdown(game).total} credits={balance} onAlliance={onAlliance} onCity={onCity} onWorld={onWorld} onMessages={onMessages}
      onShop={() => {}} onCredits={() => setDialog({ kind: "topup", selected: TOPUP_PACKS[2].id })} onProfile={onProfile} />

    {gm && <div className="shop-gm"><span>GM · COMMERCE</span><button type="button" disabled={busy} onClick={() => void fillGmCredits()}>ADD 25,000 CREDITS</button></div>}
    {notice && <button type="button" className="shop-toast" onClick={() => setNotice("")}>{notice}</button>}

    <main className="shop-shell">
      <aside className="shop-rail">
        <header><span>◇</span><b>SHOP</b></header>
        {(Object.keys(TAB_COPY) as ShopCategory[]).map((key) => <button type="button" key={key} className={tab === key ? "active" : ""} onClick={() => setTab(key)}>
          {TAB_COPY[key].label}{key === "daily" && !account?.dailyClaimed ? <i>1</i> : null}
        </button>)}
        <footer>ACCOUNT-BOUND CREDITS</footer>
      </aside>
      <section className="shop-stock">
        <header><div><small>CATALOG</small><h1>{TAB_COPY[tab].label}</h1><p>{TAB_COPY[tab].sub}</p></div>{tab === "daily" && account ? <time>RESET {until(account.resetAt)}</time> : null}</header>
        <div className="shop-grid">
          {tab === "daily" && <article className="shop-card daily">
            <div className="shop-card-art"><span>◇</span><i /><i /></div>
            <small>DAILY SIGNAL</small><h2>Supply Crate</h2><p>2 × 5M Universal</p>
            <button type="button" className="free" disabled={busy || account?.dailyClaimed} onClick={() => void claimDaily()}>{account?.dailyClaimed ? `CLAIMED · ${account ? until(account.resetAt) : ""}` : "CLAIM FREE"}</button>
          </article>}
          {offers.map((offer) => {
            const item = shopItem(offer);
            return <article className={`shop-card${offer.status === "planned" ? " planned" : ""}`} key={offer.id}>
              <div className="shop-card-art">{item ? <img src={speedupIconPath(item)} alt="" /> : <span>{offer.tag === "VAULT" ? "✦" : "◇"}</span>}</div>
              <small>{item?.rarity.toUpperCase() || offer.tag || "COMING"}</small><h2>{offer.name}</h2><p>{offer.description}</p>
              <button type="button" disabled={offer.status !== "active" || busy} onClick={() => setDialog({ kind: "buy", offer })}>{offer.status === "active" ? `◇ ${offer.price.toLocaleString()}` : "PLANNED"}</button>
            </article>;
          })}
        </div>
      </section>
    </main>

    <MiniComms address={address} profile={profile} onOpenMessages={onMessages} />

    {dialog && <div className="shop-overlay" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setDialog(null); }}>
      {dialog.kind === "buy" ? <section className="shop-dialog small" role="dialog" aria-modal="true">
        <header><b>{dialog.offer.name}</b><button type="button" onClick={() => setDialog(null)}>×</button></header>
        <p>{dialog.offer.description}</p>
        <div className="shop-confirm-ledger"><span><small>PRICE</small><b>◇ {dialog.offer.price.toLocaleString()}</b></span><span><small>AFTER</small><b>◇ {Math.max(0, balance - dialog.offer.price).toLocaleString()}</b></span></div>
        <footer><button type="button" onClick={() => setDialog(null)}>CANCEL</button><button type="button" className="primary" disabled={busy} onClick={() => void buy(dialog.offer)}>{balance < dialog.offer.price ? "TOP UP" : "CONFIRM"}</button></footer>
      </section> : <TopupDialog account={account} selected={dialog.selected} onSelect={(selected) => setDialog({ kind: "topup", selected })} onClose={() => setDialog(null)} />}
    </div>}
  </section>;
}

function TopupDialog({ account, selected, onSelect, onClose }: { account: ShopAccount | null; selected: string; onSelect: (id: string) => void; onClose: () => void }) {
  const pack = TOPUP_PACKS.find((entry) => entry.id === selected) || TOPUP_PACKS[0];
  const ready = !!account?.paymentRails.length;
  return <section className="shop-dialog topup" role="dialog" aria-modal="true">
    <header><b>TOP UP CREDITS</b><button type="button" onClick={onClose}>×</button></header>
    <div className="shop-dialog-steps"><b>1 · PACK</b><span>2 · PAY WITH</span><span>3 · WALLET</span><span>4 · ON-CHAIN CHECK</span></div>
    <div className="shop-pack-grid">{TOPUP_PACKS.map((entry) => <button type="button" className={entry.id === pack.id ? "active" : ""} key={entry.id} onClick={() => onSelect(entry.id)}><span>◇</span><b>{entry.credits.toLocaleString()}</b><small>${(entry.usdCents / 100).toFixed(2)}</small></button>)}</div>
    <div className={`shop-payment-state${ready ? " ready" : ""}`}><i />{ready ? <><b>PAYMENT RAIL DETECTED</b><span>Wallet transfer opens after the receipt verifier is deployed.</span></> : <><b>CHECKOUT NOT ARMED</b><span>No treasury or official stablecoin rail is configured. Credits cannot be minted from a browser-only payment.</span></>}</div>
    <footer><p>Credits stay in game. They cannot be transferred or withdrawn.</p><button type="button" disabled>CONTINUE · ${(pack.usdCents / 100).toFixed(2)}</button></footer>
  </section>;
}
