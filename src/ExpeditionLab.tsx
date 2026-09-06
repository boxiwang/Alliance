// Hidden debug lab: /?expedition — a points-and-lines test harness over src/lib/expedition.ts.
// No art: concentric rings, labeled dots (monster / gather node / rival), march lines.
// Lets us feel the engine (scout / gather / raid) against live numbers before any real UI/map.
import { useMemo, useState } from "react";
import { getN } from "./lib/numbers";
import { TROOP_ORDER, TROOPS_META, RES } from "./lib/game";
import type { TroopKey } from "./lib/game";
import {
  marchTimeSec, carryCapacity, resolveGather, resolveScout, resolveCombat,
  isShielded, gatherNodeLevelRow, nodeLevelForRing,
} from "./lib/expedition";
import type { Target, ResKey, Force } from "./lib/expedition";

function fmtDur(s: number): string {
  if (!isFinite(s)) return "∞";
  s = Math.round(s);
  if (s < 60) return s + "s";
  if (s < 3600) return Math.floor(s / 60) + "m " + (s % 60) + "s";
  if (s < 86400) return Math.floor(s / 3600) + "h " + Math.floor((s % 3600) / 60) + "m";
  return (s / 86400).toFixed(1) + "d";
}
const fmt = (n: number) => Math.round(n).toLocaleString();

interface Placed { id: string; ring: number; x: number; y: number; kind: Target["kind"]; label: string; sub: string; target: Target; }

const CENTER = 300, MAXR = 262;
const PLACE: Array<{ ring: number; ang: number; kind: Target["kind"]; res?: ResKey; keep?: number }> = [
  { ring: 10, ang: 18, kind: "node", res: "cash" },
  { ring: 10, ang: 205, kind: "monster" },
  { ring: 9, ang: 108, kind: "node", res: "oil" },
  { ring: 8, ang: 300, kind: "rival", keep: 3 },
  { ring: 7, ang: 55, kind: "node", res: "power" },
  { ring: 6, ang: 165, kind: "monster" },
  { ring: 5, ang: 250, kind: "rival", keep: 6 },
  { ring: 4, ang: 25, kind: "node", res: "cash" },
  { ring: 2, ang: 135, kind: "monster" },
  { ring: 2, ang: 320, kind: "rival", keep: 9 },
];

function buildTargets(N: any): Placed[] {
  return PLACE.map((p, i) => {
    const r = (MAXR * p.ring) / (N.world?.rings ?? 10);
    const a = (p.ang * Math.PI) / 180;
    const x = CENTER + r * Math.cos(a);
    const y = CENTER - r * Math.sin(a);
    let target: Target, label: string, sub: string;
    if (p.kind === "node") {
      const level = nodeLevelForRing(p.ring, N);
      const supply = gatherNodeLevelRow(level, N)?.totalSupply ?? 0;
      target = { kind: "node", level, resource: p.res!, remaining: supply };
      label = `${RES[p.res!].emoji} ${RES[p.res!].label} node`;
      sub = `L${level} · supply ${fmt(supply)}`;
    } else if (p.kind === "monster") {
      const level = nodeLevelForRing(p.ring, N);
      const power = Math.round(300 * Math.pow(1.6, level - 1));
      target = { kind: "monster", level, power, reward: { cash: level * 500 } };
      label = `👹 Monster`;
      sub = `L${level} · power ${fmt(power)}`;
    } else {
      const keep = p.keep!;
      const tier = Math.min(10, Math.ceil(keep / 3));
      const per = keep * 25;
      target = {
        kind: "rival", keepLevel: keep, wallLevel: Math.max(1, keep - 1), hospitalLevel: Math.max(1, keep - 2),
        troops: { army: { [tier]: per }, navy: { [tier]: Math.round(per * 0.4) }, air: { [tier]: Math.round(per * 0.2) } },
        resources: { cash: keep * 4000, oil: keep * 2500, power: keep * 2500 }, storageLevel: keep, hasAttacked: false,
      };
      label = `🏯 Rival`;
      sub = `TH${keep}` + (isShielded({ keepLevel: keep, hasAttacked: false }, N) ? " · 🛡 shielded" : "");
    }
    return { id: "t" + i, ring: p.ring, x, y, kind: p.kind, label, sub, target };
  });
}

const KIND_COLOR: Record<string, string> = { node: "#46c081", monster: "#e5593d", rival: "#e8b24c" };

export default function ExpeditionLab() {
  const N = useMemo(() => getN(), []);
  const targets = useMemo(() => buildTargets(N), [N]);
  const [selId, setSelId] = useState<string | null>(null);
  const [tier, setTier] = useState(1);
  const [counts, setCounts] = useState<Record<TroopKey, number>>({ army: 100, navy: 0, air: 0 });
  const [academy, setAcademy] = useState(1);
  const [result, setResult] = useState<any>(null);
  const [line, setLine] = useState<Placed | null>(null);

  const maxAcademy = 1 + (N.gatherNodes?.academyGatherSpeedMaxBonus ?? 0);
  const sel = targets.find((t) => t.id === selId) || null;

  const force: Force = {
    troops: TROOP_ORDER.reduce((acc, arm) => {
      if (counts[arm] > 0) acc[arm] = { [tier]: counts[arm] };
      return acc;
    }, {} as Record<TroopKey, Record<string, number>>),
  };
  const carry = carryCapacity(force, N);
  const distanceTiles = sel ? sel.ring * 3 : 0;
  const march = sel ? marchTimeSec(distanceTiles, N) : 0;

  function select(t: Placed) { setSelId(t.id); setResult(null); setLine(null); }
  function run(kind: string) {
    if (!sel) return;
    setLine(sel);
    if (kind === "scout") setResult({ type: "scout", data: resolveScout(sel.target, N) });
    else if (kind === "gather" && sel.target.kind === "node")
      setResult({ type: "gather", data: resolveGather(sel.target, carry, academy, N) });
    else if (kind === "raid")
      setResult({ type: "combat", data: resolveCombat(force, sel.target, N) });
  }

  return (
    <div className="exp">
      <header className="exp-head">
        <b>Expedition Lab</b> <span className="exp-dim">/?expedition · points & lines, no art · live numbers</span>
      </header>
      <div className="exp-body">
        <svg className="exp-map" viewBox="0 0 600 600">
          {Array.from({ length: N.world?.rings ?? 10 }, (_, i) => i + 1).map((ring) => (
            <circle key={ring} cx={CENTER} cy={CENTER} r={(MAXR * ring) / (N.world?.rings ?? 10)}
              fill="none" stroke="#26304d" strokeWidth={ring === 1 ? 1.5 : 0.7} strokeDasharray={ring === 1 ? "" : "3 5"} />
          ))}
          <text x={CENTER} y={CENTER - MAXR - 4} fill="#647293" fontSize="11" textAnchor="middle">ring 10 · edge (spawn)</text>
          <text x={CENTER} y={CENTER + 4} fill="#e8b24c" fontSize="10" textAnchor="middle">◎ Circle</text>
          {line && (
            <line x1={CENTER} y1={CENTER} x2={line.x} y2={line.y} stroke="#e8b24c" strokeWidth="1.5" strokeDasharray="5 4">
              <animate attributeName="stroke-dashoffset" from="18" to="0" dur="0.8s" repeatCount="indefinite" />
            </line>
          )}
          {/* city */}
          <circle cx={CENTER} cy={CENTER} r="9" fill="#5aa9e6" stroke="#0b1020" strokeWidth="2" />
          <text x={CENTER} y={CENTER + 22} fill="#93a1c2" fontSize="11" textAnchor="middle">Your City</text>
          {targets.map((t) => (
            <g key={t.id} onClick={() => select(t)} style={{ cursor: "pointer" }}>
              <circle cx={t.x} cy={t.y} r={selId === t.id ? 9 : 6} fill={KIND_COLOR[t.kind]}
                stroke={selId === t.id ? "#fff" : "#0b1020"} strokeWidth="2" />
              <text x={t.x} y={t.y - 12} fill="#d6ddf0" fontSize="11" textAnchor="middle">{t.label}</text>
              <text x={t.x} y={t.y + 20} fill="#647293" fontSize="9.5" textAnchor="middle">{t.sub}</text>
            </g>
          ))}
        </svg>

        <aside className="exp-panel">
          {!sel ? (
            <p className="exp-dim">Click a dot on the map — 🟢 gather node · 🔴 monster · 🟡 rival. Then pick a force and act.</p>
          ) : (
            <>
              <div className="exp-t">{sel.label} <span className="exp-dim">{sel.sub}</span></div>

              <div className="exp-sec">Your force <span className="exp-dim">carry {fmt(carry)} · march {fmtDur(march)} ({distanceTiles} tiles)</span></div>
              <div className="exp-row">
                <label>Tier</label>
                <select value={tier} onChange={(e) => setTier(Number(e.target.value))}>
                  {Array.from({ length: 10 }, (_, i) => i + 1).map((t) => <option key={t} value={t}>T{t}</option>)}
                </select>
              </div>
              {TROOP_ORDER.map((arm) => (
                <div className="exp-row" key={arm}>
                  <label>{TROOPS_META[arm].emoji} {TROOPS_META[arm].label}</label>
                  <input type="number" min={0} value={counts[arm]}
                    onChange={(e) => setCounts({ ...counts, [arm]: Math.max(0, Number(e.target.value)) })} />
                </div>
              ))}

              {sel.target.kind === "node" && (
                <div className="exp-row">
                  <label>Academy ×{academy.toFixed(2)}</label>
                  <input type="range" min={1} max={maxAcademy} step={0.05} value={academy}
                    onChange={(e) => setAcademy(Number(e.target.value))} />
                </div>
              )}

              <div className="exp-btns">
                <button onClick={() => run("scout")}>🔭 Scout</button>
                {sel.target.kind === "node" && <button onClick={() => run("gather")}>⛏️ Gather</button>}
                {(sel.target.kind === "monster" || sel.target.kind === "rival") && <button onClick={() => run("raid")}>⚔️ Raid</button>}
              </div>

              {result && <ResultView result={result} march={march} />}
            </>
          )}
        </aside>
      </div>
    </div>
  );
}

function ResultView({ result, march }: { result: any; march: number }) {
  const d = result.data;
  if (result.type === "scout")
    return <div className="exp-res"><b>Scout</b>
      <Line k="Level" v={d.level ?? "—"} /><Line k="Garrison/Power" v={d.garrison != null ? fmt(d.garrison) : "—"} />
      <Line k="Supply" v={d.supply != null ? fmt(d.supply) : "—"} /><Line k="Est. loot" v={fmt(d.estimatedLoot)} /></div>;
  if (result.type === "gather")
    return <div className="exp-res"><b>Gather</b>
      <Line k="March out" v={fmtDur(march)} /><Line k="Hauled" v={fmt(d.hauled)} />
      <Line k="Trip time" v={fmtDur(d.tripTimeSec)} /><Line k="Node left" v={fmt(d.remainingAfter)} /></div>;
  return <div className="exp-res"><b>{d.win ? "⚔️ Victory" : "💥 Defeat"}</b>
    <Line k="March" v={fmtDur(march)} /><Line k="AP / DP" v={`${fmt(d.ap)} / ${fmt(d.dp)}`} />
    <Line k="Win ratio" v={(d.winRatio * 100).toFixed(1) + "%"} /><Line k="Loot" v={fmt(d.loot)} />
    <Line k="Your losses" v={`${fmt(d.attackerLosses.wounded)} wounded / ${fmt(d.attackerLosses.dead)} dead`} />
    <Line k="Enemy losses" v={`${fmt(d.defenderLosses.wounded)} wounded / ${fmt(d.defenderLosses.dead)} dead`} /></div>;
}
function Line({ k, v }: { k: string; v: any }) {
  return <div className="exp-line"><span>{k}</span><b>{v}</b></div>;
}
