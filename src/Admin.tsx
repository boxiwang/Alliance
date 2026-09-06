import { useMemo, useState } from "react";
import { getN, saveN, resetN, hasOverride } from "./lib/numbers";
import { simulateProgression } from "./lib/simulator";
import { validateNumbers, ValidationIssue } from "./lib/validation";

type Path = (string | number)[];
type View = "overview" | "buildings" | "troops" | "rules" | "advanced";

function deepClone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value));
}

function getAt(obj: any, path: Path): any {
  let current = obj;
  for (const key of path) current = current?.[key as any];
  return current;
}

function setAt(obj: any, path: Path, value: any): any {
  if (path.length === 0) return value;
  const [head, ...rest] = path;
  const next: any = Array.isArray(obj) ? [...obj] : { ...obj };
  next[head as any] = setAt(obj?.[head as any], rest, value);
  return next;
}

function humanize(value: string | number): string {
  return String(value)
    .replace(/^building\./, "")
    .replace(/^res\./, "")
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/[_-]/g, " ")
    .replace(/^./, (letter) => letter.toUpperCase());
}

const BUILDING_INFO: Record<string, { name: string; icon: string; group: string; description: string }> = {
  "building.keep": { name: "Townhall", icon: "🏰", group: "Core progression", description: "Sets the city's level cap and controls the main progression path." },
  "building.storage": { name: "Warehouse", icon: "📦", group: "Core progression", description: "Sets how many resources a player can hold and protects part of them from raids." },
  "building.bank": { name: "Bank", icon: "🏦", group: "Economy", description: "Generates Cash while the player is away." },
  "building.oilwell": { name: "Oil Well", icon: "🛢️", group: "Economy", description: "Generates Oil while the player is away." },
  "building.powerplant": { name: "Power Plant", icon: "⚡", group: "Economy", description: "Generates Power while the player is away." },
  "building.armyCamp": { name: "Army Camp", icon: "🪖", group: "Military", description: "Trains Army units. Building level unlocks Army tiers and improves Army capacity and throughput." },
  "building.navalBase": { name: "Naval Base", icon: "⚓", group: "Military", description: "Trains Navy units. Building level unlocks Navy tiers and improves Navy capacity and throughput." },
  "building.airfield": { name: "Airfield", icon: "✈️", group: "Military", description: "Trains Air units. Building level unlocks Air tiers and improves Air capacity and throughput." },
  "building.hospital": { name: "Hospital", icon: "⛑️", group: "Military", description: "Protects wounded troops from becoming permanent losses." },
  "building.wall": { name: "Wall", icon: "🧱", group: "Military", description: "Adds defensive strength when the city is raided." },
  "building.embassy": { name: "Embassy", icon: "🏛️", group: "Support", description: "Sets how many allied reinforcement troops the city can receive." },
  "building.academy": { name: "Academy", icon: "🔬", group: "Support", description: "Will control economy, development and military research." },
  "building.watchtower": { name: "Watchtower", icon: "🗼", group: "Support", description: "Will control the number of solo missions available to a player." },
  "building.milestone": { name: "Monument", icon: "🗽", group: "Support", description: "Displays server-wide progress. It is not upgraded by individual players." },
};

const BUILDING_GROUPS = ["Core progression", "Economy", "Military", "Support"];
const TROOP_INFO: Record<string, { name: string; icon: string; description: string }> = {
  "troop.army": { name: "Army", icon: "🪖", description: "Ground forces. Strong against Navy and balanced in direct combat." },
  "troop.navy": { name: "Navy", icon: "⚓", description: "Sea forces. Strong against Air and built for defensive pressure." },
  "troop.air": { name: "Air", icon: "✈️", description: "Air forces. Strong against Army and focused on attack." },
};

interface Column {
  key: string;
  label: string;
  group: string;
  cost?: boolean;
}

const BUILDING_FIELD_INFO: Record<string, { label: string; group: string }> = {
  timeSec: { label: "Build time (sec)", group: "Timing" },
  productionPerHour: { label: "Production / hour", group: "Output" },
  capacityPerResource: { label: "Storage / resource", group: "Output" },
  troopCapacity: { label: "Troop capacity", group: "Output" },
  trainQueueSize: { label: "Training queue", group: "Output" },
  trainSpeedMult: { label: "Training speed ×", group: "Output" },
  woundedCapacity: { label: "Wounded capacity", group: "Output" },
  reinforcementCapacity: { label: "Reinforcement cap", group: "Output" },
  defenseValue: { label: "Defense", group: "Output" },
  soloTaskSlots: { label: "Mission slots", group: "Output" },
  might: { label: "Cumulative Might", group: "Power" },
};

const TROOP_COLUMNS: Column[] = [
  { key: "unlockAtTrainingBuilding", label: "Training building level", group: "Unlock" },
  { key: "res.cash", label: "Cash", group: "Cost / troop", cost: true },
  { key: "res.oil", label: "Oil", group: "Cost / troop", cost: true },
  { key: "res.power", label: "Power", group: "Cost / troop", cost: true },
  { key: "trainTimeSec", label: "Seconds / troop", group: "Training" },
  { key: "attack", label: "Attack", group: "Combat" },
  { key: "defense", label: "Defense", group: "Combat" },
  { key: "power", label: "Might", group: "Combat" },
  { key: "load", label: "Carry load", group: "Combat" },
];

function columnsFor(rows: Record<string, any>, kind: "building" | "troop"): Column[] {
  if (kind === "troop") return TROOP_COLUMNS;
  const fields = Array.from(new Set(Object.values(rows ?? {}).flatMap((row: any) =>
    Object.keys(row ?? {}).filter((key) => key !== "cost"),
  )));
  return [
    { key: "res.cash", label: "Cash", group: "Upgrade cost", cost: true },
    { key: "res.oil", label: "Oil", group: "Upgrade cost", cost: true },
    { key: "res.power", label: "Power", group: "Upgrade cost", cost: true },
    ...fields.map((key) => ({ key, ...(BUILDING_FIELD_INFO[key] ?? { label: humanize(key), group: "Output" }) })),
  ];
}

function LevelTable({ title, path, rows, kind, onChange }: {
  title: string;
  path: Path;
  rows: Record<string, any>;
  kind: "building" | "troop";
  onChange: (path: Path, value: any) => void;
}) {
  const levels = Object.keys(rows ?? {}).sort((a, b) => Number(a) - Number(b));
  const columns = columnsFor(rows, kind);
  const groups = columns.reduce<{ name: string; count: number }[]>((result, column) => {
    const last = result[result.length - 1];
    if (last?.name === column.group) last.count += 1;
    else result.push({ name: column.group, count: 1 });
    return result;
  }, []);

  return (
    <div className="adm-table-wrap">
      <table className="adm-level-table">
        <thead>
          <tr className="adm-group-head">
            <th rowSpan={2}>{kind === "troop" ? "Tier" : "Level"}</th>
            {groups.map((group) => <th key={group.name} colSpan={group.count}>{group.name}</th>)}
          </tr>
          <tr>
            {columns.map((column) => <th key={column.key}>{column.label}</th>)}
          </tr>
        </thead>
        <tbody>
          {levels.map((level) => (
            <tr key={level}>
              <th>{kind === "troop" ? `T${level}` : level}</th>
              {columns.map((column) => {
                const cellPath = column.cost ? [...path, level, "cost", column.key] : [...path, level, column.key];
                const value = column.cost ? rows[level]?.cost?.[column.key] : rows[level]?.[column.key];
                return (
                  <td key={column.key}>
                    {value == null ? <span className="adm-empty">—</span> : (
                      <input
                        className="adm-cell mono"
                        type="number"
                        step="any"
                        value={value}
                        aria-label={`${title} ${kind === "troop" ? "tier" : "level"} ${level} ${column.label}`}
                        onChange={(event) => onChange(cellPath, Number(event.target.value) || 0)}
                      />
                    )}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Section({ title, subtitle, defaultOpen, children }: { title: string; subtitle?: string; defaultOpen?: boolean; children: React.ReactNode }) {
  const [open, setOpen] = useState(defaultOpen !== false);
  return (
    <div className="adm-section">
      <button className="adm-section-head" onClick={() => setOpen((value) => !value)}>
        <span className="adm-caret">{open ? "▾" : "▸"}</span>
        <span className="adm-section-title">{title}</span>
        {subtitle && <span className="adm-section-sub">{subtitle}</span>}
      </button>
      {open && <div className="adm-section-body">{children}</div>}
    </div>
  );
}

function NumberSetting({ label, help, path, numbers, onChange, suffix, scale = 1, step = 1 }: {
  label: string;
  help: string;
  path: Path;
  numbers: any;
  onChange: (path: Path, value: any) => void;
  suffix?: string;
  scale?: number;
  step?: number;
}) {
  const value = Number(getAt(numbers, path) ?? 0) * scale;
  return (
    <label className="adm-setting">
      <span><b>{label}</b><small>{help}</small></span>
      <span className="adm-setting-control">
        <input type="number" step={step} value={Number(value.toFixed(4))} onChange={(event) => onChange(path, (Number(event.target.value) || 0) / scale)} />
        {suffix && <i>{suffix}</i>}
      </span>
    </label>
  );
}

function ToggleSetting({ label, help, path, numbers, onChange }: {
  label: string;
  help: string;
  path: Path;
  numbers: any;
  onChange: (path: Path, value: any) => void;
}) {
  return (
    <label className="adm-setting">
      <span><b>{label}</b><small>{help}</small></span>
      <input className="adm-switch" type="checkbox" checked={!!getAt(numbers, path)} onChange={(event) => onChange(path, event.target.checked)} />
    </label>
  );
}

function RuleGroup({ icon, title, description, children }: { icon: string; title: string; description: string; children: React.ReactNode }) {
  return (
    <section className="adm-rule-card">
      <div className="adm-rule-title"><span>{icon}</span><div><h3>{title}</h3><p>{description}</p></div></div>
      <div className="adm-rule-fields">{children}</div>
    </section>
  );
}

function fmtDays(days: number): string {
  if (!Number.isFinite(days)) return "—";
  if (days < 1) return `${Math.round(days * 24)}h`;
  return `${days.toFixed(days < 10 ? 1 : 0)}d`;
}

const PACE_PROFILES = {
  light: { name: "Light", sessions: 1, uptime: 65, description: "Checks in once a day and often leaves a builder idle." },
  normal: { name: "Normal", sessions: 3, uptime: 85, description: "Returns a few times a day and usually keeps construction moving." },
  active: { name: "Active", sessions: 6, uptime: 95, description: "Checks frequently and keeps both builders busy." },
};

function PaceSimulator({ numbers }: { numbers: any }) {
  const [profile, setProfile] = useState<keyof typeof PACE_PROFILES | "custom">("normal");
  const [customSessions, setCustomSessions] = useState(3);
  const [customUptime, setCustomUptime] = useState(85);
  const selected = profile === "custom"
    ? { name: "Custom", sessions: customSessions, uptime: customUptime, description: "Your own play pattern." }
    : PACE_PROFILES[profile];
  const results = useMemo(() => [10, 30].map((targetLevel) => simulateProgression(numbers, {
    targetLevel,
    sessionsPerDay: selected.sessions,
    queueUptime: selected.uptime / 100,
  })), [numbers, selected.sessions, selected.uptime]);
  const longRun = results[1];
  const checkpoints = [5, 10, 15, 20, 25, 30].map((level) => ({
    level,
    days: (longRun.milestones.find((entry) => entry.level === level)?.hours ?? 0) / 24,
  }));

  return (
    <div className="adm-pace">
      <div className="adm-view-intro">
        <div><span className="adm-eyebrow">PLAYER PACING</span><h2>How long does progression feel?</h2><p>Estimate a free player's journey using city production only. Tasks, gathering, PvE and paid speedups are not included yet.</p></div>
      </div>
      <div className="adm-profile-tabs">
        {Object.entries(PACE_PROFILES).map(([key, value]) => (
          <button className={profile === key ? "on" : ""} key={key} onClick={() => setProfile(key as keyof typeof PACE_PROFILES)}><b>{value.name}</b><span>{value.sessions} visits/day</span></button>
        ))}
        <button className={profile === "custom" ? "on" : ""} onClick={() => setProfile("custom")}><b>Custom</b><span>choose your own</span></button>
      </div>
      <div className="adm-profile-note"><b>{selected.name} player</b><span>{selected.description}</span></div>
      {profile === "custom" && (
        <div className="adm-sim-controls">
          <label>Visits per day <input type="number" min="1" max="24" value={customSessions} onChange={(event) => setCustomSessions(Math.max(1, Number(event.target.value) || 1))} /></label>
          <label>Builder uptime <input type="number" min="5" max="100" value={customUptime} onChange={(event) => setCustomUptime(Math.min(100, Math.max(5, Number(event.target.value) || 5)))} />%</label>
        </div>
      )}
      <div className="adm-sim-grid">
        {results.map((result) => {
          const onTarget = result.targetLevel === 10 ? result.totalDays >= 2 && result.totalDays <= 3.1 : result.totalDays >= 120 && result.totalDays <= 150;
          return (
            <div className={`adm-sim-card ${result.deadlock ? "bad" : onTarget ? "good" : "warn"}`} key={result.targetLevel}>
              <div className="adm-sim-kicker">Reach Townhall {result.targetLevel}</div>
              <div className="adm-sim-value">{result.deadlock ? "Blocked" : fmtDays(result.totalDays)}</div>
              <div className="adm-sim-target">Goal: {result.targetLevel === 10 ? "2–3 days" : "120–150 days"}</div>
              <dl>
                <div><dt>Total construction work</dt><dd>{fmtDays(result.constructionHours / 24)}</dd></div>
                <div><dt>Waiting only for resources</dt><dd>{fmtDays(result.idleResourceHours / 24)}</dd></div>
                <div><dt>Builder utilization</dt><dd>{Math.round(result.queueUtilization * 100)}%</dd></div>
              </dl>
              {result.deadlock && <p>{result.deadlock}</p>}
            </div>
          );
        })}
      </div>
      {!longRun.deadlock && (
        <div className="adm-checkpoints">
          <div className="adm-checkpoint-title">Progress checkpoints</div>
          <div className="adm-checkpoint-track">
            {checkpoints.map((checkpoint) => <div key={checkpoint.level}><b>TH{checkpoint.level}</b><span>{fmtDays(checkpoint.days)}</span></div>)}
          </div>
        </div>
      )}
    </div>
  );
}

function ValidationPanel({ issues }: { issues: ValidationIssue[] }) {
  const errors = issues.filter((issue) => issue.severity === "error");
  const warnings = issues.filter((issue) => issue.severity === "warning");
  if (issues.length === 0) return <div className="adm-health good"><span>✓</span><div><b>All checks passed</b><small>Level tables, unlocks, storage gates and pacing are internally consistent.</small></div></div>;
  return (
    <div className={`adm-health ${errors.length ? "bad" : "warn"}`}>
      <span>{errors.length ? "!" : "△"}</span>
      <div><b>{errors.length ? `${errors.length} problem${errors.length === 1 ? "" : "s"} must be fixed` : `${warnings.length} pacing warning${warnings.length === 1 ? "" : "s"}`}</b><small>Open the details below before saving.</small></div>
      <Section title="Show details" subtitle={`${errors.length} errors · ${warnings.length} warnings`} defaultOpen={false}>
        <div className="adm-issues">{issues.map((issue, index) => <div className={`adm-issue ${issue.severity}`} key={`${issue.path}-${index}`}><span>{issue.severity}</span><code>{issue.path}</code><p>{issue.message}</p></div>)}</div>
      </Section>
    </div>
  );
}

function BuildingWorkspace({ numbers, selected, setSelected, onChange }: { numbers: any; selected: string; setSelected: (key: string) => void; onChange: (path: Path, value: any) => void }) {
  const info = BUILDING_INFO[selected];
  const building = numbers.buildings[selected];
  return (
    <div className="adm-workspace">
      <aside className="adm-side-list">
        {BUILDING_GROUPS.map((group) => <div className="adm-side-group" key={group}><h4>{group}</h4>{Object.entries(BUILDING_INFO).filter(([, value]) => value.group === group).map(([key, value]) => <button key={key} className={selected === key ? "on" : ""} onClick={() => setSelected(key)}><span>{value.icon}</span><b>{value.name}</b></button>)}</div>)}
      </aside>
      <div className="adm-work-main">
        <div className="adm-editor-head"><span>{info.icon}</span><div><span className="adm-eyebrow">{info.group}</span><h2>{info.name}</h2><p>{info.description}</p></div><div className="adm-editor-meta"><b>Unlocks at TH {building.unlockAtKeep}</b><span>{building.upgradable === false ? "Display only" : `Levels 1–${building.maxLevel}`}</span></div></div>
        {building.levels ? <LevelTable title={info.name} path={["buildings", selected, "levels"]} rows={building.levels} kind="building" onChange={onChange} /> : <div className="adm-empty-state">This building has no player-upgraded levels yet.</div>}
      </div>
    </div>
  );
}

function TroopWorkspace({ numbers, selected, setSelected, onChange }: { numbers: any; selected: string; setSelected: (key: string) => void; onChange: (path: Path, value: any) => void }) {
  const info = TROOP_INFO[selected];
  const troop = numbers.troops[selected];
  return (
    <div className="adm-workspace adm-troop-workspace">
      <aside className="adm-side-list"><div className="adm-side-group"><h4>Troop arms</h4>{Object.entries(TROOP_INFO).map(([key, value]) => <button key={key} className={selected === key ? "on" : ""} onClick={() => setSelected(key)}><span>{value.icon}</span><b>{value.name}</b></button>)}</div><div className="adm-counter-note"><b>Counter bonus +10%</b><span>Air beats Army<br />Army beats Navy<br />Navy beats Air</span></div></aside>
      <div className="adm-work-main">
        <div className="adm-editor-head"><span>{info.icon}</span><div><span className="adm-eyebrow">{troop.arm.toUpperCase()} FORCE</span><h2>{info.name}</h2><p>{info.description}</p></div><div className="adm-editor-meta"><b>T1–T10</b><span>Unlocked by its own training building</span></div></div>
        <LevelTable title={info.name} path={["troops", selected, "tiers"]} rows={troop.tiers} kind="troop" onChange={onChange} />
      </div>
    </div>
  );
}

function RulesWorkspace({ numbers, onChange }: { numbers: any; onChange: (path: Path, value: any) => void }) {
  const p = (path: Path) => ({ path, numbers, onChange });
  return (
    <div>
      <div className="adm-view-intro"><div><span className="adm-eyebrow">GAME RULES</span><h2>Rules that affect every player</h2><p>These are global knobs, not individual building levels. Change them carefully because each one affects the whole economy or combat model.</p></div></div>
      <div className="adm-rule-grid">
        <RuleGroup icon="🏗️" title="Progression & offline" description="How quickly the city can grow and how much progress continues while away.">
          <NumberSetting {...p(["global", "buildingMaxLevel"])} label="Maximum building level" help="The top level for the whole city." />
          <NumberSetting {...p(["global", "buildQueueSlots"])} label="Builders" help="How many buildings can upgrade at the same time." />
          <NumberSetting {...p(["global", "offline", "collectorCapHours"])} label="Offline collection cap" help="Production stops after this many hours away." suffix="hours" />
          <ToggleSetting {...p(["global", "buildingLevelCappedByKeep"])} label="Townhall level cap" help="Other buildings cannot exceed the Townhall." />
        </RuleGroup>
        <RuleGroup icon="💰" title="Starting economy" description="What a completely new city receives before the first action.">
          <NumberSetting {...p(["startingLayout", "startingResources", "res.cash"])} label="Starting Cash" help="Opening construction budget." />
          <NumberSetting {...p(["startingLayout", "startingResources", "res.oil"])} label="Starting Oil" help="Opening Oil balance." />
          <NumberSetting {...p(["startingLayout", "startingResources", "res.power"])} label="Starting Power" help="Opening Power balance." />
          <NumberSetting {...p(["startingLayout", "startingResources", "res.premium"])} label="Starting Gems" help="Free premium currency granted on day one." />
        </RuleGroup>
        <RuleGroup icon="🔢" title="Display scale & Might" description="Makes the economy feel large without changing its timing, and defines how internal troop batches appear to players.">
          <NumberSetting {...p(["global", "display", "resourceMultiplier"])} label="Resource display multiplier" help="Every internal Cash, Oil and Power point is shown at this scale." suffix="×" step={100} />
          <NumberSetting {...p(["global", "display", "troopMultiplier"])} label="Troop display multiplier" help="One internally trained unit represents this many visible troops and contributes Might accordingly." suffix="×" step={100} />
        </RuleGroup>
        <RuleGroup icon="⚔️" title="Raid outcomes" description="Controls loot and casualties without allowing permanent city destruction.">
          <NumberSetting {...p(["global", "combat", "lootRate"])} label="Lootable resources" help="Maximum share of unprotected resources taken in one raid." suffix="%" scale={100} step={1} />
          <NumberSetting {...p(["global", "combat", "casualtyScaling"])} label="Casualty intensity" help="How punishing a battle is before Hospital protection." suffix="%" scale={100} step={1} />
          <NumberSetting {...p(["global", "combat", "woundedRatio"])} label="Wounded instead of dead" help="Share of casualties sent to the Hospital when space exists." suffix="%" scale={100} step={1} />
          <NumberSetting {...p(["global", "combat", "keepDefenseBonusPerLevel"])} label="Townhall defense / level" help="Passive defense gained from every Townhall level." />
        </RuleGroup>
        <RuleGroup icon="🛡️" title="Protection & identity" description="New-player safety and basic account costs.">
          <NumberSetting {...p(["global", "shield", "protectedUntilKeepLevel"])} label="New-player shield ends" help="Shield remains until the player reaches this Townhall level." suffix="TH level" />
          <ToggleSetting {...p(["global", "shield", "breaksOnOffensiveAction"])} label="Attacking breaks shield" help="Players lose protection when they attack first." />
          <NumberSetting {...p(["global", "player", "rename", "subsequentCost", "res.premium"])} label="Rename after first" help="Gem price after the free rename is used." suffix="Gems" />
          <NumberSetting {...p(["global", "march", "baseTravelSecondsPerTile"])} label="Travel time / tile" help="Base world-map travel time before future bonuses." suffix="seconds" />
        </RuleGroup>
      </div>
      <Section title="Townhall prerequisite schedule" subtitle="Fixed and visible to players" defaultOpen={false}>
        <div className="adm-prereq-list">{Object.entries(numbers.townhallPrerequisites?.perLevel ?? {}).map(([level, keys]: [string, any]) => <div key={level}><b>TH{level}</b><span>{keys.map((key: string) => `${BUILDING_INFO[key]?.name ?? humanize(key)} Lv.${Number(level) - 1}`).join(" · ")}</span></div>)}</div>
      </Section>
    </div>
  );
}

function countEditableLeaves(value: any): number {
  if (value == null) return 0;
  if (typeof value === "number" || typeof value === "boolean") return 1;
  if (Array.isArray(value)) return value.reduce((sum, item) => sum + countEditableLeaves(item), 0);
  if (typeof value === "object") return (Object.values(value) as any[]).reduce((sum: number, item) => sum + countEditableLeaves(item), 0);
  return 0;
}

function RawNode({ path, value, onChange }: { path: Path; value: any; onChange: (path: Path, value: any) => void }) {
  if (typeof value === "number") return <label className="adm-row"><span className="adm-label">{humanize(path[path.length - 1])}</span><input className="adm-input mono" type="number" step="any" value={value} onChange={(event) => onChange(path, Number(event.target.value) || 0)} /></label>;
  if (typeof value === "boolean") return <label className="adm-row"><span className="adm-label">{humanize(path[path.length - 1])}</span><input className="adm-checkbox" type="checkbox" checked={value} onChange={(event) => onChange(path, event.target.checked)} /></label>;
  if (typeof value === "string") return <div className="adm-row adm-row-readonly"><span className="adm-label">{humanize(path[path.length - 1])}</span><span className="adm-string">{value}</span></div>;
  if (Array.isArray(value)) return <div className="adm-object">{value.map((item, index) => <RawNode key={index} path={[...path, index]} value={item} onChange={onChange} />)}</div>;
  if (value && typeof value === "object") return <div className="adm-object">{Object.entries(value).map(([key, item]) => <Section key={key} title={humanize(key)} defaultOpen={false}><RawNode path={[...path, key]} value={item} onChange={onChange} /></Section>)}</div>;
  return null;
}

export default function Admin() {
  const [working, setWorking] = useState<any>(() => deepClone(getN()));
  const [overrideActive, setOverrideActive] = useState(() => hasOverride());
  const [savedNote, setSavedNote] = useState("");
  const [view, setView] = useState<View>("overview");
  const [selectedBuilding, setSelectedBuilding] = useState("building.keep");
  const [selectedTroop, setSelectedTroop] = useState("troop.army");
  const validationIssues = useMemo(() => validateNumbers(working), [working]);
  const validationErrors = validationIssues.filter((issue) => issue.severity === "error");
  const leafCount = useMemo(() => countEditableLeaves(working), [working]);

  function handleChange(path: Path, value: any) {
    setWorking((previous: any) => setAt(previous, path, value));
  }

  function flash(message: string) {
    setSavedNote(message);
    window.setTimeout(() => setSavedNote(""), 2400);
  }

  function onSaveReload() {
    if (validationErrors.length) return flash(`Fix ${validationErrors.length} error${validationErrors.length === 1 ? "" : "s"} before saving.`);
    saveN(working);
    location.reload();
  }

  function onRevert() {
    setWorking(deepClone(getN()));
    setOverrideActive(hasOverride());
    flash("Unsaved changes reverted.");
  }

  function onResetDefaults() {
    resetN();
    location.reload();
  }

  function onExport() {
    const blob = new Blob([JSON.stringify(working, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = "numbers.json";
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    URL.revokeObjectURL(url);
  }

  const tabs: { key: View; label: string; icon: string }[] = [
    { key: "overview", label: "Pacing", icon: "◴" },
    { key: "buildings", label: "Buildings", icon: "▦" },
    { key: "troops", label: "Troops", icon: "⚔" },
    { key: "rules", label: "Game rules", icon: "⚙" },
    { key: "advanced", label: "Advanced", icon: "⋯" },
  ];

  return (
    <div className="admin">
      <header className="adm-toolbar">
        <div className="adm-toolbar-left"><span className="adm-title">RUGLANDS Balance Lab</span><span className="adm-subtitle">Tune progression, economy and combat without touching code.</span></div>
        <div className="adm-toolbar-right"><button className="adm-btn adm-btn-primary" onClick={onSaveReload}>Save locally</button><button className="adm-btn" onClick={onRevert}>Undo changes</button><button className="adm-btn" onClick={onExport}>Export JSON</button><button className="adm-btn adm-btn-danger" onClick={onResetDefaults}>Restore defaults</button></div>
      </header>
      <div className="adm-status"><span className={`adm-badge ${overrideActive ? "on" : ""}`}>{overrideActive ? "Local tuning active" : "Bundled defaults"}</span><span>{leafCount.toLocaleString()} editable values</span><span>Nothing is online until you export and commit it.</span>{savedNote && <span className="adm-savednote">{savedNote}</span>}</div>
      <nav className="adm-nav">{tabs.map((tab) => <button key={tab.key} className={view === tab.key ? "on" : ""} onClick={() => setView(tab.key)}><span>{tab.icon}</span>{tab.label}</button>)}</nav>
      <main className="adm-body">
        {view === "overview" && <><ValidationPanel issues={validationIssues} /><PaceSimulator numbers={working} /></>}
        {view === "buildings" && <BuildingWorkspace numbers={working} selected={selectedBuilding} setSelected={setSelectedBuilding} onChange={handleChange} />}
        {view === "troops" && <TroopWorkspace numbers={working} selected={selectedTroop} setSelected={setSelectedTroop} onChange={handleChange} />}
        {view === "rules" && <RulesWorkspace numbers={working} onChange={handleChange} />}
        {view === "advanced" && <div><div className="adm-view-intro"><div><span className="adm-eyebrow">ADVANCED</span><h2>Raw configuration</h2><p>Technical keys and internal notes live here. Most balancing work should happen in the other four pages.</p></div></div><Section title="Open raw configuration" subtitle="For uncommon fields only" defaultOpen={false}><RawNode path={[]} value={working} onChange={handleChange} /></Section></div>}
      </main>
    </div>
  );
}
