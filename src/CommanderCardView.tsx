import type { ReactNode } from "react";
import NameSignal from "./NameSignal";
import { compact } from "./lib/format";
import type { ChatSignalId } from "./lib/player-account";
import type { ScoutSnapshot } from "./lib/realtime";

const RESOURCE_COLORS = { cash: "#43f2a1", oil: "#ffb454", power: "#38d9ff" } as const;

/**
 * The commander card body, shared by the Star Map card and a card relayed to chat, so a
 * share looks exactly like what the sender saw: identity, plus recon rows while the
 * intel is still valid (they disappear when it expires).
 */
export default function CommanderCardView({ id, name, faction, avatar, coreLevel, signal, recon, now, children }: {
  id: string; name: string; faction: string | null; avatar: string | null | undefined; coreLevel: number;
  signal: ChatSignalId | null | undefined; recon: { snapshot: ScoutSnapshot; expiresAt: number } | null | undefined; now: number; children?: ReactNode;
}) {
  const sigil = /^[a-z0-9-]{1,24}$/.test(String(avatar || "")) ? avatar : "genesis";
  const leftMs = recon ? recon.expiresAt - now : 0;
  const snap = leftMs > 0 ? recon!.snapshot : null;
  return <>
    <header>
      <span className="commander-card-avatar">
        <span className={`command-sigil command-sigil-${sigil} commander-card-sigil`}><i /></span>
        <em aria-label={`Core ${coreLevel}`}>{coreLevel}</em>
      </span>
      <div>
        <b>{faction ? <i>[{faction}]</i> : null}<NameSignal key={id} signal={signal ?? null}>{name || "Commander"}</NameSignal></b>
        <small>CORE {coreLevel}</small>
      </div>
    </header>
    {snap && <div className="commander-card-intel" aria-label="Recon intel">
      <div className="commander-card-intel-head"><small>MIGHT</small><b>{compact(snap.might)}</b><em>INTEL · {leftMs >= 60_000 ? `${Math.ceil(leftMs / 60_000)}M` : "<1M"}</em></div>
      <dl>
        <div><dt>ARMY</dt><dd>{compact(snap.troops.army)}</dd></div><div><dt>NAVY</dt><dd>{compact(snap.troops.navy)}</dd></div><div><dt>AIR</dt><dd>{compact(snap.troops.air)}</dd></div>
        <div><dt>WALL</dt><dd>Lv.{snap.wallLevel}</dd></div><div><dt>WOUNDED</dt><dd>{compact(snap.wounded)}</dd></div><div><dt>SHIELD</dt><dd>{snap.shielded ? "ON" : "OFF"}</dd></div>
      </dl>
      <dl className="commander-card-loot">
        {(["cash", "oil", "power"] as const).map((key) => <div key={key}><dt>{key.toUpperCase()}</dt><dd style={{ color: RESOURCE_COLORS[key] }}>{compact(snap.resources[key])}</dd></div>)}
      </dl>
    </div>}
    {children}
  </>;
}
