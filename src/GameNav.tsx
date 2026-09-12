import type { CSSProperties } from "react";
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

export default function GameNav({
  view, profile, townhallLevel, location, resources,
  energy, energyCap, activeFleets, fleetCap, standing, wounded, might, credits, onCity, onWorld, onMessages, onProfile,
}: {
  view: "city" | "world" | "messages" | "profile";
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
  onCity: () => void;
  onWorld: () => void;
  onMessages: () => void;
  onProfile: () => void;
}) {
  const visibleCredits = credits ?? loadPlayerAccount(profile.address).credits;
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
            <button className={view === "city" ? "active" : ""} aria-current={view === "city" ? "page" : undefined} onClick={onCity}>
              <span>▦</span><b>CITY</b>
            </button>
            <button className={view === "world" ? "active" : ""} aria-current={view === "world" ? "page" : undefined} onClick={onWorld}>
              <span>◎</span><b>STAR MAP</b>
            </button>
            <button className={view === "messages" ? "active" : ""} aria-current={view === "messages" ? "page" : undefined} onClick={onMessages}>
              <span>✉</span><b>MESSAGES</b><i className="command-unread">12</i>
            </button>
          </div>
        </div>
      </div>
      <div className="command-network">
        {RES_ORDER.map((resource) => {
          return (
            <div className="command-resource" key={resource} style={{ "--resource": RESOURCE_COLOR[resource] } as CSSProperties}>
              <span className="command-resource-icon"><BuildingGlyph building={RESOURCE_BUILDING[resource]} /></span>
              <div><small>{RES[resource].label}</small><b>{compact(displayResource(resources[resource]))}</b></div>
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

function CommandMetric({ label, value, tone }: { label: string; value: string; tone: string }) {
  return (
    <div className="command-metric" style={{ "--resource": tone } as CSSProperties}>
      <small>{label}</small><b>{value}</b>
    </div>
  );
}
