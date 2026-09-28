import { useEffect, useRef, useState, type CSSProperties } from "react";
import type { Profile } from "./lib/profile";
import { RES, RES_ORDER, ResKey, BKey, displayResource, displayTroops } from "./lib/game";
import { compact, formatDualClock } from "./lib/format";
import BuildingGlyph from "./BuildingGlyph";
import { TITLE_SEALS, loadCosmeticVault, loadPlayerAccount } from "./lib/player-account";
import { loadShopAccount } from "./lib/backend";

const RESOURCE_COLOR: Record<ResKey, string> = {
  cash: "#43f2a1",
  oil: "#ffb454",
  power: "#38d9ff",
};
const RESOURCE_BUILDING: Record<ResKey, BKey> = { cash: "bank", oil: "oilwell", power: "powerplant" };
const RESOURCE_GAIN_DELAY: Record<ResKey, number> = { cash: 1000, oil: 2700, power: 5400 };

export default function GameNav({
  view, profile, townhallLevel, location, resources,
  incomePerHour, resourceCap,
  energy, energyCap, activeFleets, fleetCap, standing, wounded, might, credits, unread = 0, onAlliance, onCity, onWorld, onMessages, onShop = () => {}, onCredits, onProfile,
}: {
  view: "alliance" | "city" | "world" | "messages" | "shop" | "profile";
  profile: Profile;
  townhallLevel: number;
  location: string;
  resources: Record<ResKey, number>;
  incomePerHour?: Record<ResKey, number>;
  resourceCap?: number;
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
  onShop?: () => void;
  onCredits?: () => void;
  onProfile: () => void;
}) {
  const account = loadPlayerAccount(profile.address);
  const equippedTitle = TITLE_SEALS.find((seal) => seal.id === loadCosmeticVault(profile.address).equipped.title);
  const [authoritativeCredits, setAuthoritativeCredits] = useState(credits ?? account.credits);
  const [displayedCredits, setDisplayedCredits] = useState(credits ?? account.credits);
  const [creditPulse, setCreditPulse] = useState(false);
  const creditFrame = useRef(0);
  const creditPulseTimer = useRef(0);
  useEffect(() => {
    if (credits != null) { setAuthoritativeCredits(credits); return; }
    let live = true;
    void loadShopAccount(profile.address).then((result) => { if (live) setAuthoritativeCredits(result.balance); }).catch(() => {});
    return () => { live = false; };
  }, [credits, profile.address]);
  const visibleCredits = credits ?? authoritativeCredits;
  const systemReducedMotion = typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
  const quietResources = account.reducedMotion || systemReducedMotion || account.graphicsTier === "low";
  useEffect(() => {
    cancelAnimationFrame(creditFrame.current);
    window.clearTimeout(creditPulseTimer.current);
    const from = displayedCredits;
    if (visibleCredits <= from || account.reducedMotion || systemReducedMotion) {
      setDisplayedCredits(visibleCredits);
      return;
    }
    const started = performance.now();
    const duration = 760;
    setCreditPulse(true);
    const draw = (time: number) => {
      const progress = Math.min(1, (time - started) / duration);
      const eased = 1 - Math.pow(1 - progress, 3);
      setDisplayedCredits(Math.round(from + (visibleCredits - from) * eased));
      if (progress < 1) creditFrame.current = requestAnimationFrame(draw);
    };
    creditFrame.current = requestAnimationFrame(draw);
    creditPulseTimer.current = window.setTimeout(() => setCreditPulse(false), 920);
    return () => {
      cancelAnimationFrame(creditFrame.current);
      window.clearTimeout(creditPulseTimer.current);
    };
  }, [visibleCredits]);
  return (
    <nav className="command-nav" aria-label="Game view and account status">
      <div className="command-nav-head">
        <div className="command-nav-left">
        {/* Identity = the way into Profile & settings (mainstream SLG: tap your avatar).
            One button: sigil with Core badge and settings gear, [TAG] name, equipped title. */}
        <button type="button" className={`command-profile ${view === "profile" ? "active" : ""}`}
          aria-label="Open profile and settings" aria-current={view === "profile" ? "page" : undefined} onClick={onProfile}>
          <span className="command-profile-avatar">
            <span className={`command-sigil command-sigil-${profile.avatarId || "genesis"}`}><i /></span>
            <em className="command-profile-core">{townhallLevel}</em>
            <span className="command-profile-gear" aria-hidden="true">
              <svg viewBox="0 0 16 16"><path d={GEAR_PATH} fillRule="evenodd" /></svg>
            </span>
          </span>
          <span className="command-profile-text">
            <b>{profile.factionSymbol ? <i>[{profile.factionSymbol}]</i> : null}{profile.name}</b>
            {equippedTitle && <small>{equippedTitle.name.toUpperCase()}</small>}
          </span>
        </button>
        {/* Server clock reads as an instrument beside the identity, not as a control. */}
        <DualClock />
        </div>
        <div className="command-nav-controls">
          <div className="command-might"><small>MIGHT</small><b>{compact(might)}</b></div>
          <div className="command-tabs">
            <button className="soon" disabled aria-disabled="true">
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
            <button className={view === "shop" ? "active" : ""} aria-current={view === "shop" ? "page" : undefined} onClick={onShop}>
              <span>◈</span><b>SHOP</b>
            </button>
          </div>
        </div>
      </div>
      <div className="command-network">
        {RES_ORDER.map((resource) => {
          return (
            <div className="command-resource" key={resource} style={{ "--resource": RESOURCE_COLOR[resource] } as CSSProperties}>
              <span className="command-resource-icon"><BuildingGlyph building={RESOURCE_BUILDING[resource]} /></span>
              <AnimatedResource resource={resource} value={resources[resource]} rate={incomePerHour?.[resource] ?? 0} cap={resourceCap ?? Number.POSITIVE_INFINITY} quiet={quietResources} />
            </div>
          );
        })}
        <CommandMetric label="Energy" value={`${Math.floor(energy)}/${energyCap}`} tone="#aa82ff" />
        <CommandMetric label="Fleets" value={`${activeFleets}/${fleetCap}`} tone="#38d9ff" />
        <CommandMetric label="Standing" value={compact(displayTroops(standing))} tone="#43f2a1" />
        <CommandMetric label="Wounded" value={compact(displayTroops(wounded))} tone="#ff7188" />
        <button type="button" className={`command-credits${view === "shop" ? " shop-active" : ""}${creditPulse ? " bump" : ""}`} aria-label="Open Credits exchange" onClick={onCredits || onShop}><span>◇</span><div><small>{view === "shop" ? "CREDITS // AVAILABLE" : "CREDITS"}</small><b>{compact(displayedCredits)}</b></div><strong>{view === "shop" ? "+ TOP UP" : "＋"}</strong></button>
      </div>
    </nav>
  );
}

function AnimatedResource({ resource, value, rate, cap, quiet }: { resource: ResKey; value: number; rate: number; cap: number; quiet: boolean }) {
  const previous = useRef(value);
  const frame = useRef(0);
  const [displayed, setDisplayed] = useState(value);
  const [gain, setGain] = useState<{ amount: number; id: number; full: boolean } | null>(null);
  // Warehouse capacity is protection, not a wallet ceiling. Balances above it
  // remain valid and continue producing; the excess is simply raidable.
  const full = false;
  void cap;

  useEffect(() => {
    const from = previous.current;
    const delta = value - from;
    previous.current = value;

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
      setGain(null);
      return;
    }
    let interval = 0;
    const release = () => {
      if (rate <= 0 && !full) return;
      // The burst represents eight seconds of facility output. It must never
      // echo GM grants, gathers, purchases, or a server snapshot correction.
      setGain({ amount: full ? 0 : rate * 8 / 3600, id: Date.now(), full });
    };
    const timer = window.setTimeout(() => {
      release();
      interval = window.setInterval(release, 8000);
    }, RESOURCE_GAIN_DELAY[resource]);
    return () => {
      window.clearTimeout(timer);
      if (interval) window.clearInterval(interval);
    };
  }, [full, quiet, rate, resource]);

  return <div className={`command-resource-value${gain ? " is-gaining" : ""}${full ? " is-full" : ""}`}>
    <small>{RES[resource].label}</small>
    <b>{compact(displayResource(displayed))}</b>
    <span className="command-resource-rate">{full ? "FULL" : rate > 0 ? `+${compact(displayResource(rate))}/H` : "OFFLINE"}</span>
    {gain && <em key={gain.id} className={`command-resource-gain${gain.full ? " full" : ""}`} onAnimationEnd={() => setGain(null)}>{gain.full ? "CAPACITY" : `+${compact(displayResource(gain.amount))}`}</em>}
  </div>;
}

/** A proper gear: square teeth around a rim with an axle hole (drawn once, evenodd). */
const GEAR_PATH = (() => {
  const teeth = 8, rOuter = 7.4, rRoot = 5.5, hole = 2.3, c = 8;
  const point = (radius: number, angle: number) => `${(c + Math.cos(angle) * radius).toFixed(2)} ${(c + Math.sin(angle) * radius).toFixed(2)}`;
  const step = (Math.PI * 2) / teeth, half = step * .23, flank = step * .06;
  let d = "";
  for (let i = 0; i < teeth; i += 1) {
    const a = i * step;
    d += `${i ? "L" : "M"}${point(rRoot, a - half - flank)} L${point(rOuter, a - half)} L${point(rOuter, a + half)} L${point(rRoot, a + half + flank)} `;
    d += `A${rRoot} ${rRoot} 0 0 1 ${point(rRoot, a + step - half - flank)} `;
  }
  return `${d}Z M${c + hole} ${c} A${hole} ${hole} 0 1 0 ${c - hole} ${c} A${hole} ${hole} 0 1 0 ${c + hole} ${c} Z`;
})();

function DualClock() {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    let interval = 0;
    const tick = () => setNow(new Date());
    const msToNextMinute = 60000 - (Date.now() % 60000);
    const timeout = window.setTimeout(() => {
      tick();
      interval = window.setInterval(tick, 60000);
    }, msToNextMinute);
    return () => {
      window.clearTimeout(timeout);
      if (interval) window.clearInterval(interval);
    };
  }, []);
  const clock = formatDualClock(now);
  const [hh, mm] = clock.utc.split(":");
  // One ring = one server (UTC) day; the arc and the bead mark how much of it has passed.
  const dayFraction = (now.getUTCHours() * 60 + now.getUTCMinutes()) / 1440;
  const circumference = 2 * Math.PI * 10.5;
  const angle = dayFraction * Math.PI * 2 - Math.PI / 2;
  // Local time sits on the same 24-hour ring: the gap between the beads is the offset.
  const localAngle = ((now.getHours() * 60 + now.getMinutes()) / 1440) * Math.PI * 2 - Math.PI / 2;
  const offsetHours = -now.getTimezoneOffset() / 60;
  const offset = offsetHours === 0 ? "UTC" : `UTC${offsetHours > 0 ? "+" : "−"}${Math.abs(offsetHours)}`;
  return (
    <div className="command-clock" aria-label={`Server time ${clock.utc} UTC, local time ${clock.local}`}>
      <svg className="command-clock-dial" viewBox="0 0 28 28" aria-hidden="true">
        <circle className="track" cx="14" cy="14" r="10.5" />
        <circle className="arc" cx="14" cy="14" r="10.5" strokeDasharray={`${dayFraction * circumference} ${circumference}`} transform="rotate(-90 14 14)" />
        <circle className="bead local" cx={14 + Math.cos(localAngle) * 10.5} cy={14 + Math.sin(localAngle) * 10.5} r="1.4" />
        <circle className="bead" cx={14 + Math.cos(angle) * 10.5} cy={14 + Math.sin(angle) * 10.5} r="1.7" />
        <circle className="core" cx="14" cy="14" r="2.2" />
      </svg>
      <div className="command-clock-read">
        <div className="utc"><small>UTC</small><b>{hh}<i>:</i>{mm}</b></div>
        <div className="local"><small>LOCAL</small><strong>{clock.local}</strong><span>{offset}</span></div>
      </div>
    </div>
  );
}

function CommandMetric({ label, value, tone }: { label: string; value: string; tone: string }) {
  return (
    <div className="command-metric" style={{ "--resource": tone } as CSSProperties}>
      <small>{label}</small><b>{value}</b>
    </div>
  );
}
