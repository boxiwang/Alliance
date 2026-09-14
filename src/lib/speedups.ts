import { BUILDING_ORDER, TROOP_ORDER, project, type BKey, type GameState, type TroopKey } from "./game";
import type { SpeedupQueue } from "./mvp-items";

export type SpeedupTarget =
  | { kind: "construction"; key: BKey }
  | { kind: "research" }
  | { kind: "training"; key: TroopKey }
  | { kind: "healing" };

export function activeSpeedupTargets(game: GameState): SpeedupTarget[] {
  return [
    ...BUILDING_ORDER.filter((key) => game.buildings[key].finishAt > 0).map((key) => ({ kind: "construction", key }) as const),
    ...TROOP_ORDER.filter((key) => game.training[key].finishAt > 0).map((key) => ({ kind: "training", key }) as const),
    ...(game.researchQueue.finishAt > 0 ? [{ kind: "research" } as const] : []),
    ...(game.healing.finishAt > 0 ? [{ kind: "healing" } as const] : []),
  ];
}

export function speedupTargetId(target: SpeedupTarget): string {
  return target.kind === "construction" || target.kind === "training" ? `${target.kind}:${target.key}` : target.kind;
}

export function speedupCompatible(queue: SpeedupQueue | undefined, target: SpeedupTarget): boolean {
  return queue === "universal" || queue === target.kind;
}

export function applySpeedup(game: GameState, target: SpeedupTarget, seconds: number, now = Date.now()): { state: GameState; secondsApplied: number } {
  const next: GameState = JSON.parse(JSON.stringify(game));
  let finishAt = 0;
  const reduction = Math.max(0, Math.floor(seconds)) * 1000;
  if (target.kind === "construction") finishAt = next.buildings[target.key].finishAt;
  else if (target.kind === "training") finishAt = next.training[target.key].finishAt;
  else if (target.kind === "research") finishAt = next.researchQueue.finishAt;
  else finishAt = next.healing.finishAt;
  if (finishAt <= now || reduction <= 0) return { state: next, secondsApplied: 0 };
  const secondsApplied = Math.ceil(Math.min(reduction, finishAt - now) / 1000);
  const reducedFinish = Math.max(now, finishAt - reduction);
  if (target.kind === "construction") next.buildings[target.key].finishAt = reducedFinish;
  else if (target.kind === "training") next.training[target.key].finishAt = reducedFinish;
  else if (target.kind === "research") next.researchQueue.finishAt = reducedFinish;
  else next.healing.finishAt = reducedFinish;
  return { state: project(next, now), secondsApplied };
}
