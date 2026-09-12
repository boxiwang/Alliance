import { useEffect, useMemo, useState } from "react";
import type { Eip1193Provider, Eip6963ProviderDetail } from "./global";
import { subscribeProviders, resolveWallets, connect, signIn, WalletButton } from "./lib/wallet";
import { readWallet, WalletRecords } from "./lib/blockscout";
import { buildTasks, memeHoldings } from "./lib/tasks";
import { topFactions, pledgeableFrom } from "./lib/factions";
import { loadProfile, saveProfile, clearProfile, autoName, Profile } from "./lib/profile";
import { fromRaw, compact, usd, shortAddr } from "./lib/format";
import Town from "./Town";
import Admin from "./Admin";
import AlliancePicker from "./AlliancePicker";
import ExpeditionLab from "./ExpeditionLab";
import World from "./World";
import Messages from "./Messages";
import ProfileScreen from "./ProfileScreen";
import GameMusic, { requestGameMusicStart } from "./GameMusic";
import { grantLocalGm, localGmRequested } from "./lib/gm";
import { loadGame } from "./lib/gamestore";

type Stage = "connect" | "start" | "resume" | "founded" | "town" | "world" | "messages" | "profile";
type MainStage = Extract<Stage, "town" | "world" | "messages" | "profile">;

function DevGameShell({ initialView, slot, gm }: { initialView: MainStage; slot: string; gm: boolean }) {
  const address = slot === "1" ? "0x000000000000000000000000000000000000dEv1" : `0x00000000000000000000000000000000000dEv-${slot}`;
  const fallback: Profile = {
    address, name: "Ruglord1070273", motto: "THE FRONTIER REMEMBERS.",
    faction: "0x0000000000000000000000000000000000orbit", factionSymbol: "ORBT",
    keepLevel: 1, createdAt: new Date(0).toISOString(), renamedOnce: false,
    title: "FRONTIER BORN", avatarId: "genesis",
  };
  const [view, setView] = useState<MainStage>(initialView);
  const [profile, setProfile] = useState<Profile>(() => loadProfile(address) || fallback);

  const navigate = (next: MainStage, replace = false) => {
    const url = `/?${next}${gm ? "&gm" : ""}&slot=${slot}`;
    window.history[replace ? "replaceState" : "pushState"]({}, "", url);
    setView(next);
  };

  useEffect(() => {
    const syncFromHistory = () => {
      const search = new URLSearchParams(window.location.search);
      const next = (["town", "world", "messages", "profile"] as MainStage[]).find((candidate) => search.has(candidate));
      if (next) setView(next);
    };
    window.addEventListener("popstate", syncFromHistory);
    return () => window.removeEventListener("popstate", syncFromHistory);
  }, []);

  return <div className="page">
    <GameMusic address={address} active />
    {view === "town" && <Town address={address} profile={profile} onWorld={() => navigate("world")} onMessages={() => navigate("messages")} onProfile={() => navigate("profile")} />}
    {view === "world" && <World address={address} profile={profile} onBack={() => navigate("town")} onMessages={() => navigate("messages")} onProfile={() => navigate("profile")} />}
    {view === "messages" && <Messages address={address} profile={profile} onCity={() => navigate("town")} onWorld={() => navigate("world")} onProfile={() => navigate("profile")} />}
    {view === "profile" && <ProfileScreen address={address} profile={profile} onProfileChange={(next) => { saveProfile(next); setProfile(next); }} onCity={() => navigate("town")} onWorld={() => navigate("world")} onMessages={() => navigate("messages")} />}
  </div>;
}

export default function App() {
  const params = new URLSearchParams(window.location.search);
  if (params.has("admin")) {
    return <Admin />;
  }
  if (params.has("expedition")) {
    return <ExpeditionLab />;
  }
  if (import.meta.env.DEV) {
    const devView = (["town", "world", "messages", "profile"] as MainStage[]).find((candidate) => params.has(candidate));
    if (devView) {
      const slot = (params.get("slot") || "1").replace(/[^a-z0-9-]/gi, "").slice(0, 12) || "1";
      return <DevGameShell initialView={devView} slot={slot} gm={params.has("gm")} />;
    }
  }

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
  useEffect(() => {
    if (address && localGmRequested()) grantLocalGm(address);
  }, [address]);
  const wallets = useMemo(() => resolveWallets(detected), [detected]);

  const memes = records ? memeHoldings(records) : [];
  const pledgeable = pledgeableFrom(memes);
  const heldSymbols = new Set(memes.map((m) => (m.symbol || "").toUpperCase()));
  const iconBySym = new Map(memes.map((m) => [(m.symbol || "").toUpperCase(), m.iconUrl]));
  const board = useMemo(() => topFactions(heldSymbols, iconBySym), [records]);
  const eth = records ? fromRaw(records.coinBalanceRaw, 18) : 0;
  const currentKeepLevel = profile ? (loadGame(profile.address)?.buildings.keep.lvl ?? profile.keepLevel) : 1;

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
      const nextStage = existing ? (localGmRequested() ? "town" : "resume") : "start";
      setStage(nextStage);
      report(recs, { wallet: w.name, chainOk: res.chainOk, stage: nextStage, profile: existing });
    } catch (e: any) {
      setError(e?.message || "Couldn't connect. Try again?");
    } finally {
      setBusy("");
    }
  }

  function found(factionCA: string | null) {
    if (!records) return;
    const chosen = memes.find((m) => m.address === factionCA) || null;
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
    setStage(localGmRequested() ? "town" : "founded");
    report(records, { wallet: walletName, chainOk, stage: "founded", profile: p });
  }

  function switchFaction(ca: string | null, sym: string | null) {
    if (!profile) return;
    const p = { ...profile, faction: ca, factionSymbol: sym };
    saveProfile(p);
    setProfile(p);
  }

  function updateProfile(next: Profile) {
    saveProfile(next);
    setProfile(next);
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
      <GameMusic address={address} active={stage === "town" || stage === "world" || stage === "messages" || stage === "profile"} />
      <header className="topbar">
        <div className="brand">
          <span className="crest">⚔️</span>
          <div>
            <div className="bname">ALLIANCE</div>
            <div className="bsub">on-chain civilization · local alpha</div>
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
      {localGmRequested() && stage !== "town" && (
        <div className="banner gm-notice">
          🧪 GM test mode — connect your test wallet to enter its Town with Fill resources, Finish queues and Townhall +1.
        </div>
      )}

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
              <div className="psub">Townhall Lv.{currentKeepLevel}</div>
            </div>
            <button className="cta" onClick={() => { requestGameMusicStart(); setStage("town"); }}>Open Command Center →</button>
          </div>
          {memes.length > 0 && (
            <div className="card">
              <div className="ct">Choose an alliance <span className="from">only alliances whose token you currently hold</span></div>
              <AlliancePicker
                alliances={pledgeable}
                selectedCA={profile.faction}
                onSelect={(alliance) => switchFaction(alliance.ca, alliance.symbol)}
              />
            </div>
          )}
          {profile.faction && <button className="mini out center" onClick={() => switchFaction(null, null)}>Leave current alliance</button>}
          <button className="mini out center" onClick={resetDev}>(dev) start over</button>
        </section>
      )}

      {stage === "start" && records && (
        <section className="mid">
          <div className="lede">
            <h1>Found your Townhall</h1>
            <p>You’ll enter Personal Mode as <b>{autoName(address)}</b>. Alliance membership is optional and can be changed later.</p>
          </div>

          {/* holdings summary */}
          <div className="card mini-hold">
            <span>Holdings</span>
            <b className="mono">{eth.toFixed(4)} ETH</b>
            <span className="sep">·</span>
            <b className="mono">{memes.length} memecoin{memes.length === 1 ? "" : "s"}</b>
          </div>

          {/* Alliance membership: this list contains alliances only. */}
          <div className="card">
            <div className="ct">Choose an alliance <span className="from">select one whose token you hold</span></div>
            {memes.length === 0 ? (
              <div className="buyjoin">
                <p>You don’t currently hold an alliance token. You can still build in Personal Mode and join an alliance later.</p>
              </div>
            ) : (
              <AlliancePicker
                alliances={pledgeable}
                selectedCA={selectedCA}
                onSelect={(alliance) => setSelectedCA(selectedCA === alliance.ca ? null : alliance.ca)}
              />
            )}
          </div>

          {selectedCA ? (
            <div className="ctarow alliance-cta">
              <button className="cta big" onClick={() => found(selectedCA)}>
                Join ${memes.find((m) => m.address === selectedCA)?.symbol} alliance &amp; found Townhall →
              </button>
              <div className="shieldnote">Alliance membership adds a shared layer; your Townhall remains your permanent personal progression.</div>
            </div>
          ) : (
            <div className="alliance-prompt">Select an alliance above to join it.</div>
          )}

          {/* Continuing alone is an entry action, never a synthetic alliance card. */}
          <div className="solo-option">
            <div className="solo-copy">
              <b>Continue independently</b>
              <span>Alliance membership can be added later.</span>
            </div>
            <button className="solo-button" onClick={() => found(null)}>Found Townhall →</button>
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

          <div className="ctarow protection-row">
            <div className="shieldnote">🛡️ New keeps stay protected until Townhall Lv.10 — or until you throw the first punch.</div>
          </div>
        </section>
      )}

      {stage === "town" && profile && <Town address={address} profile={profile} onWorld={() => setStage("world")} onMessages={() => setStage("messages")} onProfile={() => setStage("profile")} />}
      {stage === "world" && profile && <World address={address} profile={profile} onBack={() => setStage("town")} onMessages={() => setStage("messages")} onProfile={() => setStage("profile")} />}
      {stage === "messages" && profile && <Messages address={address} profile={profile} onCity={() => setStage("town")} onWorld={() => setStage("world")} onProfile={() => setStage("profile")} />}
      {stage === "profile" && profile && <ProfileScreen address={address} profile={profile} onProfileChange={updateProfile} onCity={() => setStage("town")} onWorld={() => setStage("world")} onMessages={() => setStage("messages")} />}

      {stage === "founded" && profile && (
        <section className="mid">
          <div className="card founded">
            <div className="fbadge">🏰</div>
            <h1>Townhall founded</h1>
            <div className="fsummary">
              <div><span>Commander</span><b>{profile.name}</b></div>
              <div><span>Mode</span><b>Personal</b></div>
              {profile.factionSymbol && <div><span>Alliance</span><b>${profile.factionSymbol}</b></div>}
              <div><span>Townhall</span><b>Lv.{profile.keepLevel}</b></div>
              <div><span>Protection</span><b>until Lv.10</b></div>
            </div>
            <button className="cta big" onClick={() => { requestGameMusicStart(); setStage("town"); }}>Enter your Townhall →</button>
            <p className="soon">The world map — explore, gather, raid — is the next build.</p>
            <button className="mini out" onClick={resetDev}>(dev) start over</button>
          </div>
        </section>
      )}
    </div>
  );
}
