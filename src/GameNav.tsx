import { useEffect, useRef, useState, type CSSProperties } from "react";
import type { Profile } from "./lib/profile";
import { RES, RES_ORDER, ResKey, BKey, displayResource, displayTroops } from "./lib/game";
import { compact } from "./lib/format";
import BuildingGlyph from "./BuildingGlyph";
import { loadPlayerAccount } from "./lib/player-account";

const RESOURCE_COLOR: Record<ResKey, string> = {
  cash: "#43f2a1",
  oil: "#ffb454",
  power: "#38d9ff",
};
const RESOURCE_BUILDING: Record<ResKey, BKey> = { cash: "bank", oil: "oilwell", power: "powerplant" };
const RESOURCE_GAIN_DELAY: Record<ResKey, number> = { cash: 1000, oil: 2700, power: 5400 };

export default function GameNav({
  view, profile, townhallLevel, location, resources,
  energy, energyCap, activeFleets, fleetCap, standing, wounded, might, credits, unread = 0, onAlliance, onCity, onWorld, onMessages, onProfile,
}: {
  view: "alliance" | "city" | "world" | "messages" | "profile";
  profile: Profile;
  townhallLevel: number;
  location: string;
  resources: Record<ResKey, number>;
  energy: number;
  energyCap: number;
  activeFleets: number;
  fleetCap: number;
  standing: number;
  wounded: number;
  might: number;
  credits?: number;
  /** Real unread count for the Messages tab (DMs + System; Cosmos never counts). */
  unread?: number;
  onAlliance: () => void;
  onCity: () => void;
  onWorld: () => void;
  onMessages: () => void;
  onProfile: () => void;
}) {
  const account = loadPlayerAccount(profile.address);
  const visibleCredits = credits ?? account.credits;
  const systemReducedMotion = typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
  const quietResources = account.reducedMotion || systemReducedMotion || account.graphicsTier === "low";
  return (
    <nav className="command-nav" aria-label="Game view and account status">
      <div className="command-nav-head">
        <div className="command-identity-wrap">
          <button type="button" className={`command-sigil command-sigil-${profile.avatarId || "genesis"} ${view === "profile" ? "active" : ""}`} aria-label="Open commander archive" aria-current={view === "profile" ? "page" : undefined} onClick={onProfile}><i /></button>
          <div className="command-identity">
            <span>ALLIANCE // CIV-{profile.address.slice(-3).toUpperCase()}</span>
            <div><b>{profile.name}</b><em>CORE {townhallLevel}</em></div>
            <small>{location}{profile.factionSymbol ? ` · $${profile.factionSymbol}` : ""}</small>
          </div>
        </div>
        <div className="command-nav-controls">
          <div className="command-might"><small>MIGHT</small><b>{compact(might)}</b></div>
          <div className="command-tabs">
            <button className="soon" disabled aria-disabled="true" title="Alliances arrive with shared multiplayer — coming soon">
              <span>◇</span><b>ALLIANCE</b><em className="soon-tag">SOON</em>
            </button>
            <button className={view === "city" ? "active" : ""} aria-current={view === "city" ? "page" : undefined} onClick={onCity}>
              <span>▦</span><b>CITY</b>
            </button>
            <button className={view === "world" ? "active" : ""} aria-current={view === "world" ? "page" : undefined} onClick={onWorld}>
              <span>◎</span><b>STAR MAP</b>
            </button>
            <button className={view === "messages" ? "active" : ""} aria-current={view === "messages" ? "page" : undefined} onClick={onMessages}>
              <span>✉</span><b>MESSAGES</b>{unread > 0 ? <i className="command-unread">{unread > 99 ? "99+" : unread}</i> : null}
            </button>
          </div>
        </div>
      </div>
      <div className="command-network">
        {RES_ORDER.map((resource) => {
          return (
            <div className="command-resource" key={resource} style={{ "--resource": RESOURCE_COLOR[resource] } as CSSProperties}>
              <span className="command-resource-icon"><BuildingGlyph building={RESOURCE_BUILDING[resource]} /></span>
              <AnimatedResource resource={resource} value={resources[resource]} quiet={quietResources} />
            </div>
          );
        })}
        <CommandMetric label="Energy" value={`${Math.floor(energy)}/${energyCap}`} tone="#aa82ff" />
        <CommandMetric label="Fleets" value={`${activeFleets}/${fleetCap}`} tone="#38d9ff" />
        <CommandMetric label="Standing" value={compact(displayTroops(standing))} tone="#43f2a1" />
        <CommandMetric label="Wounded" value={compact(displayTroops(wounded))} tone="#ff7188" />
        <button type="button" className="command-credits" aria-label="Open Credits exchange"><span>◇</span><div><small>CREDITS</small><b>{compact(visibleCredits)}</b></div><strong>＋</strong></button>
      </div>
    </nav>
  );
}

function AnimatedResource({ resource, value, quiet }: { resource: ResKey; value: number; quiet: boolean }) {
  const previous = useRef(value);
  const accumulated = useRef(0);
  const frame = useRef(0);
  const [displayed, setDisplayed] = useState(value);
  const [gain, setGain] = useState<{ amount: number; id: number } | null>(null);

  useEffect(() => {
    const from = previous.current;
    const delta = value - from;
    previous.current = value;
    if (delta > 0) accumulated.current += delta;

    cancelAnimationFrame(frame.current);
    if (quiet || value <= from) {
      setDisplayed(value);
      return;
    }
    const started = performance.now();
    const duration = 440;
    const draw = (time: number) => {
      const progress = Math.min(1, (time - started) / duration);
      const eased = 1 - Math.pow(1 - progress, 3);
      setDisplayed(from + delta * eased);
      if (progress < 1) frame.current = requestAnimationFrame(draw);
    };
    frame.current = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(frame.current);
  }, [quiet, value]);

  useEffect(() => {
    if (quiet) {
      accumulated.current = 0;
      setGain(null);
      return;
    }
    let interval = 0;
    const release = () => {
      const amount = accumulated.current;
      if (amount <= 0) return;
      accumulated.current = 0;
      setGain({ amount, id: Date.now() });
    };
    const timer = window.setTimeout(() => {
      release();
      interval = window.setInterval(release, 8000);
    }, RESOURCE_GAIN_DELAY[resource]);
    return () => {
      window.clearTimeout(timer);
      if (interval) window.clearInterval(interval);
    };
  }, [quiet, resource]);

  return <div className={`command-resource-value${gain ? " is-gaining" : ""}`}>
    <small>{RES[resource].label}</small>
    <b>{compact(displayResource(displayed))}</b>
    {gain && <em key={gain.id} className="command-resource-gain" onAnimationEnd={() => setGain(null)}>+{compact(displayResource(gain.amount))}</em>}
  </div>;
}

function CommandMetric({ label, value, tone }: { label: string; value: string; tone: string }) {
  return (
    <div className="command-metric" style={{ "--resource": tone } as CSSProperties}>
      <small>{label}</small><b>{value}</b>
    </div>
  );
}
