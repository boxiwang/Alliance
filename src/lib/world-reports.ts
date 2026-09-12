// Turn a world combat/logistics report into a Comms "System" channel line.
// The starmap shows world.reports directly; this bridges the same reports into
// the System inbox so an attack/harvest result appears in both places.

import { compact } from "./format";
import { RES, RES_ORDER, displayResource, displayTroops } from "./game";
import { localWorldTargetName, type LocalWorldSession } from "./world-adapter";
import type { WorldReport } from "./world-engine";

export type SystemLine = {
  sys: "mil" | "eco" | "sec";
  tag: string;
  t: string;
  b: string;
  good: boolean;
  createdAt: number;
};

const hhmm = (ms: number) => {
  const d = new Date(ms);
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
};

export function reportSystemLine(report: WorldReport, world: LocalWorldSession["world"]): SystemLine {
  const target = localWorldTargetName(world, report.targetId);
  const t = hhmm(report.createdAt);
  const base = { t, createdAt: report.createdAt };
  const cargo = (report.payload.cargo ?? {}) as Record<string, number>;
  const delivered = RES_ORDER
    .map((r) => (cargo[r] ? `${compact(displayResource(cargo[r]))} ${RES[r].label}` : ""))
    .filter(Boolean)
    .join(" · ");

  if (report.action === "gather") {
    if (report.stage === "return") return { ...base, sys: "eco", tag: "Returned", good: true, b: `Harvest returned from ${target}${delivered ? ` · +${delivered}` : ""}` };
    if (report.outcome === "gathering_started") return { ...base, sys: "eco", tag: "Harvesting", good: true, b: `Harvest started at ${target}` };
    if (report.outcome === "gathering_completed") return { ...base, sys: "eco", tag: "Loaded", good: true, b: `Cargo loaded at ${target}` };
    return { ...base, sys: "eco", tag: "Gather", good: false, b: `${target}: ${report.outcome.split("_").join(" ")}` };
  }

  if (report.action === "scout") {
    if (report.stage === "return") return { ...base, sys: "mil", tag: "Recon", good: true, b: `Scout returned from ${target}` };
    const snap = (report.payload.snapshot ?? {}) as Record<string, unknown>;
    const might = typeof snap.might === "number" ? ` · Might ${compact(snap.might)}` : "";
    return { ...base, sys: "mil", tag: "Recon", good: report.outcome === "scouted", b: `Scouted ${target}${might}` };
  }

  // attack
  if (report.stage === "return") return { ...base, sys: "mil", tag: "Returned", good: true, b: `Fleet returned from ${target}${delivered ? ` · +${delivered}` : ""}` };
  const wounded = Number(report.payload.wounded ?? (report.payload.attackerLosses as { wounded?: number } | undefined)?.wounded ?? 0);
  const dead = Number(report.payload.dead ?? (report.payload.attackerLosses as { dead?: number } | undefined)?.dead ?? 0);
  const loss = wounded || dead ? ` · ${compact(displayTroops(wounded))} wounded, ${compact(displayTroops(dead))} dead` : "";
  if (report.outcome === "victory") return { ...base, sys: "mil", tag: "Victory", good: true, b: `Victory at ${target}${loss}` };
  if (report.outcome === "defeat") return { ...base, sys: "mil", tag: "Defeat", good: false, b: `Defeat at ${target}${loss}` };
  if (report.outcome === "target_unavailable") return { ...base, sys: "mil", tag: "Missed", good: false, b: `${target} was claimed first` };
  if (report.outcome === "defended") return { ...base, sys: "mil", tag: "Defended", good: true, b: `Held the line at ${target}${loss}` };
  return { ...base, sys: "mil", tag: "Battle", good: false, b: `${target}: ${report.outcome.split("_").join(" ")}${loss}` };
}

// Most-recent-first system lines for a player's reports.
export function playerSystemReports(session: LocalWorldSession | null, playerId: string, limit = 40): SystemLine[] {
  const player = session?.world.players[playerId];
  if (!session || !player) return [];
  return player.reportIds
    .slice()
    .reverse()
    .map((id) => session.world.reports[id])
    .filter((report): report is WorldReport => !!report)
    .slice(0, limit)
    .map((report) => reportSystemLine(report, session.world));
}
