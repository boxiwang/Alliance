// Auto-pick for speedups (owner rule, 2026-09-28):
// - Default to the LARGEST speedup that does not exceed the time left
//   (1h05m left -> the 1h speedup), preferring a queue-specific item over a Universal
//   one of the same size (Universals are the flexible ones to keep).
// - When a speedup is chosen, the count defaults to as many as fit in the time left
//   without going over (1h05m with 5m speedups -> 13), at least 1, at most owned.
// - After each use the next pick is made again from the new time left
//   (1h06m: 1h -> then 5m -> then 1m).
// If even the smallest owned speedup is longer than the time left, that smallest one is
// picked (a single item finishes the queue).

export type OwnedSpeedup = { id: string; seconds: number; universal: boolean; owned: number };

export function autoSpeedupCount(item: Pick<OwnedSpeedup, "seconds" | "owned">, remainingSec: number): number {
  if (item.owned <= 0 || item.seconds <= 0) return 0;
  return Math.max(1, Math.min(item.owned, Math.floor(remainingSec / item.seconds)));
}

export function autoSpeedupPick(owned: OwnedSpeedup[], remainingSec: number): { id: string; quantity: number } | null {
  const usable = owned.filter((item) => item.owned > 0 && item.seconds > 0);
  if (!usable.length || remainingSec <= 0) return null;
  const rank = (a: OwnedSpeedup, b: OwnedSpeedup) => b.seconds - a.seconds || Number(a.universal) - Number(b.universal);
  const fitting = usable.filter((item) => item.seconds <= remainingSec).sort(rank);
  const chosen = fitting[0] ?? [...usable].sort((a, b) => a.seconds - b.seconds || Number(a.universal) - Number(b.universal))[0];
  return { id: chosen.id, quantity: autoSpeedupCount(chosen, remainingSec) };
}
