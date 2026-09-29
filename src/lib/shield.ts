// One shield rule for every place that shows it (Star Map dome, city page lattice, card).
// COMBAT.md §9: a Core below `protectedUntilKeepLevel` is auto-shielded until it attacks;
// a shield item (`shieldUntil`) protects any Core; attacking drops both.

export function shieldActive(
  city: { keepLevel: number; hasAttacked?: boolean; shieldUntil?: number },
  now: number,
  numbers: any,
): boolean {
  if (city.hasAttacked) return false;
  const protectedUntil = Number(numbers?.global?.shield?.protectedUntilKeepLevel) || 0;
  return city.keepLevel < protectedUntil || (city.shieldUntil ?? 0) > now;
}
