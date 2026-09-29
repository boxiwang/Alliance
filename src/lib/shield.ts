// One shield rule for every place that shows it (Star Map dome, city page lattice, card).
// COMBAT.md §9: a Core below `protectedUntilKeepLevel` is auto-shielded until it attacks
// (attacking ends that auto-shield for good); a shield item (`shieldUntil`) protects any Core.
// Attacking also clears a running shield item at that moment (the engine zeroes
// `shieldUntil`), but a shield item raised AFTER an attack counts again.

export function shieldActive(
  city: { keepLevel: number; hasAttacked?: boolean; shieldUntil?: number },
  now: number,
  numbers: any,
): boolean {
  if ((city.shieldUntil ?? 0) > now) return true;
  const protectedUntil = Number(numbers?.global?.shield?.protectedUntilKeepLevel) || 0;
  return !city.hasAttacked && city.keepLevel < protectedUntil;
}
