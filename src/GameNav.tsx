import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import type { Profile } from "./lib/profile";
import { RES, RES_ORDER, ResKey, BKey, displayResource, displayTroops } from "./lib/game";
import { compact, formatDualClock } from "./lib/format";
import BuildingGlyph from "./BuildingGlyph";
import NameSignal from "./NameSignal";
import { TITLE_SEALS, loadCosmeticVault, loadPlayerAccount } from "./lib/player-account";
import { loadShopAccount } from "./lib/backend";
import { worldEngineConfig } from "./lib/world-engine";
import { BUFFS_CHANGED_EVENT, activeBuffs, buffTimeLeft } from "./lib/buffs";
import { getN } from "./lib/numbers";

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
  stamina, staminaCap, troops, wounded, might, credits, unread = 0, onAlliance, onCity, onWorld, onMessages, onShop = () => {}, onCredits, onProfile,
}: {
  view: "alliance" | "city" | "world" | "messages" | "shop" | "profile";
  profile: Profile;
  townhallLevel: number;
  location: string;
  resources: Record<ResKey, number>;
  incomePerHour?: Record<ResKey, number>;
  resourceCap?: number;
  stamina: number;
  staminaCap: number;
  troops: number;
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
  const equipped = loadCosmeticVault(profile.address).equipped;
  const equippedTitle = TITLE_SEALS.find((seal) => seal.id === equipped.title);
  // The equipped name signal plays once when the game opens and again on hover (throttled).
  const [signalReplay, setSignalReplay] = useState(0);
  const lastReplay = useRef(0);
  const replaySignal = () => {
    const now = Date.now();
    if (now - lastReplay.current < 2500) return;
    lastReplay.current = now; setSignalReplay((value) => value + 1);
  };
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
          aria-label="Open profile and settings" aria-current={view === "profile" ? "page" : undefined} onClick={onProfile} onMouseEnter={replaySignal}>
          <span className="command-profile-avatar">
            <span className={`command-sigil command-sigil-${profile.avatarId || "genesis"}`}><i /></span>
            <em className="command-profile-core">{townhallLevel}</em>
            <span className="command-profile-gear" aria-hidden="true">
              <svg viewBox="0 0 16 16"><path d={GEAR_PATH} fillRule="evenodd" /></svg>
            </span>
          </span>
          <span className="command-profile-text">
            <b>{profile.factionSymbol ? <i>[{profile.factionSymbol}]</i> : null}<NameSignal signal={equipped.chatSignal} replay={signalReplay} reducedMotion={account.reducedMotion}>{profile.name}</NameSignal></b>
            {equippedTitle && <small>{equippedTitle.name.toUpperCase()}</small>}
          </span>
        </button>
        {/* Server clock reads as an instrument beside the identity, not as a control. */}
        <DualClock />
        {/* Active buffs sit beside the clock (nothing shown when none is active). */}
        <BuffBar address={profile.address} coreLevel={townhallLevel} />
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
        {/* Same icon + title + amount grammar as the resources. Fleets live in Operations. */}
        <CommandMetric glyph={METRIC_GLYPH.stamina} label="Stamina" value={`${Math.floor(stamina)}/${staminaCap}`} amount={Math.floor(stamina)}
          note={stamina >= staminaCap ? "FULL" : `+${compact(3600 / worldEngineConfig().energyRegenSec)}/H`} tone="#aa82ff" />
        <CommandMetric glyph={METRIC_GLYPH.troops} label="Troops" value={compact(displayTroops(troops))} note="READY IN CITY" tone="#43f2a1" />
        <CommandMetric glyph={METRIC_GLYPH.wounded} label="Wounded" value={compact(displayTroops(wounded))} note={wounded > 0 ? "IN HOSPITAL" : "NONE"} tone="#ff7188" />
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

/** Buff bar above the nav: nothing when no buff is active; otherwise one chip per buff with
 *  its countdown (ticks every second only while something is shown). */
function BuffBar({ address, coreLevel }: { address: string; coreLevel: number }) {
  const [now, setNow] = useState(() => Date.now());
  const [, setRevision] = useState(0);
  useEffect(() => {
    const refresh = () => setRevision((value) => value + 1);
    window.addEventListener(BUFFS_CHANGED_EVENT, refresh);
    return () => window.removeEventListener(BUFFS_CHANGED_EVENT, refresh);
  }, []);
  const buffs = activeBuffs(address, coreLevel, now, getN());
  const ticking = buffs.some((buff) => buff.endsAt != null && !buff.permanent);
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), ticking ? 1000 : 30_000);
    return () => window.clearInterval(timer);
  }, [ticking]);
  if (!buffs.length) return null;
  return <div className="command-buffs" aria-label="Active buffs">
    {buffs.map((buff) => <span key={buff.id} className={`command-buff buff-${buff.id}`}>
      <svg viewBox="0 0 16 16" aria-hidden="true">{buff.id === "march"
        ? <path d="M3 3.5 7.5 8 3 12.5M8.5 3.5 13 8l-4.5 4.5" style={{ fill: "none" }} />
        : <path d="M8 1.5 13.5 3.6v4c0 3.3-2.3 5.5-5.5 6.9-3.2-1.4-5.5-3.6-5.5-6.9v-4Z" />}</svg>
      <b>{buff.label}</b>
      <em className="mono">{buffTimeLeft(buff, now)}</em>
    </span>)}
  </div>;
}

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

const METRIC_GLYPH = {
  // Stamina: a pulse line (Power already owns the lightning bolt).
  stamina: <path d="M3 12h4l2.5-6 5 12 2.5-6h4" />,
  // Troops: rank chevrons.
  troops: <path d="m5 11 7-5 7 5M5 17l7-5 7 5" />,
  wounded: <path d="M9 3h6v6h6v6h-6v6H9v-6H3V9h6V3Z" />,
};

function CommandMetric({ glyph, label, value, note, tone, amount }: { glyph: ReactNode; label: string; value: string; note: string; tone: string; amount?: number }) {
  // A jump of more than one (an item, not the slow regen tick) pops the value with a "+N" tag.
  const previous = useRef(amount);
  const [gain, setGain] = useState<{ amount: number; id: number } | null>(null);
  useEffect(() => {
    const from = previous.current;
    previous.current = amount;
    if (amount != null && from != null && amount - from > 1) setGain({ amount: amount - from, id: Date.now() });
  }, [amount]);
  return (
    <div className="command-resource command-metric-stat" style={{ "--resource": tone } as CSSProperties}>
      <span className="command-resource-icon"><svg className="building-glyph" viewBox="0 0 24 24" aria-hidden="true">{glyph}</svg></span>
      <div className={`command-resource-value${gain ? " is-gaining" : ""}`}>
        <small>{label}</small>
        <b key={`value:${gain?.id ?? 0}`}>{value}</b>
        <span className="command-resource-rate">{note}</span>
        {gain && <em key={gain.id} className="command-resource-gain" onAnimationEnd={() => setGain(null)}>+{gain.amount}</em>}
      </div>
    </div>
  );
}
