import type { ChatSignalId, PlanetHaloId, PlanetOrbitId, PlanetSkinId } from "./lib/player-account";
import NameSignal from "./NameSignal";

export interface PlayerSignal {
  username: string;
  allianceSymbol: string | null;
  title: string;
  wallet: string | null;
  skin: { id: PlanetSkinId; name: string; rarity: string };
  halo?: PlanetHaloId | null;
  orbit?: PlanetOrbitId | null;
  nameSignal?: ChatSignalId | null;
  coreLevel: number;
  might: number;
  achievements: Array<{ mark: string; name: string }>;
  online?: boolean;
}

function shortWallet(wallet: string): string {
  return wallet.length > 14 ? `${wallet.slice(0, 8)}…${wallet.slice(-6)}` : wallet;
}

export default function PlayerCard({ signal, onMessage, onOpen }: {
  signal: PlayerSignal;
  onMessage?: () => void;
  onOpen?: () => void;
}) {
  return <article className={`player-signal-card chat-signal-${signal.nameSignal || "clear-channel"}`}>
    <header>
      <div className={`player-signal-orb player-signal-orb-${signal.skin.id} player-signal-halo-${signal.halo || "none"} player-signal-orbit-${signal.orbit || "none"}`}><i /></div>
      <div className="player-signal-name"><small>{signal.allianceSymbol ? `[${signal.allianceSymbol}]` : "[UNCHARTED]"}</small><b><NameSignal signal={signal.nameSignal}>{signal.username}</NameSignal></b><span>{signal.title || "NO TITLE SEALED"}</span></div>
      <em className={signal.online ? "online" : ""}>{signal.online ? "LIVE" : "DARK"}</em>
    </header>
    <div className="player-signal-relic"><span><small>{signal.skin.rarity} CORE</small><b>{signal.skin.name}</b></span><i /></div>
    <div className="player-signal-stats"><span><small>CORE</small><b>{signal.coreLevel.toString().padStart(2, "0")}</b></span><span><small>MIGHT</small><b>{signal.might.toLocaleString()}</b></span></div>
    <div className="player-signal-feats">{signal.achievements.slice(0, 3).map((achievement) => <span key={achievement.name}><i>{achievement.mark}</i><b>{achievement.name}</b></span>)}</div>
    <button className="player-signal-wallet" onClick={() => signal.wallet && navigator.clipboard?.writeText(signal.wallet)} disabled={!signal.wallet}><small>PUBLIC KEY</small><b>{signal.wallet ? shortWallet(signal.wallet) : "NO KEY LINKED"}</b><span>{signal.wallet ? "COPY" : ""}</span></button>
    {(onMessage || onOpen) && <footer>{onMessage && <button onClick={onMessage}>OPEN SIGNAL</button>}{onOpen && <button onClick={onOpen}>FULL DOSSIER</button>}</footer>}
  </article>;
}
