import type { ReactNode } from "react";
import CommanderAvatar from "./CommanderAvatar";
import NameSignal from "./NameSignal";
import { compact } from "./lib/format";
import { displayResource, displayTroops } from "./lib/game";
import type { ChatSignalId } from "./lib/player-account";
import type { ScoutSnapshot } from "./lib/realtime";

const RESOURCE_COLORS = { cash: "#43f2a1", oil: "#ffb454", power: "#38d9ff" } as const;

/** The shield mark (same shape as the nav buff bar), in shield blue. */
export function ShieldGlyph() {
  return <svg className="shield-glyph" viewBox="0 0 16 16" aria-hidden="true"><path d="M8 1.5 13.5 3.6v4c0 3.3-2.3 5.5-5.5 6.9-3.2-1.4-5.5-3.6-5.5-6.9v-4Z" /></svg>;
}

/**
 * The commander card body, shared by the Star Map card and a card relayed to chat, so a
 * share looks exactly like what the sender saw: identity, plus recon rows while the
 * intel is still valid (they disappear when it expires). Troops and resources use the same
 * display units as the rest of the game (nav bar, city).
 */
export default function CommanderCardView({ id, name, faction, avatar, coreLevel, signal, recon, now, markExpired = false, shield = null, bio = null, children }: {
  id: string; name: string; faction: string | null; avatar: string | null | undefined; coreLevel: number;
  signal: ChatSignalId | null | undefined; recon: { snapshot: ScoutSnapshot; expiresAt: number } | null | undefined; now: number;
  /** A relayed card says its recon has expired (the Star Map card simply returns to normal). */
  markExpired?: boolean;
  /** Public shield status on the live Star Map card ("7:42:10", "UNTIL CORE 10", "∞"). */
  shield?: string | null;
  /** The commander's self-introduction (one line). */
  bio?: string | null;
  children?: ReactNode;
}) {
  const leftMs = recon ? recon.expiresAt - now : 0;
  const snap = leftMs > 0 ? recon!.snapshot : null;
  return <>
    <header>
      <span className="commander-card-avatar">
        <CommanderAvatar playerId={id} avatar={avatar} className="commander-card-sigil" />
        <em aria-label={`Core ${coreLevel}`}>{coreLevel}</em>
      </span>
      <div>
        <b>{faction ? <i>[{faction}]</i> : null}<NameSignal key={id} signal={signal ?? null}>{name || "Commander"}</NameSignal></b>
        <small>CORE {coreLevel}{shield != null && <span className="commander-card-shield"><ShieldGlyph />SHIELD · {shield}</span>}</small>
      </div>
    </header>
    {bio && <p className="commander-card-bio">{bio}</p>}
    {!snap && recon && markExpired && <div className="commander-card-expired">RECON EXPIRED</div>}
    {snap && <div className="commander-card-intel" aria-label="Recon intel">
      <div className="commander-card-intel-head"><small>MIGHT</small><b>{compact(snap.might)}</b><em>INTEL · {leftMs >= 60_000 ? `${Math.ceil(leftMs / 60_000)}M` : "<1M"}</em></div>
      <dl>
        <div><dt>ARMY</dt><dd>{compact(displayTroops(snap.troops.army))}</dd></div><div><dt>NAVY</dt><dd>{compact(displayTroops(snap.troops.navy))}</dd></div><div><dt>AIR</dt><dd>{compact(displayTroops(snap.troops.air))}</dd></div>
        <div><dt>WALL</dt><dd>Lv.{snap.wallLevel}</dd></div><div><dt>WOUNDED</dt><dd>{compact(displayTroops(snap.wounded))}</dd></div><div><dt>SHIELD</dt><dd>{snap.shielded ? "ON" : "OFF"}</dd></div>
      </dl>
      <dl className="commander-card-loot">
        {(["cash", "oil", "power"] as const).map((key) => <div key={key}><dt>{key.toUpperCase()}</dt><dd style={{ color: RESOURCE_COLORS[key] }}>{compact(displayResource(snap.resources[key]))}</dd></div>)}
      </dl>
    </div>}
    {children}
  </>;
}
