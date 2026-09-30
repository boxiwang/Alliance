import { WARP_ARRIVAL_MS, WARP_LANDING_MS, drawWarpArrival } from "./WorldArrivalLayer";
import type { WarpSignatureId } from "./lib/player-account";

/**
 * Warp Arrival signatures (Relic Vault cosmetics). Each one is a pure 2D-canvas draw of the
 * light around the landing point; the Star Map draws the city itself and reveals it at
 * `revealMs` (the moment the effect "delivers" it), which is also when the blackout lifts.
 * Designs: docs/cosmetics/warp-arrivals.html.
 */
export type WarpSignatureFx = {
  durationMs: number;
  revealMs: number;
  draw: (ctx: CanvasRenderingContext2D, x: number, y: number, radius: number, elapsedMs: number, seed: string) => void;
};

const TAU = Math.PI * 2;
const clamp = (v: number, a = 0, b = 1) => Math.max(a, Math.min(b, v));
const seg = (t: number, a: number, b: number) => clamp((t - a) / (b - a));
const outCubic = (x: number) => 1 - Math.pow(1 - x, 3);
const inCubic = (x: number) => x * x * x;
const outExpo = (x: number) => (x >= 1 ? 1 : 1 - Math.pow(2, -10 * x));

function rng(seed: string) {
  let h = 2166136261;
  for (let i = 0; i < seed.length; i += 1) h = Math.imul(h ^ seed.charCodeAt(i), 16777619);
  return () => { h = Math.imul(h ^ (h >>> 15), 2246822507); h = Math.imul(h ^ (h >>> 13), 3266489909); return ((h ^= h >>> 16) >>> 0) / 4294967296; };
}

function glow(ctx: CanvasRenderingContext2D, x: number, y: number, rad: number, stops: [number, string][], alpha = 1) {
  if (alpha <= 0 || rad <= 0) return;
  const g = ctx.createRadialGradient(x, y, 0, x, y, rad);
  for (const [o, c] of stops) g.addColorStop(o, c);
  ctx.save(); ctx.globalAlpha = alpha; ctx.globalCompositeOperation = "lighter"; ctx.fillStyle = g;
  ctx.beginPath(); ctx.arc(x, y, rad, 0, TAU); ctx.fill(); ctx.restore();
}

function ring(ctx: CanvasRenderingContext2D, x: number, y: number, rad: number, width: number, color: string, alpha: number) {
  if (alpha <= 0 || rad <= 0) return;
  ctx.save(); ctx.globalAlpha = alpha; ctx.strokeStyle = color; ctx.lineWidth = width;
  ctx.shadowColor = color; ctx.shadowBlur = width * 4;
  ctx.beginPath(); ctx.arc(x, y, rad, 0, TAU); ctx.stroke(); ctx.restore();
}

/** A bright stand-in for the city while an effect carries it in (the real city appears at reveal). */
function orb(ctx: CanvasRenderingContext2D, x: number, y: number, r: number, alpha: number, tint = "120,220,255") {
  glow(ctx, x, y, r * 1.8, [[0, `rgba(255,255,255,${alpha})`], [.35, `rgba(${tint},${.7 * alpha})`], [1, `rgba(${tint},0)`]]);
}

// A · Wormhole Fold (SSR): a violet vortex opens, the city spins out, the hole snaps shut.
const wormholeFold: WarpSignatureFx = {
  durationMs: 2100, revealMs: 1150,
  draw(ctx, x, y, r, t, seed) {
    const open = outCubic(seg(t, 0, 700)), close = inCubic(seg(t, 1250, 1600));
    const R = r * 2.3 * open * (1 - close), rot = t * .0035;
    if (R > 1) {
      ctx.save(); ctx.globalCompositeOperation = "lighter"; ctx.lineCap = "round";
      for (let arm = 0; arm < 5; arm += 1) {
        const base = rot + arm * TAU / 5;
        let px = 0, py = 0;
        for (let i = 0; i <= 36; i += 1) {
          const s = i / 36, th = base + s * 1.55 * Math.PI, rr = R * (1 - s * .66);
          const nx = x + Math.cos(th) * rr, ny = y + Math.sin(th) * rr * .9;
          if (i) {
            ctx.strokeStyle = arm % 2 ? `rgba(160,120,255,${.12 + .75 * s})` : `rgba(100,215,255,${.1 + .65 * s})`;
            ctx.lineWidth = r * (.03 + .16 * s);
            ctx.beginPath(); ctx.moveTo(px, py); ctx.lineTo(nx, ny); ctx.stroke();
          }
          px = nx; py = ny;
        }
      }
      const random = rng(seed);
      for (let i = 0; i < 40; i += 1) {
        const k = (t * .00045 + i / 40 + random() * .02) % 1, th = i * 2.39996 + k * 5 + rot, rr = R * (1.05 - k * .7);
        ctx.fillStyle = `rgba(220,200,255,${.2 + .7 * k})`;
        ctx.beginPath(); ctx.arc(x + Math.cos(th) * rr, y + Math.sin(th) * rr * .9, .6 + k * 1.4, 0, TAU); ctx.fill();
      }
      ctx.restore();
      if (t < 1150) { ctx.fillStyle = "rgba(3,2,12,.9)"; ctx.beginPath(); ctx.arc(x, y, R * .34, 0, TAU); ctx.fill(); }
      ring(ctx, x, y, R * .36, r * .07, "#d6c2ff", .9);
      glow(ctx, x, y, R * 1.2, [[0, "rgba(120,80,255,0)"], [.35, "rgba(120,80,255,.22)"], [1, "rgba(120,80,255,0)"]]);
    }
    const emerge = seg(t, 650, 1250);
    if (emerge > 0 && emerge < 1) orb(ctx, x, y, r * (.3 + .9 * outCubic(emerge)), Math.sin(Math.PI * emerge), "190,160,255");
    const f = seg(t, 1560, 2000);
    if (f > 0 && f < 1) {
      glow(ctx, x, y, r * 3.2, [[0, "rgba(255,255,255,.95)"], [.25, "rgba(200,170,255,.55)"], [1, "rgba(120,80,255,0)"]], 1 - outCubic(f));
      ring(ctx, x, y, r * (1.1 + 2.6 * outCubic(f)), r * .09 * (1 - f) + 1, "#c9b0ff", 1 - f);
    }
  },
};

// B · Hyperspace Drop (SR): light converges, the city streaks in and brakes with a shock ring.
const hyperspaceDrop: WarpSignatureFx = {
  durationMs: 1750, revealMs: 700,
  draw(ctx, x, y, r, t, seed) {
    const random = rng(seed);
    const lines = Array.from({ length: 40 }, () => ({ off: (random() - .5) * 2, d: random(), len: random() * .6 + .4, w: random() * 1.4 + .4 }));
    const sparks = Array.from({ length: 30 }, () => ({ a: (random() - .5) * 1.5, v: random() * .8 + .5, s: random() * 1.8 + .6 }));
    const dx = Math.cos(-.32), dy = Math.sin(-.32), px = -dy, py = dx, land = 700;
    ctx.save(); ctx.globalCompositeOperation = "lighter";
    const lineP = seg(t, 60, 640);
    if (lineP > 0 && lineP < 1) {
      for (const L of lines) {
        const travel = (lineP * 1.6 + L.d) % 1, dist = (1 - outCubic(travel)) * r * 9, len = r * 2.4 * L.len * (1 - travel * .6);
        const hx = x - dx * dist + px * L.off * r * 1.3 * (1 - travel), hy = y - dy * dist + py * L.off * r * 1.3 * (1 - travel);
        const g = ctx.createLinearGradient(hx, hy, hx - dx * len, hy - dy * len);
        g.addColorStop(0, `rgba(210,245,255,${.8 * (1 - travel * .5)})`); g.addColorStop(1, "rgba(56,217,255,0)");
        ctx.strokeStyle = g; ctx.lineWidth = L.w; ctx.beginPath(); ctx.moveTo(hx, hy); ctx.lineTo(hx - dx * len, hy - dy * len); ctx.stroke();
      }
    }
    const come = seg(t, 480, land);
    if (t >= 480 && come < 1) {
      const back = (1 - outExpo(come)) * r * 7, cx = x - dx * back, cy = y - dy * back;
      const g = ctx.createLinearGradient(cx, cy, cx - dx * r * 6, cy - dy * r * 6);
      g.addColorStop(0, "rgba(220,250,255,.95)"); g.addColorStop(1, "rgba(56,217,255,0)");
      ctx.strokeStyle = g; ctx.lineWidth = r * 1.3 * (1 - come * .3); ctx.lineCap = "round";
      ctx.beginPath(); ctx.moveTo(cx, cy); ctx.lineTo(cx - dx * r * 6, cy - dy * r * 6); ctx.stroke();
      orb(ctx, cx, cy, r * .9, 1);
    }
    const b = seg(t, land, land + 700);
    if (b > 0 && b < 1) {
      glow(ctx, x, y, r * 2.6, [[0, "rgba(255,255,255,.9)"], [.3, "rgba(120,230,255,.45)"], [1, "rgba(56,217,255,0)"]], 1 - outCubic(seg(t, land, land + 380)));
      ctx.save(); ctx.translate(x, y); ctx.rotate(Math.atan2(dy, dx)); ctx.globalAlpha = 1 - b;
      ctx.strokeStyle = "#8fe9ff"; ctx.lineWidth = r * .08 * (1 - b) + 1; ctx.shadowColor = "#38d9ff"; ctx.shadowBlur = r * .4;
      const R = r * (1.1 + 2.8 * outCubic(b));
      ctx.beginPath(); ctx.ellipse(r * .4 * b, 0, R * .55, R, 0, 0, TAU); ctx.stroke();
      const bar = ctx.createLinearGradient(0, -r * 5, 0, r * 5);
      bar.addColorStop(0, "rgba(56,217,255,0)"); bar.addColorStop(.5, "rgba(230,250,255,.9)"); bar.addColorStop(1, "rgba(56,217,255,0)");
      ctx.fillStyle = bar; ctx.globalAlpha = (1 - outCubic(b)) * .8; ctx.fillRect(-r * .05, -r * 5, r * .1, r * 10);
      ctx.restore();
      for (const s of sparks) {
        const ang = Math.atan2(dy, dx) + s.a, d = r * (1 + 3.4 * s.v * outCubic(b));
        ctx.fillStyle = `rgba(200,245,255,${1 - b})`;
        ctx.beginPath(); ctx.arc(x + Math.cos(ang) * d, y + Math.sin(ang) * d, s.s * (1 - b * .6), 0, TAU); ctx.fill();
      }
    }
    ctx.restore();
  },
};

// C · Phase Assembly (SSR): hex lock-on, particles stream in, a scan line prints the city.
const phaseAssembly: WarpSignatureFx = {
  durationMs: 2300, revealMs: 1380,
  draw(ctx, x, y, r, t, seed) {
    const hexIn = outCubic(seg(t, 0, 450)), hexOut = seg(t, 1700, 2200), flash = seg(t, 1550, 1800);
    const hexA = hexIn * (1 - hexOut) * (.45 + .55 * Math.sin(flash * Math.PI));
    if (hexA > 0) {
      const s = r * .42; ctx.save(); ctx.lineWidth = 1;
      for (let q = -6; q <= 6; q += 1) for (let rr = -6; rr <= 6; rr += 1) {
        const hx = x + s * 1.5 * q, hy = y + s * Math.sqrt(3) * (rr + q / 2), d = Math.hypot(hx - x, hy - y) / (r * 2.6);
        if (d > 1) continue;
        ctx.strokeStyle = `rgba(94,240,208,${hexA * (1 - d) * .55})`;
        ctx.beginPath();
        for (let k = 0; k < 6; k += 1) { const a = k * Math.PI / 3, vx = hx + Math.cos(a) * s * .92, vy = hy + Math.sin(a) * s * .92; if (k) ctx.lineTo(vx, vy); else ctx.moveTo(vx, vy); }
        ctx.closePath(); ctx.stroke();
      }
      ctx.restore();
    }
    const lock = outCubic(seg(t, 80, 600)), lockOut = seg(t, 1800, 2200);
    if (lock > 0 && lockOut < 1) {
      const b = r * (2.6 - 1.05 * lock), L = r * .45;
      ctx.save(); ctx.globalAlpha = lock * (1 - lockOut); ctx.strokeStyle = "#5ef0d0"; ctx.lineWidth = 2; ctx.shadowColor = "#5ef0d0"; ctx.shadowBlur = 8;
      for (const [sx, sy] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
        ctx.beginPath(); ctx.moveTo(x + sx * b, y + sy * (b - L)); ctx.lineTo(x + sx * b, y + sy * b); ctx.lineTo(x + sx * (b - L), y + sy * b); ctx.stroke();
      }
      ctx.lineWidth = 1.5; ctx.beginPath(); ctx.arc(x, y, r * 1.35, -Math.PI / 2, -Math.PI / 2 + TAU * outCubic(seg(t, 150, 900))); ctx.stroke();
      ctx.restore();
    }
    const pp = seg(t, 350, 1400);
    if (pp > 0 && t < 1650) {
      const random = rng(seed);
      ctx.save(); ctx.globalCompositeOperation = "lighter";
      for (let i = 0; i < 140; i += 1) {
        const ta = random() * TAU, td = Math.sqrt(random()), sa = random() * TAU, sd = 2.2 + random() * 1.8, delay = random() * .35, size = random() * 1.3 + .6;
        const k = outCubic(clamp((pp - delay) / (1 - delay)));
        if (k <= 0) continue;
        const sx = x + Math.cos(sa) * r * sd, sy = y + Math.sin(sa) * r * sd, tx = x + Math.cos(ta) * r * td * .95, ty = y + Math.sin(ta) * r * td * .95;
        const swirl = (1 - k) * 1.2;
        ctx.fillStyle = `rgba(150,255,230,${.85 * (1 - seg(t, 1350, 1650))})`;
        ctx.beginPath(); ctx.arc(sx + (tx - sx) * k + Math.cos(sa + Math.PI / 2) * swirl * r * .5, sy + (ty - sy) * k + Math.sin(sa + Math.PI / 2) * swirl * r * .5, size, 0, TAU); ctx.fill();
      }
      ctx.restore();
    }
    const wire = seg(t, 700, 1200), print = seg(t, 1100, 1650);
    if (wire > 0 && print < 1) {
      ctx.save(); ctx.globalAlpha = wire * (1 - print * .8); ctx.strokeStyle = "#7ff5dc"; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.arc(x, y, r, 0, TAU); ctx.stroke();
      for (let i = 1; i < 4; i += 1) { ctx.beginPath(); ctx.ellipse(x, y, r * i / 4, r, 0, 0, TAU); ctx.stroke(); ctx.beginPath(); ctx.ellipse(x, y, r, r * i / 4, 0, 0, TAU); ctx.stroke(); }
      ctx.restore();
    }
    if (print > 0 && print < 1) {
      const edge = y - r * 1.25 + r * 2.6 * outCubic(print);
      ctx.save(); ctx.globalCompositeOperation = "lighter";
      const g = ctx.createLinearGradient(x - r * 1.5, 0, x + r * 1.5, 0);
      g.addColorStop(0, "rgba(94,240,208,0)"); g.addColorStop(.5, "rgba(210,255,245,.95)"); g.addColorStop(1, "rgba(94,240,208,0)");
      ctx.fillStyle = g; ctx.fillRect(x - r * 1.5, edge - 1.5, r * 3, 3); ctx.restore();
    }
    const pulse = seg(t, 1620, 2150);
    if (pulse > 0 && pulse < 1) ring(ctx, x, y, r * (1.05 + 1.9 * outCubic(pulse)), 2, "#5ef0d0", 1 - pulse);
  },
};

// D · Singularity Bloom (UR): matter falls into a pinpoint, a nova, the city is born of the light.
const singularityBloom: WarpSignatureFx = {
  durationMs: 2000, revealMs: 780,
  draw(ctx, x, y, r, t, seed) {
    const random = rng(seed), nova = 720;
    const inflow = Array.from({ length: 80 }, () => ({ a: random() * TAU, d: 2.4 + random() * 2.4, delay: random() * .4, s: random() * 1.4 + .5 }));
    const dust = Array.from({ length: 60 }, () => ({ a: random() * TAU, v: .6 + random() * .9, s: random() * 1.6 + .5 }));
    const inP = seg(t, 0, nova);
    if (t < nova) {
      ctx.save(); ctx.globalCompositeOperation = "lighter";
      for (const p of inflow) {
        const k = inCubic(clamp((inP - p.delay) / (1 - p.delay))), d = r * p.d * (1 - k), a = p.a + k * 1.4;
        ctx.strokeStyle = `rgba(255,214,140,${.25 + .6 * k})`; ctx.lineWidth = p.s;
        ctx.beginPath(); ctx.moveTo(x + Math.cos(a) * d, y + Math.sin(a) * d);
        ctx.lineTo(x + Math.cos(a - .12) * (d + r * .5 * k), y + Math.sin(a - .12) * (d + r * .5 * k)); ctx.stroke();
      }
      ctx.restore();
      ring(ctx, x, y, r * (2.4 - 2.1 * inCubic(inP)), 1.2, "#b88cff", .35 + .4 * inP);
      glow(ctx, x, y, r * (.25 + .5 * inCubic(inP)), [[0, "rgba(255,255,255,1)"], [.4, "rgba(255,210,140,.7)"], [1, "rgba(255,160,60,0)"]]);
    }
    const bl = seg(t, nova, nova + 700);
    if (bl > 0 && bl < 1) {
      const fade = 1 - outCubic(bl);
      glow(ctx, x, y, r * (1.5 + 3 * outCubic(bl)), [[0, "rgba(255,255,255,1)"], [.2, "rgba(255,220,150,.8)"], [.55, "rgba(190,120,255,.35)"], [1, "rgba(120,60,255,0)"]], fade);
      ctx.save(); ctx.globalCompositeOperation = "lighter"; ctx.globalAlpha = fade;
      for (const [ang, len, wid] of [[0, 6, .07], [Math.PI / 2, 4, .06], [Math.PI / 4, 1.8, .035], [-Math.PI / 4, 1.8, .035]]) {
        ctx.save(); ctx.translate(x, y); ctx.rotate(ang);
        const g = ctx.createLinearGradient(-r * len, 0, r * len, 0);
        g.addColorStop(0, "rgba(255,200,120,0)"); g.addColorStop(.5, "rgba(255,250,235,1)"); g.addColorStop(1, "rgba(255,200,120,0)");
        ctx.fillStyle = g; ctx.fillRect(-r * len, -r * wid, r * len * 2, r * wid * 2); ctx.restore();
      }
      ctx.restore();
    }
    const s1 = seg(t, nova, nova + 900), s2 = seg(t, nova + 120, nova + 1250);
    if (s1 > 0 && s1 < 1) ring(ctx, x, y, r * (1 + 3.4 * outCubic(s1)), r * .08 * (1 - s1) + 1, "#ffd28a", 1 - s1);
    if (s2 > 0 && s2 < 1) ring(ctx, x, y, r * (1 + 2.3 * outCubic(s2)), 1.5, "#b88cff", (1 - s2) * .8);
    const du = seg(t, nova, nova + 1200);
    if (du > 0 && du < 1) {
      ctx.save(); ctx.globalCompositeOperation = "lighter";
      for (const p of dust) {
        const d = r * (1 + 2.6 * p.v * outCubic(du));
        ctx.fillStyle = `rgba(255,215,160,${(1 - du) * .9})`;
        ctx.beginPath(); ctx.arc(x + Math.cos(p.a) * d, y + Math.sin(p.a) * d * .42, p.s * (1 - du * .5), 0, TAU); ctx.fill();
      }
      ctx.restore();
    }
  },
};

const teleportBeam: WarpSignatureFx = { durationMs: WARP_ARRIVAL_MS, revealMs: WARP_LANDING_MS, draw: drawWarpArrival };

export const WARP_SIGNATURE_FX: Record<WarpSignatureId, WarpSignatureFx> = {
  "teleport-beam": teleportBeam,
  "hyperspace-drop": hyperspaceDrop,
  "phase-assembly": phaseAssembly,
  "wormhole-fold": wormholeFold,
  "singularity-bloom": singularityBloom,
};

export function warpSignatureFx(id: WarpSignatureId | null | undefined): WarpSignatureFx {
  return (id && WARP_SIGNATURE_FX[id]) || teleportBeam;
}
