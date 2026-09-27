// Shared frame budget for the Star Map canvas layers. While the camera is moving
// (pan / wheel) every layer renders at the display rate so they stay locked to
// the grid; at rest, ambient shader motion only needs ~30fps, which halves the
// GPU work behind every other element on the page (cursor, panels, HUD).
export const worldMotion = { activeUntil: 0 };

export function markWorldMotion(ms = 450): void {
  worldMotion.activeUntil = performance.now() + ms;
}

export function worldMoving(time: number): boolean {
  return time < worldMotion.activeUntil;
}

/** True when a layer should render this rAF tick. */
export function worldFrameDue(time: number, lastDrawAt: number): boolean {
  return worldMoving(time) || time - lastDrawAt >= 32;
}
