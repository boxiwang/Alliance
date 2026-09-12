import type { StrikeSignatureId } from "./lib/player-account";

export const STRIKE_EFFECT_DURATION_MS: Record<StrikeSignatureId, number> = {
  "vector-snap": 900,
  "dust-fracture": 1050,
  blockfall: 1450,
  "comet-break": 1550,
  "rift-guillotine": 2150,
  "solar-bloom": 2300,
  "finality-engine": 3150,
  "whalefall-protocol": 3600,
};

export const STRIKE_EFFECT_IDS = Object.keys(STRIKE_EFFECT_DURATION_MS) as StrikeSignatureId[];

export const STRIKE_EFFECT_STAGES: Record<StrikeSignatureId, string> = {
  "vector-snap": "LOCK · IMPACT",
  "dust-fracture": "ETCH · DISSIPATE",
  blockfall: "DESCENT · CHAIN · COLLAPSE",
  "comet-break": "ARC · IMPACT · SHARD",
  "rift-guillotine": "SEAM · CROSSCUT · AFTERSHOCK",
  "solar-bloom": "CORONA · REVERSAL · CINDER",
  "finality-engine": "QUORUM · FINALITY · SEAL",
  "whalefall-protocol": "SHADOW · GRAVITY · LEVIATHAN ECHO",
};

export const STRIKE_EFFECT_FRAME_SIZE: Record<StrikeSignatureId, number> = {
  "vector-snap": 300, "dust-fracture": 320, blockfall: 360, "comet-break": 380,
  "rift-guillotine": 440, "solar-bloom": 440, "finality-engine": 520, "whalefall-protocol": 540,
};

export const STRIKE_EFFECT_WORLD_SIZE: Record<StrikeSignatureId, number> = {
  "vector-snap": 230, "dust-fracture": 240, blockfall: 270, "comet-break": 285,
  "rift-guillotine": 340, "solar-bloom": 350, "finality-engine": 410, "whalefall-protocol": 440,
};

type PainterOptions = { bloom?: number; particleDensity?: number; seed?: number };
const TAU = Math.PI * 2;
const WHALE_FALL_POINTS: ReadonlyArray<readonly [number, number]> = [
  [-1.25, -.30], [-1.21, -.19], [-1.12, -.14], [-.80, -.13], [-.68, .06], [-.64, .22], [-.58, .24], [-.58, .32],
  [-.39, .45], [-.43, .57], [-.80, .75], [-.73, .81], [-.54, .79], [-.48, .74], [-.36, .72], [-.34, .65],
  [-.21, .63], [-.17, .54], [.07, .47], [-.02, .68], [.03, .71], [.04, .66], [.16, .61], [.24, .45],
  [.42, .42], [.85, .20], [.97, .07], [1.11, .02], [1.20, -.13], [1.08, -.34], [.77, -.44], [.47, -.45],
  [.10, -.35], [-.34, -.04], [-.47, -.04], [-.59, -.09], [-.69, -.22], [-.68, -.50], [-.79, -.64], [-.83, -.63],
  [-.86, -.35], [-.98, -.30],
];

function clamp(value: number, minimum = 0, maximum = 1): number { return Math.max(minimum, Math.min(maximum, value)); }
function lerp(from: number, to: number, progress: number): number { return from + (to - from) * progress; }
function easeOut(progress: number): number { return 1 - Math.pow(1 - clamp(progress), 3); }
function easeInOut(progress: number): number { const value = clamp(progress); return value * value * (3 - 2 * value); }
function fract(value: number): number { return value - Math.floor(value); }
function rgba(hex: string, alpha: number): string {
  const parsed = Number.parseInt(hex.slice(1), 16);
  return "rgba(" + (parsed >> 16) + "," + (parsed >> 8 & 255) + "," + (parsed & 255) + "," + clamp(alpha) + ")";
}

class StrikePainter {
  private readonly bloom: number;
  private readonly density: number;
  private readonly seed: number;

  constructor(private readonly ctx: CanvasRenderingContext2D, options: PainterOptions) {
    this.bloom = Math.max(.4, options.bloom ?? 1);
    this.density = Math.max(.5, options.particleDensity ?? 1);
    this.seed = options.seed ?? 0;
  }

  private rnd(index: number, salt = 0): number {
    return fract(Math.sin((index + this.seed * 131) * 91.733 + salt * 37.719) * 43758.5453);
  }
  private line(x1: number, y1: number, x2: number, y2: number, color: string, alpha = 1, width = 1): void {
    const c = this.ctx; c.beginPath(); c.moveTo(x1, y1); c.lineTo(x2, y2); c.strokeStyle = rgba(color, alpha); c.lineWidth = width; c.stroke();
  }
  private ring(x: number, y: number, radius: number, color: string, alpha = 1, width = 1, start = 0, end = TAU): void {
    const c = this.ctx; c.beginPath(); c.arc(x, y, Math.max(.1, radius), start, end); c.strokeStyle = rgba(color, alpha); c.lineWidth = width; c.stroke();
  }
  private ellipse(x: number, y: number, rx: number, ry: number, rotation: number, color: string, alpha = 1, width = 1): void {
    const c = this.ctx; c.beginPath(); c.ellipse(x, y, Math.max(.1, rx), Math.max(.1, ry), rotation, 0, TAU); c.strokeStyle = rgba(color, alpha); c.lineWidth = width; c.stroke();
  }
  private glow(x: number, y: number, radius: number, color: string, alpha: number): void {
    const c = this.ctx, gradient = c.createRadialGradient(x, y, 0, x, y, Math.max(1, radius));
    gradient.addColorStop(0, rgba(color, alpha)); gradient.addColorStop(.3, rgba(color, alpha * .42)); gradient.addColorStop(1, rgba(color, 0));
    c.fillStyle = gradient; c.beginPath(); c.arc(x, y, radius, 0, TAU); c.fill();
  }
  private diamond(x: number, y: number, size: number, color: string, alpha = 1, fill = false): void {
    const c = this.ctx; c.beginPath(); c.moveTo(x, y - size); c.lineTo(x + size, y); c.lineTo(x, y + size); c.lineTo(x - size, y); c.closePath();
    if (fill) { c.fillStyle = rgba(color, alpha * .28); c.fill(); } c.lineWidth = 1; c.strokeStyle = rgba(color, alpha); c.stroke();
  }
  private spark(x: number, y: number, size: number, color: string, alpha: number, angle = 0): void {
    this.line(x - Math.cos(angle) * size, y - Math.sin(angle) * size, x + Math.cos(angle) * size, y + Math.sin(angle) * size, color, alpha, 1.1);
  }
  private withGlow(color: string, blur: number, draw: () => void): void {
    const c = this.ctx; c.save(); c.shadowColor = color; c.shadowBlur = blur * this.bloom; draw(); c.restore();
  }

  vectorSnap(p: number): void {
    const lock = easeOut(p / .46), gap = lerp(90, 31, lock), flash = 1 - clamp(Math.abs(p - .5) / .12), after = clamp((p - .48) / .52);
    this.withGlow("#58dfff", 9, () => {
      for (let i = 0; i < 4; i += 1) {
        const sx = i % 2 ? -1 : 1, sy = i < 2 ? -1 : 1, x = sx * gap, y = sy * gap;
        this.line(x, y, x - sx * 17, y, "#58dfff", .75); this.line(x, y, x, y - sy * 17, "#58dfff", .75);
      }
      this.diamond(0, 0, 3 + flash * 9, "#e8fbff", .75, flash > .25);
      if (after > 0) this.ring(0, 0, 28 + after * 76, "#58dfff", (1 - after) * .65, 1.5);
    });
    for (let i = 0; i < 8; i += 1) {
      const angle = i * Math.PI / 4, radius = 34 + after * 46; this.ctx.fillStyle = rgba("#b9f3ff", (1 - after) * .7);
      this.ctx.beginPath(); this.ctx.arc(Math.cos(angle) * radius, Math.sin(angle) * radius, 1.2, 0, TAU); this.ctx.fill();
    }
  }

  dustFracture(p: number): void {
    const cut = easeOut(p / .48), fade = 1 - clamp((p - .7) / .3); this.glow(0, 0, 50, "#c8a06a", .16 * fade);
    this.withGlow("#e4c795", 5, () => {
      for (let i = 0; i < 7; i += 1) {
        const angle = i * TAU / 7 + this.rnd(i, 3) * .5, length = (28 + this.rnd(i, 5) * 50) * cut;
        this.ctx.beginPath(); this.ctx.moveTo(0, 0);
        for (let step = 1; step <= 5; step += 1) {
          const distance = length * step / 5, offset = (this.rnd(i * 10 + step, 7) - .5) * 8;
          this.ctx.lineTo(Math.cos(angle) * distance + Math.cos(angle + Math.PI / 2) * offset, Math.sin(angle) * distance + Math.sin(angle + Math.PI / 2) * offset);
        }
        this.ctx.strokeStyle = rgba("#d8b982", .7 * fade); this.ctx.lineWidth = i % 2 ? 1 : 1.5; this.ctx.stroke();
        if (i % 2 === 0) { const bx = Math.cos(angle) * length * .63, by = Math.sin(angle) * length * .63; this.line(bx, by, bx + Math.cos(angle + .7) * length * .22, by + Math.sin(angle + .7) * length * .22, "#b9905d", .45 * fade); }
      }
    });
    for (let i = 0; i < 12; i += 1) {
      const rise = clamp((p - .25 - this.rnd(i, 8) * .18) / .65), angle = this.rnd(i, 2) * TAU, radius = 8 + this.rnd(i, 4) * 48;
      this.ctx.fillStyle = rgba(i % 3 ? "#c8a06a" : "#e5d2ae", (1 - rise) * .45); this.ctx.beginPath();
      this.ctx.arc(Math.cos(angle) * radius + Math.sin(rise * 4 + i) * 3, Math.sin(angle) * radius - rise * 38, 1 + this.rnd(i, 9) * 1.4, 0, TAU); this.ctx.fill();
    }
  }

  blockfall(p: number): void {
    const collapse = easeInOut(clamp((p - .53) / .24)), after = clamp((p - .68) / .32), points: Array<[number, number, number]> = [];
    for (let i = 0; i < 5; i += 1) {
      const angle = -Math.PI / 2 + i * TAU / 5, tx = Math.cos(angle) * 58, ty = Math.sin(angle) * 38, drop = easeOut(clamp((p - i * .055) / .42));
      points.push([lerp(tx, 0, collapse), lerp(-150 - this.rnd(i, 2) * 45, ty, drop) * (1 - collapse), drop]);
    }
    if (p > .3) { this.ctx.save(); this.ctx.setLineDash([3, 4]); for (let i = 0; i < 5; i += 1) { const a = points[i], b = points[(i + 1) % 5]; this.line(a[0], a[1], b[0], b[1], "#4ff0d0", .32 * (1 - collapse)); } this.ctx.restore(); }
    points.forEach((point, index) => {
      const scale = (1 - collapse) * (.82 + point[2] * .18), color = index % 2 ? "#4ff0d0" : "#58dfff";
      this.ctx.save(); this.ctx.translate(point[0], point[1]); this.ctx.rotate(.785 + p * 1.2 * (index % 2 ? 1 : -1));
      this.withGlow(color, 10, () => { this.ctx.fillStyle = rgba(color, .13 * point[2]); this.ctx.strokeStyle = rgba(color, .8 * point[2]); this.ctx.lineWidth = 1.2; this.ctx.fillRect(-9 * scale, -9 * scale, 18 * scale, 18 * scale); this.ctx.strokeRect(-9 * scale, -9 * scale, 18 * scale, 18 * scale); });
      this.ctx.restore();
    });
    if (collapse > 0) { this.glow(0, 0, 48, "#4ff0d0", .33 * (1 - after)); this.diamond(0, 0, 18 * (1 - collapse) + 4, "#efffff", 1 - after, true); }
    if (after > 0) { this.ring(0, 0, 25 + after * 105, "#4ff0d0", (1 - after) * .68, 1.8); this.ring(0, 0, 16 + after * 72, "#58dfff", (1 - after) * .5); }
    for (let i = 0; i < 24 * this.density; i += 1) { const angle = this.rnd(i, 4) * TAU, radius = (12 + after * 92) * this.rnd(i, 8); this.ctx.fillStyle = rgba(i % 2 ? "#4ff0d0" : "#58dfff", (1 - after) * .5); this.ctx.fillRect(Math.cos(angle) * radius, Math.sin(angle) * radius, 1.5, 1.5); }
  }

  cometBreak(p: number): void {
    const impact = .47, travel = clamp(p / impact), burst = clamp((p - impact) / (1 - impact));
    const point = (t: number) => ({ x: (1 - t) * (1 - t) * -170 + 2 * (1 - t) * t * -65, y: (1 - t) * (1 - t) * -92 + 2 * (1 - t) * t * -108 });
    if (p < impact) {
      for (let i = 18; i >= 0; i -= 1) { const pt = point(clamp(travel - i * .022)), alpha = (1 - i / 19) * .72; this.glow(pt.x, pt.y, 3 + i * .42, i % 4 === 0 ? "#f3c46b" : "#58dfff", alpha * .38); }
      const head = point(travel); this.withGlow("#dfffff", 15, () => { this.ctx.fillStyle = "#efffff"; this.ctx.beginPath(); this.ctx.arc(head.x, head.y, 4, 0, TAU); this.ctx.fill(); });
    }
    if (burst > 0) {
      this.glow(0, 0, 70, "#f3c46b", .35 * (1 - burst)); this.ring(0, 0, 18 + burst * 105, "#58dfff", (1 - burst) * .55, 1.4);
      for (let i = 0; i < 30 * this.density; i += 1) {
        const angle = -1.9 + this.rnd(i, 2) * 3.7, radius = (28 + this.rnd(i, 4) * 105) * easeOut(burst), curve = (i % 2 ? 1 : -1) * burst * burst * 24;
        this.ctx.save(); this.ctx.translate(Math.cos(angle) * radius + Math.cos(angle + 1.57) * curve, Math.sin(angle) * radius + burst * burst * 32); this.ctx.rotate(angle + burst * 4);
        this.ctx.fillStyle = rgba(i % 4 === 0 ? "#f3c46b" : "#bdf6ff", (1 - burst) * .8); this.ctx.fillRect(-2, -.7, 4 + this.rnd(i, 6) * 3, 1.4); this.ctx.restore();
      }
    }
  }

  riftGuillotine(p: number): void {
    const first = easeInOut(p / .3), second = easeInOut(clamp((p - .28) / .28)), collapse = clamp((p - .53) / .2), after = clamp((p - .66) / .34), span = 190;
    const seam = (angle: number, progress: number, color: string) => {
      this.ctx.save(); this.ctx.rotate(angle); this.ctx.beginPath(); this.ctx.rect(-span - 12, -18, span * 2 + 24, 36); this.ctx.clip(); const reach = span * progress;
      this.withGlow(color, 18, () => { this.line(-reach, 0, reach, 0, color, .92, 2.1); this.line(-reach, -3, reach, 2, "#e9d6ff", .35); }); this.line(-reach, 0, reach, 0, "#020108", 1, 5); this.ctx.restore();
    };
    if (first > 0) seam(-.56, first, "#ad70ff"); if (second > 0) seam(.77, second, "#6fdfff");
    if (p > .18 && p < .72) for (let i = 0; i < 9; i += 1) { const radius = 42 + i * 12, shift = Math.sin(i * 2.1 + p * 18) * 5 * (1 - after); this.ctx.save(); this.ctx.translate(shift, 0); this.ring(0, 0, radius, "#ad70ff", .055 * (1 - after), 1, Math.PI * .12, Math.PI * 1.88); this.ctx.restore(); }
    if (collapse > 0) { this.glow(0, 0, 90, "#7b35e8", .3 * (1 - after)); const radius = lerp(26, 4, easeInOut(collapse)); this.ctx.fillStyle = rgba("#030007", .95); this.ctx.beginPath(); this.ctx.arc(0, 0, radius, 0, TAU); this.ctx.fill(); this.withGlow("#e5c9ff", 20, () => this.ring(0, 0, radius + 2, "#d9b5ff", .92 * (1 - after), 1.6)); }
    if (after > 0) {
      this.ring(0, 0, 25 + after * 145, "#ad70ff", (1 - after) * .75, 2); this.ring(0, 0, 18 + after * 96, "#6fdfff", (1 - after) * .52);
      for (let i = 0; i < 58 * this.density; i += 1) { const angle = this.rnd(i, 7) * TAU, radius = (15 + this.rnd(i, 3) * 145) * easeOut(after), tangent = (this.rnd(i, 11) - .5) * 28 * after; this.ctx.fillStyle = rgba(i % 4 === 0 ? "#6fdfff" : "#bd8aff", (1 - after) * .7); this.ctx.fillRect(Math.cos(angle) * radius + Math.cos(angle + 1.57) * tangent, Math.sin(angle) * radius + Math.sin(angle + 1.57) * tangent, 1.4, 1.4); }
    }
  }

  solarBloom(p: number): void {
    const open = easeOut(clamp(p / .48)), reverse = easeInOut(clamp((p - .5) / .23)), after = clamp((p - .68) / .32), reach = lerp(8, 82, open) * (1 - reverse * .82);
    this.glow(0, 0, 100, "#ff9e2e", (.12 + .16 * open) * (1 - after));
    for (let i = 0; i < 8; i += 1) {
      this.ctx.save(); this.ctx.rotate(i * TAU / 8 + p * .16); this.ctx.beginPath(); this.ctx.moveTo(7, 0);
      this.ctx.bezierCurveTo(reach * .35, -16 - open * 11, reach * .76, -20, reach, 0); this.ctx.bezierCurveTo(reach * .76, 20, reach * .35, 16 + open * 11, 7, 0); this.ctx.closePath();
      const gradient = this.ctx.createLinearGradient(0, 0, reach, 0); gradient.addColorStop(0, rgba("#fff1aa", .58)); gradient.addColorStop(.46, rgba(i % 2 ? "#f3c46b" : "#ff7f36", .28)); gradient.addColorStop(1, rgba("#ff7f36", 0));
      this.ctx.fillStyle = gradient; this.ctx.fill(); this.ctx.strokeStyle = rgba("#ffd77e", .6 * (1 - after)); this.ctx.lineWidth = 1; this.ctx.stroke(); this.ctx.restore();
    }
    if (reverse > 0) for (let i = 0; i < 8; i += 1) { const angle = i * TAU / 8, far = lerp(90, 9, reverse); this.line(Math.cos(angle) * far, Math.sin(angle) * far, Math.cos(angle) * 12, Math.sin(angle) * 12, "#fff2b8", reverse * (1 - after), 1.7); }
    const flash = 1 - clamp(Math.abs(p - .7) / .09); if (flash > 0) { this.glow(0, 0, 120, "#fff2ba", flash * .8); this.ctx.fillStyle = rgba("#fffbe8", flash); this.ctx.beginPath(); this.ctx.arc(0, 0, 5 + flash * 13, 0, TAU); this.ctx.fill(); }
    if (after > 0) { this.ring(0, 0, 25 + after * 135, "#f3c46b", (1 - after) * .6, 1.5); for (let i = 0; i < 68 * this.density; i += 1) { const angle = this.rnd(i, 2) * TAU, radius = (10 + this.rnd(i, 6) * 128) * easeOut(after), fall = after * after * (18 + this.rnd(i, 9) * 36); this.glow(Math.cos(angle) * radius, Math.sin(angle) * radius + fall, 1.2 + this.rnd(i, 8) * 2, i % 5 === 0 ? "#fff1aa" : "#ff9238", (1 - after) * .42); } }
  }

  finalityEngine(p: number): void {
    const colors = ["#58dfff", "#4ff0d0", "#f3c46b"];
    for (let level = 0; level < 3; level += 1) {
      const progress = easeInOut(clamp((p - level * .12) / .23)), radius = 52 + level * 31, nodes = 6 + level * 3, rotation = (level % 2 ? 1 : -1) * p * .55;
      if (progress <= 0) continue; this.ctx.save(); this.ctx.rotate(rotation); this.withGlow(colors[level], 10 + level * 3, () => this.ring(0, 0, radius, colors[level], .2 + .48 * progress, 1.1 + level * .25, -Math.PI / 2, -Math.PI / 2 + TAU * progress));
      for (let i = 0; i < nodes; i += 1) { const angle = i * TAU / nodes - Math.PI / 2; if (progress < i / nodes * .9) continue; const x = Math.cos(angle) * radius, y = Math.sin(angle) * radius; this.ctx.fillStyle = rgba(colors[level], .85); this.ctx.beginPath(); this.ctx.arc(x, y, level === 2 ? 2.6 : 2, 0, TAU); this.ctx.fill(); if (level === 2 && i % 3 === 0) this.diamond(x, y, 4, "#fff1bd", .8); }
      this.ctx.restore();
    }
    const pull = clamp((p - .38) / .26), release = clamp((p - .62) / .22);
    for (let i = 0; i < 112 * this.density; i += 1) { const angle = this.rnd(i, 5) * TAU, base = 35 + this.rnd(i, 8) * 155, inward = lerp(base, 6, easeInOut(pull)), outward = release * (30 + this.rnd(i, 3) * 150), spin = pull * (i % 2 ? 1 : -1) * 1.2; this.ctx.fillStyle = rgba(i % 7 === 0 ? "#f3c46b" : i % 3 === 0 ? "#4ff0d0" : "#a9eaff", release ? 1 - release : .2 + .55 * pull); this.ctx.fillRect(Math.cos(angle + spin) * (inward + outward), Math.sin(angle + spin) * (inward + outward * .58), 1.4 + (i % 9 === 0 ? 1.5 : 0), 1.4); }
    if (pull > 0) { for (let i = 0; i < 5; i += 1) this.ellipse(0, 0, 26 + i * 7, 8 + i * 2.3, p * .9 + i * .34, i % 2 ? "#f3c46b" : "#ad70ff", (.16 + .09 * i) * (1 - release), 1.2); this.glow(0, 0, 100, "#f3c46b", .2 * (1 - release)); this.ctx.fillStyle = "#010102"; this.ctx.beginPath(); this.ctx.arc(0, 0, lerp(5, 22, pull) * (1 - release * .55), 0, TAU); this.ctx.fill(); }
    if (release > 0) { this.ring(0, 0, 28 + release * 178, "#f3c46b", (1 - release) * .75, 2.2); this.ring(0, 0, 22 + release * 128, "#58dfff", (1 - release) * .55, 1.1); }
    const seal = easeOut(clamp((p - .72) / .18)), fade = 1 - clamp((p - .94) / .06); if (seal > 0) { this.ctx.save(); this.ctx.scale(seal, seal); this.ctx.rotate(Math.PI / 4); this.withGlow("#f3c46b", 16, () => { this.ctx.strokeStyle = rgba("#f3c46b", .9 * fade); this.ctx.lineWidth = 1.5; this.ctx.strokeRect(-24, -24, 48, 48); this.ctx.strokeRect(-17, -17, 34, 34); }); this.ctx.rotate(-Math.PI / 4); this.ctx.fillStyle = rgba("#fff0ba", .92 * fade); this.ctx.textAlign = "center"; this.ctx.font = "500 11px ui-monospace"; this.ctx.fillText("FINAL", 0, 4); this.ctx.restore(); }
  }

  private whaleShadowPath(scale: number): void {
    const c = this.ctx; c.beginPath(); c.moveTo(-.58 * scale, -.03 * scale); c.bezierCurveTo(-.18 * scale, -.35 * scale, .42 * scale, -.34 * scale, .73 * scale, -.1 * scale); c.bezierCurveTo(.94 * scale, .01 * scale, .87 * scale, .17 * scale, .58 * scale, .23 * scale); c.bezierCurveTo(.18 * scale, .34 * scale, -.32 * scale, .24 * scale, -.61 * scale, .07 * scale); c.bezierCurveTo(-.77 * scale, .2 * scale, -.96 * scale, .26 * scale, -1.1 * scale, .16 * scale); c.bezierCurveTo(-.96 * scale, .02 * scale, -.82 * scale, -.02 * scale, -.66 * scale, -.045 * scale); c.bezierCurveTo(-.84 * scale, -.09 * scale, -1.01 * scale, -.2 * scale, -1.11 * scale, -.32 * scale); c.bezierCurveTo(-.91 * scale, -.36 * scale, -.72 * scale, -.24 * scale, -.58 * scale, -.03 * scale); c.closePath();
  }
  private whaleFallPath(scale: number): void {
    const c = this.ctx, points = WHALE_FALL_POINTS, count = points.length; c.beginPath(); c.moveTo(points[0][0] * scale, points[0][1] * scale);
    for (let i = 0; i < count; i += 1) { const p0 = points[(i - 1 + count) % count], p1 = points[i], p2 = points[(i + 1) % count], p3 = points[(i + 2) % count]; c.bezierCurveTo((p1[0] + (p2[0] - p0[0]) / 6) * scale, (p1[1] + (p2[1] - p0[1]) / 6) * scale, (p2[0] - (p3[0] - p1[0]) / 6) * scale, (p2[1] - (p3[1] - p1[1]) / 6) * scale, p2[0] * scale, p2[1] * scale); }
    c.closePath();
  }
  private drawWhaleShadow(x: number, y: number, scale: number, alpha: number): void {
    const c = this.ctx; c.save(); c.translate(x, y); c.rotate(-.1); c.filter = "blur(" + Math.max(2, scale * .035) + "px)"; c.shadowColor = rgba("#72d8ff", alpha * .8); c.shadowBlur = 34 * this.bloom;
    const gradient = c.createLinearGradient(-scale, 0, scale, 0); gradient.addColorStop(0, rgba("#132845", 0)); gradient.addColorStop(.24, rgba("#122b4b", alpha * .58)); gradient.addColorStop(.7, rgba("#050b17", alpha)); gradient.addColorStop(1, rgba("#315476", alpha * .18)); c.fillStyle = gradient; this.whaleShadowPath(scale); c.fill(); c.restore();
  }
  private drawWhaleConstellation(scale: number, alpha: number, expand: number): void {
    const c = this.ctx, colors = ["#72d8ff", "#b9e8ff", "#f3c46b", "#ad70ff", "#4ff0d0"]; c.save(); c.translate(0, -2); c.rotate(-.035); c.scale(1 + expand * .12, 1 + expand * .07); c.globalCompositeOperation = "lighter";
    c.save(); this.whaleFallPath(scale); c.clip();
    for (let i = 0; i < 196 * this.density; i += 1) {
      const x = lerp(-1.28, 1.21, this.rnd(i, 21)) * scale, y = lerp(-.66, .82, this.rnd(i, 22)) * scale, size = 1.2 + this.rnd(i, 23) * 3.8, color = colors[i % colors.length], twinkle = .72 + .28 * Math.sin(i * 2.7 + expand * 9);
      if (i % 7 === 0) this.withGlow(color, 10, () => { this.ring(x, y, size * 1.8, color, alpha * .68 * twinkle); for (let spoke = 0; spoke < 6; spoke += 1) this.spark(x, y, size * 2.5, color, alpha * .42 * twinkle, spoke * Math.PI / 3); });
      else if (i % 3 === 0) this.diamond(x, y, size, color, alpha * .72 * twinkle, true);
      else { c.fillStyle = rgba(color, alpha * .68 * twinkle); c.beginPath(); c.arc(x, y, size * .62, 0, TAU); c.fill(); if (i % 5 === 0) this.glow(x, y, size * 2.6, color, alpha * .25); }
    }
    c.restore(); c.setLineDash([2, 7]); this.withGlow("#72d8ff", 19, () => { c.strokeStyle = rgba("#c7efff", alpha * .62); c.lineWidth = 1.35; this.whaleFallPath(scale); c.stroke(); }); c.setLineDash([]);
    this.glow(.78 * scale, -.08 * scale, 5.5, "#f3c46b", alpha * .86); this.diamond(.78 * scale, -.08 * scale, 2.2, "#fff1bd", alpha, true); c.restore();
  }
  whalefallProtocol(p: number): void {
    const approach = easeInOut(clamp(p / .43)), capture = easeInOut(clamp((p - .2) / .43)), well = clamp((p - .47) / .25), after = clamp((p - .66) / .34), whaleScale = 165;
    if (p < .54) { const x = lerp(-245, whaleScale * .95, approach), y = -35 + Math.sin(approach * Math.PI) * 16, visibility = Math.sin(clamp(p / .54) * Math.PI) * .92; this.glow(x, y, whaleScale * 1.2, "#173d67", .075 * visibility); this.drawWhaleShadow(x, y, whaleScale, .66 * visibility); for (let i = 0; i < 7; i += 1) this.ellipse(x - i * 14, y, whaleScale * (.54 + i * .055), whaleScale * (.12 + i * .018), -.1, "#4978a0", .045 * visibility * (1 - capture)); }
    for (let i = 0; i < 148 * this.density; i += 1) { const angle = this.rnd(i, 4) * TAU, base = 30 + this.rnd(i, 7) * 190, elliptic = .54 + this.rnd(i, 9) * .24, spin = capture * (i % 2 ? 1 : -1) * 1.55; let radius = lerp(base, 8, capture); if (after > 0) radius = lerp(8, 30 + this.rnd(i, 5) * 175, easeOut(after)); const color = i % 9 === 0 ? "#f3c46b" : i % 3 === 0 ? "#72d8ff" : "#7086d8"; this.glow(Math.cos(angle + spin) * radius, Math.sin(angle + spin) * radius * elliptic + (after ? Math.sin(i * .9) * after * 18 : 0), 1 + this.rnd(i, 11) * 2.4, color, (after ? 1 - after * .62 : .18 + .5 * capture) * .52); }
    if (capture > 0) { for (let i = 0; i < 9; i += 1) { const wobble = Math.sin(p * 13 + i) * 2; this.ellipse(0, 0, 32 + i * 9 + wobble, 8 + i * 2.5, p * 1.15 + i * .27, i % 3 === 0 ? "#f3c46b" : i % 2 ? "#72d8ff" : "#7b65d8", (.075 + i * .016) * (1 - after * .7), 1.1); } this.glow(0, 0, 125, "#315e9b", .24 * (1 - after * .5)); }
    if (well > 0) { this.ctx.fillStyle = rgba("#010207", .98); this.ctx.beginPath(); this.ctx.arc(0, 0, 7 + well * 22, 0, TAU); this.ctx.fill(); this.withGlow("#72d8ff", 20, () => this.ellipse(0, 0, 31 + well * 10, 9 + well * 3, p * 1.2, "#72d8ff", .72 * (1 - after), 1.7)); this.withGlow("#f3c46b", 14, () => this.ellipse(0, 0, 34 + well * 12, 7 + well * 4, -p * .9, "#f3c46b", .6 * (1 - after), 1.35)); }
    if (after > 0) { this.ring(0, 0, 30 + after * 190, "#72d8ff", (1 - after) * .62, 1.8); this.ring(0, 0, 22 + after * 142, "#f3c46b", (1 - after) * .34, 1.1); const echo = easeOut(clamp((p - .7) / .1)) * (1 - clamp((p - .94) / .06)); if (echo > 0) this.drawWhaleConstellation(190, echo, after); for (let i = 0; i < 24; i += 1) { const angle = this.rnd(i, 14) * TAU, radius = 55 + this.rnd(i, 16) * 155; this.glow(Math.cos(angle) * radius * after, Math.sin(angle) * radius * .58 * after, 1.4 + (i % 5 === 0 ? 2 : 0), i % 4 === 0 ? "#f3c46b" : "#b9e8ff", (1 - after) * .42); } }
  }
}

export function drawStrikeEffect(ctx: CanvasRenderingContext2D, id: StrikeSignatureId, progress: number, x: number, y: number, scale = 1, options: PainterOptions = {}): void {
  const painter = new StrikePainter(ctx, options), bounded = clamp(progress); ctx.save(); ctx.translate(x, y); ctx.scale(scale, scale); ctx.globalCompositeOperation = "lighter";
  if (id === "vector-snap") painter.vectorSnap(bounded);
  else if (id === "dust-fracture") painter.dustFracture(bounded);
  else if (id === "blockfall") painter.blockfall(bounded);
  else if (id === "comet-break") painter.cometBreak(bounded);
  else if (id === "rift-guillotine") painter.riftGuillotine(bounded);
  else if (id === "solar-bloom") painter.solarBloom(bounded);
  else if (id === "finality-engine") painter.finalityEngine(bounded);
  else painter.whalefallProtocol(bounded);
  ctx.restore();
}

export function drawStrikePreviewBackdrop(ctx: CanvasRenderingContext2D, width: number, height: number, time: number): void {
  const gradient = ctx.createRadialGradient(width * .5, height * .44, 0, width * .5, height * .44, width * .68);
  gradient.addColorStop(0, "#071325"); gradient.addColorStop(.5, "#030916"); gradient.addColorStop(1, "#01040b"); ctx.fillStyle = gradient; ctx.fillRect(0, 0, width, height);
  for (let i = 0; i < 86; i += 1) { const x = fract(Math.sin(i * 91.733 + 71) * 43758.5453) * width, y = fract(Math.sin(i * 37.21 + 19) * 53191.51) * height, radius = .35 + fract(Math.sin(i * 17.8) * 9991) * 1.1; ctx.fillStyle = "rgba(188,230,255," + (.16 + .34 * (.5 + .5 * Math.sin(time * .001 + i))) + ")"; ctx.beginPath(); ctx.arc(x, y, radius, 0, TAU); ctx.fill(); }
  ctx.strokeStyle = "rgba(88,223,255,.045)"; ctx.lineWidth = 1; const step = Math.max(28, width / 13);
  for (let x = 0; x < width; x += step) { ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, height); ctx.stroke(); }
  for (let y = 0; y < height; y += step * .72) { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(width, y); ctx.stroke(); }
}

export function drawStrikePreviewTarget(ctx: CanvasRenderingContext2D, x: number, y: number, radius: number, dim = 0): void {
  const glow = ctx.createRadialGradient(x, y, 0, x, y, radius * 3); glow.addColorStop(0, rgba("#4e7da0", .18 * (1 - dim))); glow.addColorStop(1, rgba("#4e7da0", 0)); ctx.fillStyle = glow; ctx.beginPath(); ctx.arc(x, y, radius * 3, 0, TAU); ctx.fill();
  const body = ctx.createRadialGradient(x - radius * .35, y - radius * .38, 1, x, y, radius); body.addColorStop(0, "#8ab4ca"); body.addColorStop(.28, "#31556e"); body.addColorStop(.72, "#101e32"); body.addColorStop(1, "#040812"); ctx.fillStyle = body; ctx.beginPath(); ctx.arc(x, y, radius, 0, TAU); ctx.fill();
  ctx.save(); ctx.translate(x, y); ctx.rotate(-.18); ctx.strokeStyle = "rgba(109,220,244,.42)"; ctx.lineWidth = 1; ctx.beginPath(); ctx.ellipse(0, 0, radius * 1.48, radius * .37, 0, 0, TAU); ctx.stroke(); ctx.restore();
}

type CachedFrame = { canvas: HTMLCanvasElement; touched: number };
export const STRIKE_EFFECT_FRAME_BUCKETS: Record<StrikeSignatureId, number> = {
  "vector-snap": 10,
  "dust-fracture": 10,
  blockfall: 12,
  "comet-break": 12,
  "rift-guillotine": 14,
  "solar-bloom": 14,
  "finality-engine": 18,
  "whalefall-protocol": 18,
};
const frameCache = new Map<string, CachedFrame>();
const cachedEffects = new Set<StrikeSignatureId>();
let cacheHits = 0, cacheMisses = 0;
let frameGenerationBudget = 2;
let cacheBytes = 0;

export function strikeEffectFrameKey(id: StrikeSignatureId, progress: number): string {
  const frame = Math.round(clamp(progress) * (STRIKE_EFFECT_FRAME_BUCKETS[id] - 1));
  return id + ":" + frame;
}

function frameKey(id: StrikeSignatureId, frame: number): string { return id + ":" + frame; }

function cachedFrameAt(id: StrikeSignatureId, frame: number, permitFirstForEffect = true): HTMLCanvasElement | null {
  const key = frameKey(id, frame), existing = frameCache.get(key);
  if (existing) { cacheHits += 1; existing.touched = performance.now(); return existing.canvas; }
  cacheMisses += 1;
  if (frameGenerationBudget <= 0 && (!permitFirstForEffect || cachedEffects.has(id))) return nearestCachedFrame(id, frame);
  if (frameGenerationBudget > 0) frameGenerationBudget -= 1;
  const size = STRIKE_EFFECT_FRAME_SIZE[id], canvas = document.createElement("canvas"); canvas.width = size; canvas.height = size;
  const progress = frame / Math.max(1, STRIKE_EFFECT_FRAME_BUCKETS[id] - 1);
  const ctx = canvas.getContext("2d", { alpha: true })!; drawStrikeEffect(ctx, id, progress, size / 2, size / 2, 1, { bloom: 1, particleDensity: 1 });
  frameCache.set(key, { canvas, touched: performance.now() }); cachedEffects.add(id); cacheBytes += size * size * 4;
  return canvas;
}

function nearestCachedFrame(id: StrikeSignatureId, frame: number): HTMLCanvasElement | null {
  const count = STRIKE_EFFECT_FRAME_BUCKETS[id];
  for (let distance = 1; distance < count; distance += 1) {
    const before = frameCache.get(frameKey(id, frame - distance));
    if (before) { before.touched = performance.now(); return before.canvas; }
    const after = frameCache.get(frameKey(id, frame + distance));
    if (after) { after.touched = performance.now(); return after.canvas; }
  }
  return null;
}

/** Reset once per compositor tick. At most this many new high-detail frames are
 * rasterized synchronously; an effect with no cached frame may always seed one. */
export function beginStrikeFrameCacheBudget(maxNewFrames = 2): void {
  frameGenerationBudget = Math.max(0, Math.floor(maxNewFrames));
}

export function drawCachedStrikeEffect(ctx: CanvasRenderingContext2D, id: StrikeSignatureId, progress: number, x: number, y: number, scale = 1): void {
  const bounded = clamp(progress), position = bounded * (STRIKE_EFFECT_FRAME_BUCKETS[id] - 1);
  const lowerIndex = Math.floor(position), upperIndex = Math.min(STRIKE_EFFECT_FRAME_BUCKETS[id] - 1, lowerIndex + 1), mix = position - lowerIndex;
  const lower = cachedFrameAt(id, lowerIndex), upper = upperIndex === lowerIndex ? lower : cachedFrameAt(id, upperIndex, false);
  const size = STRIKE_EFFECT_WORLD_SIZE[id] * scale, left = x - size / 2, top = y - size / 2;
  if (!lower && !upper) return;
  if (!lower || !upper || lower === upper) { ctx.drawImage(lower || upper!, left, top, size, size); return; }
  const priorAlpha = ctx.globalAlpha;
  ctx.globalAlpha = priorAlpha * (1 - mix); ctx.drawImage(lower, left, top, size, size);
  ctx.globalAlpha = priorAlpha * mix; ctx.drawImage(upper, left, top, size, size);
  ctx.globalAlpha = priorAlpha;
}

export function strikeFrameCacheStats(): { entries: number; hits: number; misses: number; bytes: number } {
  return { entries: frameCache.size, hits: cacheHits, misses: cacheMisses, bytes: cacheBytes };
}

export function clearStrikeFrameCache(): void { frameCache.clear(); cachedEffects.clear(); cacheHits = 0; cacheMisses = 0; cacheBytes = 0; }
