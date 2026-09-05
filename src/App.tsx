import { useEffect, useMemo, useState } from "react";
import type { Eip1193Provider, Eip6963ProviderDetail } from "./global";
import { subscribeProviders, resolveWallets, connect, signIn, WalletButton } from "./lib/wallet";
import { readWallet, WalletRecords } from "./lib/blockscout";
import { buildTasks, memeHoldings } from "./lib/tasks";
import { topFactions, pledgeableFrom } from "./lib/factions";
import { loadProfile, saveProfile, clearProfile, autoName, Profile } from "./lib/profile";
import { fromRaw, compact, usd, shortAddr } from "./lib/format";
import Town from "./Town";

type Stage = "connect" | "start" | "resume" | "founded" | "town";

export default function App() {
  const [detected, setDetected] = useState<Eip6963ProviderDetail[]>([]);
  const [provider, setProvider] = useState<Eip1193Provider | null>(null);
  const [address, setAddress] = useState<string>("");
  const [chainOk, setChainOk] = useState(false);
  const [walletName, setWalletName] = useState<string>("");
  const [records, setRecords] = useState<WalletRecords | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [stage, setStage] = useState<Stage>("connect");
  const [selectedCA, setSelectedCA] = useState<string | null>(null);
  const [busy, setBusy] = useState<string>("");
  const [error, setError] = useState<string>("");

  useEffect(() => subscribeProviders(setDetected), []);
  const wallets = useMemo(() => resolveWallets(detected), [detected]);

  const memes = records ? memeHoldings(records) : [];
  const pledgeable = pledgeableFrom(memes);
  const heldSymbols = new Set(memes.map((m) => (m.symbol || "").toUpperCase()));
  const iconBySym = new Map(memes.map((m) => [(m.symbol || "").toUpperCase(), m.iconUrl]));
  const board = useMemo(() => topFactions(heldSymbols, iconBySym), [records]);
  const eth = records ? fromRaw(records.coinBalanceRaw, 18) : 0;

  async function pick(w: WalletButton) {
    setError("");
    if (!w.provider) {
      if (w.install) window.open(w.install, "_blank", "noopener");
      return;
    }
    setBusy(w.key);
    try {
      const res = await connect(w.provider);
      setProvider(w.provider);
      setAddress(res.address);
      setChainOk(res.chainOk);
      setWalletName(w.name);
      const recs = await readWallet(res.address);
      setRecords(recs);
      const existing = loadProfile(res.address);
      setProfile(existing);
      setStage(existing ? "resume" : "start");
      report(recs, { wallet: w.name, chainOk: res.chainOk, stage: existing ? "resume" : "start", profile: existing });
    } catch (e: any) {
      setError(e?.message || "Couldn't connect. Try again?");
    } finally {
      setBusy("");
    }
  }

  function found() {
    if (!records) return;
    const chosen = memes.find((m) => m.address === selectedCA) || null;
    const p: Profile = {
      address,
      name: autoName(address),
      faction: chosen?.address || null,
      factionSymbol: chosen?.symbol || null,
      keepLevel: 1,
      createdAt: new Date().toISOString(),
      renamedOnce: false,
    };
    saveProfile(p);
    setProfile(p);
    setStage("founded");
    report(records, { wallet: walletName, chainOk, stage: "founded", profile: p });
  }

  function switchFaction(ca: string | null, sym: string | null) {
    if (!profile) return;
    const p = { ...profile, faction: ca, factionSymbol: sym };
    saveProfile(p);
    setProfile(p);
  }

  function resetDev() {
    if (address) clearProfile(address);
    setProfile(null);
    setSelectedCA(null);
    setStage("start");
  }

  function disconnect() {
    setProvider(null); setAddress(""); setChainOk(false);
    setRecords(null); setProfile(null); setStage("connect"); setError("");
  }

  // Backend-only telemetry (players never see this): the real connect→read→analyze result.
  function report(recs: WalletRecords, meta: any) {
    try {
      const m = memeHoldings(recs);
      const payload = {
        ts: new Date().toISOString(),
        stage: meta.stage,
        wallet: meta.wallet,
        address: recs.address,
        chainOk: meta.chainOk,
        eth: fromRaw(recs.coinBalanceRaw, 18),
        tokenCount: recs.tokens.length,
        memeCount: m.length,
        memeSymbols: m.slice(0, 24).map((t) => t.symbol),
        txCount: recs.txCount,
        tokenTransferCount: recs.tokenTransferCount,
        isContract: recs.isContract,
        profile: meta.profile || null,
        taskSignals: buildTasks(recs).map((t) => ({ title: t.title, met: t.met })),
      };
      fetch("/__report", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(payload) }).catch(() => {});
    } catch {}
  }

  return (
    <div className="page">
      <header className="topbar">
        <div className="brand">
          <span className="crest">⚔️</span>
          <div>
            <div className="bname">RUGLANDS</div>
            <div className="bsub">on-chain strategy · beta</div>
          </div>
        </div>
        {address ? (
          <div className="chips">
            <span className="chip"><i className="dot" /> {shortAddr(address)}</span>
            <button className="mini out" onClick={disconnect}>Disconnect</button>
          </div>
        ) : (
          <span className="chip lock">🔒 View-only — we can’t move your funds</span>
        )}
      </header>

      {error && <div className="banner err">{error}</div>}

      {stage === "connect" && (
        <section className="connect">
          <h1>Claim your corner of the chain</h1>
          <p className="lead">
            Build a stronghold, raid the frontier, and rally a memecoin army.
            Connect a wallet to begin — we only read it to set up your keep.
          </p>
          <div className="wgrid">
            {wallets.map((w) => (
              <button
                key={w.key}
                className={"wbtn" + (w.detected ? "" : " off")}
                style={{ ["--wc" as any]: w.color }}
                onClick={() => pick(w)}
                disabled={busy === w.key}
              >
                <span className="wicon">
                  {w.icon ? <img src={w.icon} alt="" /> : <span className="emoji">{w.emoji}</span>}
                </span>
                <span className="wmeta">
                  <span className="wn">{w.name}</span>
                  <span className="ws">{busy === w.key ? "opening…" : w.detected ? "connect" : "get it ↗"}</span>
                </span>
              </button>
            ))}
          </div>
        </section>
      )}

      {stage === "resume" && profile && (
        <section className="mid">
          <div className="card welcome">
            <div className="wl">
              <div className="k">Welcome back</div>
              <div className="pname">{profile.name}</div>
              <div className="psub">
                Townhall Lv.{profile.keepLevel} ·{" "}
                {profile.factionSymbol ? <>flying <b>${profile.factionSymbol}</b></> : "no banner (solo)"}
              </div>
            </div>
            <button className="cta" onClick={() => setStage("town")}>Enter the Frontier →</button>
          </div>
          {memes.length > 0 && (
            <div className="card">
              <div className="ct">Change your banner <span className="from">hold the coin, fly the flag — switch anytime</span></div>
              <div className="fgrid">
                <button className={"fcard" + (!profile.faction ? " sel" : "")} onClick={() => switchFaction(null, null)}>
                  <span className="femoji">🏳️</span><span className="fsym">Solo</span><span className="fname">no banner</span>
                </button>
                {pledgeable.map((f) => (
                  <button key={f.ca} className={"fcard" + (profile.faction === f.ca ? " sel" : "")} onClick={() => switchFaction(f.ca, f.symbol)}>
                    {f.icon ? <img className="ficon" src={f.icon} alt="" /> : <span className="femoji">🏴</span>}
                    <span className="fsym">${f.symbol}</span><span className="fname">{f.name}</span>
                  </button>
                ))}
              </div>
            </div>
          )}
          <button className="mini out center" onClick={resetDev}>(dev) start over</button>
        </section>
      )}

      {stage === "start" && records && (
        <section className="mid">
          <div className="lede">
            <h1>Found your Townhall</h1>
            <p>You’ll enter as <b>{autoName(address)}</b>. Pick a banner from a memecoin you hold — or start solo and choose one later.</p>
          </div>

          {/* holdings summary */}
          <div className="card mini-hold">
            <span>Holdings</span>
            <b className="mono">{eth.toFixed(4)} ETH</b>
            <span className="sep">·</span>
            <b className="mono">{memes.length} memecoin{memes.length === 1 ? "" : "s"}</b>
          </div>

          {/* banner pick */}
          <div className="card">
            <div className="ct">Fly a banner <span className="from">optional — switch anytime you hold another coin</span></div>
            {memes.length === 0 ? (
              <div className="buyjoin">
                <p>You don’t hold a memecoin yet — you need one to march under its banner.
                  Grab any coin below to join its faction, or start solo for now.</p>
              </div>
            ) : (
              <div className="fgrid">
                {pledgeable.map((f) => (
                  <button
                    key={f.ca}
                    className={"fcard" + (selectedCA === f.ca ? " sel" : "")}
                    onClick={() => setSelectedCA(selectedCA === f.ca ? null : f.ca)}
                  >
                    {f.icon ? <img className="ficon" src={f.icon} alt="" /> : <span className="femoji">🏴</span>}
                    <span className="fsym">${f.symbol}</span>
                    <span className="fname">{f.name}</span>
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* top factions */}
          <div className="card">
            <div className="ct">Top factions this season</div>
            <div className="board">
              {board.map((f, i) => (
                <div className={"brow" + (f.held ? " held" : "")} key={f.symbol}>
                  <span className="brank">{i + 1}</span>
                  <span className="bname">
                    {f.icon ? <img src={f.icon} alt="" /> : <i className="bdot" />}
                    {f.name} <span className="btick">${f.symbol}</span>
                  </span>
                  <span className="bplayers mono">{f.players.toLocaleString()} players</span>
                  <span className="bact">{f.held ? "you hold ✓" : "buy to join"}</span>
                </div>
              ))}
            </div>
            <div className="note">Bigger factions pull more players — holding their coin is your ticket in. (Standings are illustrative during beta.)</div>
          </div>

          <div className="ctarow">
            <button className="cta big" onClick={found}>
              {selectedCA
                ? `Pledge $${memes.find((m) => m.address === selectedCA)?.symbol} & found Townhall →`
                : "Start solo & found Townhall →"}
            </button>
            <div className="shieldnote">🛡️ New keeps stay protected until Townhall Lv.10 — or until you throw the first punch.</div>
          </div>
        </section>
      )}

      {stage === "town" && profile && <Town address={address} profile={profile} />}

      {stage === "founded" && profile && (
        <section className="mid">
          <div className="card founded">
            <div className="fbadge">🏰</div>
            <h1>Townhall founded</h1>
            <div className="fsummary">
              <div><span>Commander</span><b>{profile.name}</b></div>
              <div><span>Banner</span><b>{profile.factionSymbol ? "$" + profile.factionSymbol : "Solo — no banner"}</b></div>
              <div><span>Townhall</span><b>Lv.{profile.keepLevel}</b></div>
              <div><span>Protection</span><b>until Lv.10</b></div>
            </div>
            <button className="cta big" onClick={() => setStage("town")}>Enter your Townhall →</button>
            <p className="soon">The world map — explore, gather, raid — is the next build.</p>
            <button className="mini out" onClick={resetDev}>(dev) start over</button>
          </div>
        </section>
      )}
    </div>
  );
}
