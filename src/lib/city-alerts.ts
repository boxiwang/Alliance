import type { LiveMarch, ServerReport } from "./realtime";

export function incomingCityMarches(you: string, marches: LiveMarch[], now: number): LiveMarch[] {
  return [...new Map(marches.filter(m =>
    m.defender.toLowerCase() === you.toLowerCase() &&
    Number.isFinite(m.departAt) && Number.isFinite(m.arriveAt) &&
    m.arriveAt > m.departAt && m.arriveAt > now
  ).map(m => [m.id, m])).values()];
}

export function recentCityScan(report: ServerReport, now: number): boolean {
  return report.kind === "scouted" && now >= report.ts && now - report.ts < 4500;
}
