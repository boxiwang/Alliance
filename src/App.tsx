import { useEffect, useMemo, useRef, useState } from "react";
import type { Eip1193Provider, Eip6963ProviderDetail } from "./global";
import { subscribeProviders, resolveWallets, connect, WalletButton } from "./lib/wallet";
import { readWallet, WalletRecords } from "./lib/blockscout";
import { buildTasks, memeHoldings } from "./lib/tasks";
import { topFactions, pledgeableFrom } from "./lib/factions";
import { loadProfile, saveProfile, clearProfile, autoName, normalizeUsername, Profile } from "./lib/profile";
import { fromRaw, compact, usd, shortAddr } from "./lib/format";
import Town from "./Town";
import Admin from "./Admin";
import AlliancePicker from "./AlliancePicker";
import ExpeditionLab from "./ExpeditionLab";
import World from "./World";
import Messages from "./Messages";
import ProfileScreen from "./ProfileScreen";
import Alliance from "./Alliance";
import GameMusic, { requestGameMusicStart } from "./GameMusic";
import GameCursor from "./GameCursor";
import AlphaFeedback from "./AlphaFeedback";
import CosmicBackdrop from "./CosmicBackdrop";
import { hasLocalGm, localGmRequested, registerOwnerGm } from "./lib/gm";
import { loadGame, saveGame } from "./lib/gamestore";
import { project } from "./lib/game";
import { verifyAllianceHolding } from "./lib/alliance";
import { firebaseAuth, firebaseConfigured } from "./lib/firebase-client";
import { GoogleAuthProvider, signInWithPopup, onAuthStateChanged, signOut } from "firebase/auth";
import { loadPlayerAccount, savePlayerAccount } from "./lib/player-account";
import { playSfx, preloadSfx, SFX_LOGIN_HOVER, SFX_LOGIN_HOVER_VOLUME, SFX_TAB_SWITCH, SFX_TAB_SWITCH_VOLUME } from "./lib/sfx";
import { setErrorReportingAddress } from "./lib/error-reporting";
import { authenticateGoogle, authenticateGuest, authenticateWallet, clearBackendSession, loadBackendSession, loadLastBackendSession, mirrorPlayerState, restorePlayerState, resumeBackendSession, sendGameCommand, trackEvents, updatePlayerName } from "./lib/backend";

type Stage = "connect" | "start" | "resume" | "founded" | "alliance" | "town" | "world" | "messages" | "profile";
type MainStage = Extract<Stage, "alliance" | "town" | "world" | "messages" | "profile">;
const MAIN_STAGES: MainStage[] = ["alliance", "town", "world", "messages", "profile"];
const lastGameStageKey = (address: string) => `alliance:last-game-stage:${address.toLowerCase()}`;

function loadLastGameStage(address: string): MainStage {
  try {
    const saved = localStorage.getItem(lastGameStageKey(address));
    if (MAIN_STAGES.includes(saved as MainStage)) return saved as MainStage;
  } catch {}
  return "town";
}

function AllianceWordmark({ hero = false }: { hero?: boolean }) {
  return <div className={`alliance-wordmark${hero ? " hero" : ""}`} aria-label="ALLIANCE">
    <i aria-hidden="true" />
    <span>ALLIANCE</span>
    <i aria-hidden="true" />
  </div>;
}

function isMobileClient(nav: Navigator = navigator): boolean {
  const modern = nav as Navigator & { userAgentData?: { mobile?: boolean } };
  if (modern.userAgentData?.mobile === true) return true;
  if (/Android|iPhone|iPad|iPod|IEMobile|Opera Mini|Mobile/i.test(nav.userAgent)) return true;
  // iPadOS can identify itself as desktop Safari (MacIntel).
  return nav.platform === "MacIntel" && nav.maxTouchPoints > 1;
}

function MobileGate() {
  const [copied, setCopied] = useState(false);
  const desktopUrl = `${window.location.origin}/`;

  async function copyDesktopLink() {
    try {
      await navigator.clipboard.writeText(desktopUrl);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2200);
    } catch {
      // Older mobile browsers still get a selectable URL beneath the button.
      setCopied(false);
    }
  }

  return (
    <main className="mobile-gate">
      <CosmicBackdrop />
      <section className="mobile-gate-shell">
        <i className="mobile-gate-corner top-left" aria-hidden="true" />
        <i className="mobile-gate-corner top-right" aria-hidden="true" />
        <i className="mobile-gate-corner bottom-left" aria-hidden="true" />
        <i className="mobile-gate-corner bottom-right" aria-hidden="true" />
        <AllianceWordmark />

        <div className="mobile-command-display" aria-hidden="true">
          <div className="mobile-command-orbit"><i /><i /><i /></div>
          <div className="mobile-command-screen">
            <span /><span /><span />
          </div>
          <div className="mobile-command-stand" />
        </div>

        <p className="mobile-gate-kicker">DESKTOP REQUIRED</p>
        <h1>OPEN THE FRONTIER<br />ON A BIGGER SCREEN.</h1>
        <p className="mobile-gate-copy">ALLIANCE is built for desktop play. Open this page on a computer. Chrome is recommended for wallet extensions.</p>

        <button type="button" className="mobile-gate-copy-button" onClick={() => void copyDesktopLink()}>
          {copied ? "LINK COPIED" : "COPY DESKTOP LINK"}
        </button>
        <code className="mobile-gate-url">{desktopUrl}</code>
        <footer><i /> MOBILE ACCESS LOCKED</footer>
      </section>
    </main>
  );
}

// Cue when switching between the main tabs (city / star map / alliance / comms /
// profile). Driven off the view state so every navigation path — nav bar, back
// buttons, deep links from comms — plays it exactly once.
function useTabSwitchSfx(address: string, view: string) {
  const prev = useRef(view);
  useEffect(() => {
    const from = prev.current; prev.current = view;
    if (from !== view && MAIN_STAGES.includes(from as MainStage) && MAIN_STAGES.includes(view as MainStage)) {
      const acc = loadPlayerAccount(address);
      if (acc.soundEnabled) playSfx(SFX_TAB_SWITCH, SFX_TAB_SWITCH_VOLUME * acc.sfxVolume);
    }
  }, [view, address]);
}

function useResourceActivity(address: string, active: boolean) {
  useEffect(() => {
    if (!address || !active) return;
    let lastCheckpoint = 0;
    const checkpoint = () => {
      const now = Date.now();
      if (now - lastCheckpoint < 60_000) return;
      lastCheckpoint = now;
      const current = loadGame(address);
      if (current) {
        const next = project(current, now);
        saveGame(next);
        window.dispatchEvent(new CustomEvent("alliance:game-activity", { detail: { address: address.toLowerCase(), game: next } }));
      }
      void sendGameCommand(address, "session.activity", {}, `activity:${crypto.randomUUID()}`).catch(() => {});
    };
    checkpoint();
    window.addEventListener("pointerdown", checkpoint, { passive: true });
    window.addEventListener("pointermove", checkpoint, { passive: true });
    window.addEventListener("keydown", checkpoint);
    return () => {
      window.removeEventListener("pointerdown", checkpoint);
      window.removeEventListener("pointermove", checkpoint);
      window.removeEventListener("keydown", checkpoint);
    };
  }, [active, address]);
}

// Guest / Google players have no wallet, but the whole app is keyed on a 0x
// address, so derive a stable synthetic one from their id. FNV-1a expanded to 40 hex.
function synthAddress(seed: string): string {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < seed.length; i += 1) { h ^= seed.charCodeAt(i); h = Math.imul(h, 16777619) >>> 0; }
  let hex = "";
  let x = h >>> 0;
  while (hex.length < 40) { x = Math.imul(x ^ (x >>> 15), 2246822507) >>> 0; hex += (x >>> 0).toString(16).padStart(8, "0"); }
  return "0x" + hex.slice(0, 40);
}

function DevGameShell({ initialView, slot, gm }: { initialView: MainStage; slot: string; gm: boolean }) {
  const address = slot === "1" ? "0x000000000000000000000000000000000000dEv1" : `0x00000000000000000000000000000000000dEv-${slot}`;
  const fallback: Profile = {
    address, name: "Ruglord1070273", motto: "THE FRONTIER REMEMBERS.",
    faction: "0x0000000000000000000000000000000000orbit", factionSymbol: "ORBT",
    keepLevel: 1, createdAt: new Date(0).toISOString(), renamedOnce: false,
    title: "FRONTIER BORN", avatarId: "genesis",
  };
  const [view, setView] = useState<MainStage>(initialView);
  useTabSwitchSfx(address, view);
  useResourceActivity(address, true);
  const [profile, setProfile] = useState<Profile>(() => loadProfile(address) || fallback);
  const gmHoldings = gm ? [{ address: `0x${slot.padStart(40, "a").slice(-40)}`, name: "ORBT", symbol: "ORBT", decimals: 18, raw: "1000000000000000000", type: "ERC-20", exchangeRate: null, marketCap: null, iconUrl: null, reputation: null }] : [];

  const navigate = (next: MainStage, replace = false) => {
    const url = `/?${next}${gm ? "&gm" : ""}&slot=${slot}`;
    window.history[replace ? "replaceState" : "pushState"]({}, "", url);
    setView(next);
  };

  useEffect(() => {
    const syncFromHistory = () => {
      const search = new URLSearchParams(window.location.search);
      const next = (["alliance", "town", "world", "messages", "profile"] as MainStage[]).find((candidate) => search.has(candidate));
      if (next) setView(next);
    };
    window.addEventListener("popstate", syncFromHistory);
    return () => window.removeEventListener("popstate", syncFromHistory);
  }, []);

  return <div className="page">
    <GameMusic address={address} active />
    <GameCursor address={address} active />
    {view === "alliance" && <Alliance address={address} profile={profile} holdings={gmHoldings} onProfileChange={(next) => { saveProfile(next); setProfile(next); }} onCity={() => navigate("town")} onWorld={() => navigate("world")} onMessages={() => navigate("messages")} onProfile={() => navigate("profile")} />}
    {view === "town" && <Town address={address} profile={profile} onAlliance={() => navigate("alliance")} onWorld={() => navigate("world")} onMessages={() => navigate("messages")} onProfile={() => navigate("profile")} />}
    {view === "world" && <World address={address} profile={profile} onAlliance={() => navigate("alliance")} onBack={() => navigate("town")} onMessages={() => navigate("messages")} onProfile={() => navigate("profile")} />}
    {view === "messages" && <Messages address={address} profile={profile} onAlliance={() => navigate("alliance")} onCity={() => navigate("town")} onWorld={() => navigate("world")} onProfile={() => navigate("profile")} />}
    {view === "profile" && <ProfileScreen address={address} profile={profile} onProfileChange={(next) => { saveProfile(next); setProfile(next); }} onAlliance={() => navigate("alliance")} onCity={() => navigate("town")} onWorld={() => navigate("world")} onMessages={() => navigate("messages")} />}
  </div>;
}

function DesktopApp() {
  const params = new URLSearchParams(window.location.search);
  if (params.has("admin")) {
    return <Admin />;
  }
  if (params.has("expedition")) {
    return <ExpeditionLab />;
  }
  if (import.meta.env.DEV) {
    const devView = (["alliance", "town", "world", "messages", "profile"] as MainStage[]).find((candidate) => params.has(candidate));
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
  const [sessionRestorePending, setSessionRestorePending] = useState(true);
  const loginAttemptRef = useRef(0);
  useTabSwitchSfx(address, stage);
  useResourceActivity(address, MAIN_STAGES.includes(stage as MainStage));

  useEffect(() => {
    preloadSfx([SFX_LOGIN_HOVER, SFX_TAB_SWITCH]);
  }, []);

  // Attach the signed-in player to global error reports (""/anon before login).
  useEffect(() => { setErrorReportingAddress(address); }, [address]);

  useEffect(() => {
    if (!address || !MAIN_STAGES.includes(stage as MainStage)) return;
    try { localStorage.setItem(lastGameStageKey(address), stage); } catch {}
    void trackEvents(address, [{ name: "session.page_viewed", page: stage }]).catch(() => {});
    void mirrorPlayerState(address, {
      profile,
      game: loadGame(address),
      account: loadPlayerAccount(address),
    }).catch(() => {});
  }, [address, stage, profile]);

  useEffect(() => subscribeProviders(setDetected), []);

  // Wallet signatures establish a backend session; they are not a per-page
  // navigation requirement. On refresh, validate the saved token with /me and
  // resume the last game view without asking the wallet to sign again.
  useEffect(() => {
    const stored = loadLastBackendSession();
    if (!stored) { setSessionRestorePending(false); return; }
    const timeout = new Promise<null>((resolve) => window.setTimeout(() => resolve(null), 4000));
    void Promise.race([resumeBackendSession(), timeout]).then(async (session) => {
      if (!session) return;
      if (session.player.role === "gm") registerOwnerGm(session.player.id);
      await beginLocalSession(session.player.id, session.player.displayName, session.player.authMethod === "wallet" ? "Wallet" : session.player.authMethod === "google" ? "Google" : "Guest", true);
      if (session.player.authMethod === "wallet") {
        void readWallet(session.player.id).then((recs) => {
          setRecords(recs);
          const existing = loadProfile(session.player.id);
          if (!existing) return;
          const holdingCheck = verifyAllianceHolding(existing, memeHoldings(recs));
          if (holdingCheck.status === "removed") {
            const updated = { ...existing, faction: null, factionSymbol: null };
            saveProfile(updated); setProfile(updated);
          }
        }).catch(() => {});
      }
    }).finally(() => setSessionRestorePending(false));
  }, []);

  // Restore a Firebase session through the backend so roles are never inferred
  // from user-controlled browser storage.
  useEffect(() => {
    if (sessionRestorePending) return;
    const auth = firebaseAuth();
    if (!auth) return;
    return onAuthStateChanged(auth, (u) => {
      if (!u || address) return;
      void u.getIdToken().then(authenticateGoogle).then((session) => {
        if (session.player.role === "gm") registerOwnerGm(session.player.id);
        // Auto-login on refresh: Firebase persisted the Google session, so resume
        // straight into the game (and restore the mirrored save) rather than
        // dropping back to the connect screen.
        void beginLocalSession(session.player.id, session.player.displayName || u.displayName || "", "Google");
      }).catch(() => {});
    });
  }, [address, sessionRestorePending]);
  const wallets = useMemo(() => resolveWallets(detected), [detected]);

  // Google sign-in via Firebase Auth (reuses the Blockwick Firebase project).
  async function signInGoogle() {
    const attempt = ++loginAttemptRef.current;
    playLoginSelectSfx();
    setError("");
    const auth = firebaseAuth();
    if (!auth) { setError("Google sign-in is not configured."); return; }
    setBusy("google");
    try {
      const cred = await signInWithPopup(auth, new GoogleAuthProvider());
      if (attempt !== loginAttemptRef.current) return;
      const u = cred.user;
      const session = await authenticateGoogle(await u.getIdToken());
      if (attempt !== loginAttemptRef.current) return;
      if (session.player.role === "gm") registerOwnerGm(session.player.id);
      await beginLocalSession(session.player.id, session.player.displayName || u.displayName || "", "Google");
      void trackEvents(session.player.id, [{ name: "auth.login", page: "connect", properties: { method: "google" } }]);
    } catch (e: any) {
      if (attempt !== loginAttemptRef.current) return;
      const msg = String(e?.code || e?.message || "");
      if (!msg.includes("popup-closed") && !msg.includes("cancelled")) setError("Google sign-in failed. Try again or use Quick Play.");
    } finally {
      if (attempt === loginAttemptRef.current) setBusy("");
    }
  }

  const memes = records ? memeHoldings(records) : [];
  const pledgeable = pledgeableFrom(memes);
  const heldSymbols = new Set(memes.map((m) => (m.symbol || "").toUpperCase()));
  const iconBySym = new Map(memes.map((m) => [(m.symbol || "").toUpperCase(), m.iconUrl]));
  const nameBySym = new Map(memes.map((m) => [(m.symbol || "").toUpperCase(), m.name]));
  const board = useMemo(() => topFactions(heldSymbols, iconBySym, nameBySym), [records]);
  const eth = records ? fromRaw(records.coinBalanceRaw, 18) : 0;
  const currentKeepLevel = profile ? (loadGame(profile.address)?.buildings.keep.lvl ?? profile.keepLevel) : 1;

  function playLoginSelectSfx() {
    playSfx(SFX_TAB_SWITCH, SFX_TAB_SWITCH_VOLUME);
    requestGameMusicStart();
  }

  function playLoginHoverSfx() {
    playSfx(SFX_LOGIN_HOVER, SFX_LOGIN_HOVER_VOLUME);
  }

  async function pick(w: WalletButton) {
    const attempt = ++loginAttemptRef.current;
    playLoginSelectSfx();
    setError("");
    if (!w.provider) {
      setBusy("");
      if (w.install) window.open(w.install, "_blank", "noopener");
      return;
    }
    setBusy(w.key);
    try {
      const res = await connect(w.provider);
      if (attempt !== loginAttemptRef.current) return;
      const session = await authenticateWallet(w.provider, res.address);
      if (attempt !== loginAttemptRef.current) return;
      if (session.player.role === "gm") registerOwnerGm(session.player.id);
      const connectedAddress = session.player.id;
      setProvider(w.provider);
      setAddress(connectedAddress);
      setChainOk(res.chainOk);
      setWalletName(w.name);
      void trackEvents(connectedAddress, [{ name: "auth.login", page: "connect", properties: { method: "wallet", wallet: w.name, chainOk: res.chainOk } }]);
      // Blockscout sits behind a Cloudflare challenge that our server-side proxy
      // can't always clear; don't let a failed read block a wallet player from
      // entering — fall through with empty records (solo, no token/faction data).
      let recs: WalletRecords;
      try {
        recs = await readWallet(connectedAddress);
      } catch {
        recs = { address: connectedAddress, coinBalanceRaw: "0", ethPrice: null, isContract: false, txCount: 0, tokenTransferCount: 0, tokens: [], recentTxs: [], oldestSeen: null };
      }
      setRecords(recs);
      await hydrateFromBackend(connectedAddress);
      let existing = loadProfile(connectedAddress);
      if (existing) {
        const holdingCheck = verifyAllianceHolding(existing, memeHoldings(recs));
        if (holdingCheck.status === "removed") {
          existing = { ...existing, faction: null, factionSymbol: null };
          saveProfile(existing);
        }
      }
      if (existing) {
        if (normalizeUsername(existing.name) !== normalizeUsername(session.player.displayName) && existing.name !== "Commander") {
          try {
            const renamed = await updatePlayerName(connectedAddress, existing.name);
            existing = { ...existing, name: renamed.displayName, lastRenamedAt: renamed.lastRenamedAt ? new Date(renamed.lastRenamedAt).toISOString() : existing.lastRenamedAt };
            saveProfile(existing);
          } catch {
            existing = { ...existing, name: session.player.displayName };
            saveProfile(existing);
          }
        }
        setProfile(existing);
        const nextStage = hasLocalGm(connectedAddress) ? "town" : "resume";
        setStage(nextStage);
        report(recs, { wallet: w.name, chainOk: res.chainOk, stage: nextStage, profile: existing });
      } else {
        // Faction/token data is unavailable while Blockscout is gated, so skip the
        // faction picker and drop a new wallet player straight into a solo keep
        // (same as Quick Play). Faction join can return once reads work.
        const p: Profile = { address: connectedAddress, name: session.player.displayName || autoName(connectedAddress), faction: null, factionSymbol: null, keepLevel: 1, createdAt: new Date().toISOString(), renamedOnce: false };
        saveProfile(p);
        setProfile(p);
        setStage("founded");
        report(recs, { wallet: w.name, chainOk: res.chainOk, stage: "founded", profile: p });
      }
    } catch (e: any) {
      if (attempt !== loginAttemptRef.current) return;
      playSfx(SFX_TAB_SWITCH, SFX_TAB_SWITCH_VOLUME);
      requestGameMusicStart();
      const code = e?.code;
      const msg = String(e?.message || "");
      if (msg.startsWith("__timeout__")) {
        setError("Wallet didn't respond — open your wallet to approve, then try again. Or use Quick Play.");
      } else if (code === -32002 || msg.toLowerCase().includes("already pending")) {
        setError("A connection request is already open in your wallet — approve it there (or reopen the wallet), then retry.");
      } else if (code === 4001 || msg.toLowerCase().includes("reject") || msg.toLowerCase().includes("denied")) {
        setError("Connection cancelled. Tap the wallet again to retry.");
      } else {
        setError(e?.message || "Couldn't connect. Try again — or use Quick Play.");
      }
    } finally {
      if (attempt === loginAttemptRef.current) setBusy("");
    }
  }

  function found(factionCA: string | null) {
    if (!records) return;
    const chosen = memes.find((m) => m.address === factionCA) || null;
    const serverName = loadBackendSession(address)?.player.displayName;
    const p: Profile = {
      address,
      name: serverName || autoName(address),
      faction: chosen?.address || null,
      factionSymbol: chosen?.symbol || null,
      keepLevel: 1,
      createdAt: new Date().toISOString(),
      renamedOnce: false,
    };
    saveProfile(p);
    setProfile(p);
    setStage(hasLocalGm(address) ? "town" : "founded");
    report(records, { wallet: walletName, chainOk, stage: "founded", profile: p });
  }

  // Wallet-free entry (Quick Play / Google): synthetic address + empty records,
  // no chain/Blockscout. Drops a new player straight into a solo keep.
  // Dataloss recovery: a new device / cleared cache has no local save, but the
  // backend may hold a mirrored one. Pull it down and write it locally BEFORE we
  // decide new-vs-resume — but only when local is empty, so active progress on
  // this device is never clobbered.
  async function hydrateFromBackend(addr: string) {
    if (loadProfile(addr)) return;
    const restored = await restorePlayerState(addr).catch(() => null);
    if (!restored) return;
    try { const a = restored.account as Parameters<typeof savePlayerAccount>[0]; if (a && (a as { playerId?: string }).playerId) savePlayerAccount(a); } catch {}
    try { const g = restored.game as Parameters<typeof saveGame>[0]; if (g && (g as { address?: string }).address) saveGame(g); } catch {}
    try { const p = restored.profile as Profile; if (p && p.address) saveProfile(p); } catch {}
  }

  async function beginLocalSession(addr: string, displayName: string, sourceLabel: string, resumeDirect = false) {
    setError("");
    setProvider(null);
    setAddress(addr);
    setChainOk(true);
    setWalletName(sourceLabel);
    const stub: WalletRecords = { address: addr, coinBalanceRaw: "0", ethPrice: null, isContract: false, txCount: 0, tokenTransferCount: 0, tokens: [], recentTxs: [], oldestSeen: null };
    setRecords(stub);
    await hydrateFromBackend(addr);
    const existing = loadProfile(addr);
    if (existing) {
      const serverName = displayName || autoName(addr);
      if (existing.name === "Commander") {
        existing.name = serverName;
        saveProfile(existing);
      } else if ( (normalizeUsername(existing.name) !== normalizeUsername(serverName))) {
        void updatePlayerName(addr, existing.name).then((renamed) => {
          const synced = { ...existing, name: renamed.displayName, lastRenamedAt: renamed.lastRenamedAt ? new Date(renamed.lastRenamedAt).toISOString() : existing.lastRenamedAt };
          saveProfile(synced); setProfile(synced);
        }).catch(() => {
          const synced = { ...existing, name: serverName };
          saveProfile(synced); setProfile(synced);
        });
      }
      setProfile(existing);
      const savedStage = loadLastGameStage(addr);
      setStage(resumeDirect ? savedStage : hasLocalGm(addr) ? "town" : "resume");
      return;
    }
    const p: Profile = {
      address: addr,
      name: displayName || autoName(addr),
      faction: null,
      factionSymbol: null,
      keepLevel: 1,
      createdAt: new Date().toISOString(),
      renamedOnce: false,
    };
    saveProfile(p);
    setProfile(p);
    setStage("founded");
  }

  async function startGuest() {
    const attempt = ++loginAttemptRef.current;
    playLoginSelectSfx();
    setBusy("guest");
    setError("");
    let id = "";
    try { id = localStorage.getItem("alliance:guest-id") || ""; } catch {}
    if (!id) {
      id = "guest:" + Math.random().toString(36).slice(2) + Date.now().toString(36);
      try { localStorage.setItem("alliance:guest-id", id); } catch {}
    }
    try {
      const playerId = synthAddress(id);
      const session = await authenticateGuest(id, playerId);
      if (attempt !== loginAttemptRef.current) return;
      await beginLocalSession(session.player.id, session.player.displayName, "Guest");
      void trackEvents(session.player.id, [{ name: "auth.login", page: "connect", properties: { method: "guest" } }]);
    } catch {
      if (attempt !== loginAttemptRef.current) return;
      setError("Quick Play couldn't reach the frontier. Check your connection and try again.");
    } finally {
      if (attempt === loginAttemptRef.current) setBusy("");
    }
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

  async function disconnect() {
    if (address) clearBackendSession(address);
    const auth = firebaseAuth();
    if (auth?.currentUser) await signOut(auth).catch(() => {});
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

  if (sessionRestorePending) return <div className="page session-resume-page">
    <CosmicBackdrop />
    <GameMusic address="" active />
    <header className="topbar connect-topbar"><AllianceWordmark /><span className="chip lock">RESTORING COMMAND LINK</span></header>
    <main className="session-resume"><i /><b>RECONNECTING</b><span>VERIFYING SESSION</span></main>
  </div>;

  return (
    <div className="page">
      {!MAIN_STAGES.includes(stage as MainStage) && <CosmicBackdrop />}
      <GameMusic address={address} active />
      <GameCursor address={address} active={!!address && (stage === "alliance" || stage === "town" || stage === "world" || stage === "messages" || stage === "profile")} />
      <header className={`topbar${stage === "connect" ? " connect-topbar" : ""}`}>
        <AllianceWordmark />
        {address ? (
          <div className="chips">
            <span className="chip"><i className="dot" /> {shortAddr(address)}</span>
            <button className="mini out" onClick={disconnect}>Disconnect</button>
          </div>
        ) : (
          <span className="chip lock">SIGNATURE ONLY · NO FUNDS MOVE</span>
        )}
      </header>

      {error && <div className="banner err">{error}</div>}
      {localGmRequested() && stage !== "town" && (
        <div className="banner gm-notice">
          🧪 GM access is limited to the owner wallet.
        </div>
      )}

      {stage === "connect" && (
        <section className="connect">
          <div className="connect-horizon" aria-hidden="true"><i /><i /><i /></div>
          <div className="connect-hero">
            <small>THE FRONTIER IS OPEN</small>
            <AllianceWordmark hero />
            <p>TAKE THE CENTER.</p>
          </div>
          <div className="access-frame">
            <i className="access-corner c1" /><i className="access-corner c2" /><i className="access-corner c3" /><i className="access-corner c4" />
            <header><span>CONNECT WALLET</span><em><i /> FRONTIER ONLINE</em></header>
            <div className="wgrid">
              {wallets.map((w) => (
                <button
                  key={w.key}
                  className={"wbtn" + (w.detected ? "" : " off")}
                  style={{ ["--wc" as any]: w.color }}
                  onClick={() => pick(w)}
                  onMouseEnter={playLoginHoverSfx}
                  disabled={busy === w.key}
                >
                  <span className="wicon">
                    {w.icon ? <img src={w.icon} alt="" /> : <span className="emoji">{w.emoji}</span>}
                  </span>
                  <span className="wmeta">
                    <span className="wn">{w.name}</span>
                    <span className="ws">{busy === w.key ? "OPENING…" : w.detected ? "READY" : "GET WALLET ↗"}</span>
                  </span>
                </button>
              ))}
            </div>
            <div className="quickstart">
              <div className="or"><span>OR ENTER WITHOUT A WALLET</span></div>
              <button className="cta big secondary-entry" onMouseEnter={playLoginHoverSfx} onClick={startGuest} disabled={busy === "guest"}>{busy === "guest" ? "OPENING SECTOR…" : "ENTER AS GUEST"}</button>
              {firebaseConfigured && <button className="gbtn" onMouseEnter={playLoginHoverSfx} onClick={() => void signInGoogle()} disabled={busy === "google"}>{busy === "google" ? "OPENING GOOGLE…" : "CONTINUE WITH GOOGLE"}</button>}
            </div>
            <footer>Wallet commanders can enter token-gated alliances and trade on the marketplace.</footer>
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
          {import.meta.env.DEV && <button className="mini out center" onClick={resetDev}>Reset onboarding</button>}
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
                    {f.name && <>{f.name} </>}<span className="btick">${f.symbol}</span>
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

      {stage === "alliance" && profile && <Alliance address={address} profile={profile} holdings={memes} onProfileChange={updateProfile} onCity={() => setStage("town")} onWorld={() => setStage("world")} onMessages={() => setStage("messages")} onProfile={() => setStage("profile")} />}
      {stage === "town" && profile && <Town address={address} profile={profile} onAlliance={() => setStage("alliance")} onWorld={() => setStage("world")} onMessages={() => setStage("messages")} onProfile={() => setStage("profile")} />}
      {stage === "world" && profile && <World address={address} profile={profile} onAlliance={() => setStage("alliance")} onBack={() => setStage("town")} onMessages={() => setStage("messages")} onProfile={() => setStage("profile")} />}
      {stage === "messages" && profile && <Messages address={address} profile={profile} onAlliance={() => setStage("alliance")} onCity={() => setStage("town")} onWorld={() => setStage("world")} onProfile={() => setStage("profile")} />}
      {stage === "profile" && profile && <ProfileScreen address={address} profile={profile} onProfileChange={updateProfile} onAlliance={() => setStage("alliance")} onCity={() => setStage("town")} onWorld={() => setStage("world")} onMessages={() => setStage("messages")} />}
      {address && MAIN_STAGES.includes(stage as MainStage) && <AlphaFeedback address={address} page={stage} />}

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
            <p className="soon">Your sector is ready. Build your city, explore the Star Map, and open Comms to meet other commanders.</p>
            {import.meta.env.DEV && <button className="mini out" onClick={resetDev}>Reset onboarding</button>}
          </div>
        </section>
      )}
    </div>
  );
}

export default function App() {
  const previewMobileGate = import.meta.env.DEV && new URLSearchParams(window.location.search).has("mobile-preview");
  return isMobileClient() || previewMobileGate ? <MobileGate /> : <DesktopApp />;
}
