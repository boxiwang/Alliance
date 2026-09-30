import { useEffect, useRef, type RefObject } from "react";
import type { Point } from "./lib/world-engine";
import { worldVisualBodyRadius } from "./WorldVisualLayer";
import type { WarpSignatureFx } from "./warp-signatures";

type Viewport = { x: number; y: number; width: number; height: number };
/** "depart" plays at the old home (the city is beamed up), "arrive" at the new one. */
export type WorldArrival = { key: string; position: Point; kind: "depart" | "arrive"; /** Equipped Warp Arrival signature (default: the teleport beam). */ fx?: WarpSignatureFx };

/** Basic warp arrival every civilization gets; styled arrivals are future cosmetics (docs/IDEAS.md). */
export const WARP_ARRIVAL_MS = 1600;
export const WARP_DEPARTURE_MS = 560;
/** When the arrival beam touches down (ms) — the map lights up and the city reappears here. */
export const WARP_LANDING_MS = 260;
const TAU = Math.PI * 2;
const clamp = (value: number) => Math.max(0, Math.min(1, value));
const outCubic = (value: number) => 1 - Math.pow(1 - value, 3);
const outQuint = (value: number) => 1 - Math.pow(1 - value, 5);

/** Deterministic per-effect particles, so a replayed frame never flickers. */
function motes(seed: string, count: number) {
  let h = 2166136261;
  for (let i = 0; i < seed.length; i += 1) h = Math.imul(h ^ seed.charCodeAt(i), 16777619);
  const next = () => { h = Math.imul(h ^ (h >>> 15), 2246822507); h = Math.imul(h ^ (h >>> 13), 3266489909); return ((h ^= h >>> 16) >>> 0) / 4294967296; };
  return Array.from({ length: count }, () => ({ a: next(), b: next(), c: next(), d: next() }));
}

/** A soft cone of light between `top` and `foot`: wide faint volume, mid glow, white core. */
function drawBeam(ctx: CanvasRenderingContext2D, x: number, top: number, foot: number, halfWidth: number, alpha: number, flicker: number, fadeUp = true) {
  if (alpha <= 0 || foot <= top) return;
  for (const [spread, strength, rgb] of [[2.3, .07, "56,217,255"], [1, .18, "72,222,255"], [.55, .34, "160,238,255"], [.18, .9, "255,255,255"]] as const) {
    const bottomHalf = halfWidth * spread, topHalf = bottomHalf * .14;
    const light = ctx.createLinearGradient(0, top, 0, foot);
    const peak = strength * alpha * flicker;
    if (fadeUp) { light.addColorStop(0, `rgba(${rgb},0)`); light.addColorStop(.65, `rgba(${rgb},${peak * .45})`); light.addColorStop(1, `rgba(${rgb},${peak})`); }
    else { light.addColorStop(0, `rgba(${rgb},0)`); light.addColorStop(.35, `rgba(${rgb},${peak * .7})`); light.addColorStop(1, `rgba(${rgb},${peak})`); }
    ctx.fillStyle = light;
    ctx.beginPath();
    ctx.moveTo(x - topHalf, top); ctx.lineTo(x + topHalf, top);
    ctx.lineTo(x + bottomHalf, foot); ctx.quadraticCurveTo(x, foot + bottomHalf * .55, x - bottomHalf, foot);
    ctx.closePath(); ctx.fill();
  }
}

function glow(ctx: CanvasRenderingContext2D, x: number, y: number, radius: number, stops: [number, string][]) {
  const g = ctx.createRadialGradient(x, y, 0, x, y, radius);
  for (const [offset, color] of stops) g.addColorStop(offset, color);
  ctx.fillStyle = g;
  ctx.beginPath(); ctx.arc(x, y, radius, 0, TAU); ctx.fill();
}

/**
 * The basic arrival ("teleport beam"): a shimmering beam with falling motes drops onto the
 * new coordinate; on touchdown a white-core flash, an anamorphic streak, a trailing shock
 * band, sparks and a slow landing halo; the planet keeps a fading afterglow.
 */
export function drawWarpArrival(ctx: CanvasRenderingContext2D, x: number, y: number, bodyRadius: number, elapsedMs: number, seed = "arrive") {
  const t = elapsedMs / WARP_ARRIVAL_MS;
  if (t < 0 || t > 1) return;
  const radius = Math.max(16, bodyRadius), land = WARP_LANDING_MS / WARP_ARRIVAL_MS, after = clamp((t - land) / (1 - land));
  const flicker = .86 + .14 * Math.sin(elapsedMs * .085) * Math.sin(elapsedMs * .031 + 1.3);
  const bits = motes(seed, 40);
  ctx.save();
  ctx.globalCompositeOperation = "lighter";
  // Anticipation: the landing spot starts to glow before the beam arrives.
  const drop = outCubic(clamp(t / land));
  if (t < land + .05) glow(ctx, x, y, radius * 1.6, [[0, `rgba(170,238,255,${.35 * drop})`], [1, "rgba(56,217,255,0)"]]);
  // Beam: drops, then thins and fades.
  const beamFade = 1 - outCubic(clamp((t - land) / .45));
  if (beamFade > 0) {
    const length = radius * 10, foot = y - radius * .15 - length * (1 - drop), top = foot - length * .9;
    const half = radius * .62 * (1 - .5 * clamp((t - land) / .45));
    drawBeam(ctx, x, top, foot, half, beamFade, flicker);
    // Motes riding down the beam.
    for (const m of bits.slice(0, 16)) {
      const along = (m.a + elapsedMs * .0022 * (.6 + m.b)) % 1, my = top + (foot - top) * along;
      const mx = x + (m.c - .5) * half * 1.1 * (.3 + along * .7);
      ctx.fillStyle = `rgba(225,250,255,${.75 * beamFade * along})`;
      ctx.beginPath(); ctx.arc(mx, my, .6 + m.d * 1.1, 0, TAU); ctx.fill();
    }
  }
  if (t >= land) {
    // Touchdown flash: white core, cyan bloom.
    const flash = 1 - outCubic(clamp((t - land) / .28));
    if (flash > 0) {
      glow(ctx, x, y, radius * 4.2, [[0, `rgba(150,232,255,${.5 * flash})`], [.45, `rgba(56,217,255,${.16 * flash})`], [1, "rgba(56,217,255,0)"]]);
      glow(ctx, x, y, radius * 1.7, [[0, `rgba(255,255,255,${flash})`], [.5, `rgba(220,248,255,${.55 * flash})`], [1, "rgba(160,236,255,0)"]]);
      // Anamorphic streak across the landing point.
      const streak = ctx.createLinearGradient(x - radius * 7, 0, x + radius * 7, 0);
      streak.addColorStop(0, "rgba(56,217,255,0)"); streak.addColorStop(.5, `rgba(235,252,255,${.8 * flash})`); streak.addColorStop(1, "rgba(56,217,255,0)");
      ctx.fillStyle = streak;
      const h = radius * .09 * (1 + flash);
      ctx.fillRect(x - radius * 7, y - h / 2, radius * 14, h);
    }
    // Shock band: a bright leading edge with two fading trails.
    const k = clamp(after / .62);
    if (k > 0 && k < 1) {
      const edge = radius * (1.05 + 4.6 * outQuint(k)), fade = 1 - k;
      ctx.shadowColor = "#38d9ff"; ctx.shadowBlur = 14;
      for (const [back, width, a, rgb] of [[0, 3.4, .95, "190,244,255"], [5, 2.4, .42, "90,220,255"], [11, 1.6, .18, "56,217,255"]] as const) {
        const r = edge - back * (1 - k * .4);
        if (r <= radius) continue;
        ctx.strokeStyle = `rgba(${rgb},${a * fade})`; ctx.lineWidth = width * (1 - k * .5);
        ctx.beginPath(); ctx.arc(x, y, r, 0, TAU); ctx.stroke();
      }
      ctx.shadowBlur = 0;
    }
    // Slow landing halo.
    const halo = clamp((after - .08) / .8);
    if (halo > 0 && halo < 1) {
      ctx.strokeStyle = `rgba(230,250,255,${.55 * (1 - halo)})`; ctx.lineWidth = 1.4;
      ctx.beginPath(); ctx.arc(x, y, radius * (1.1 + 2.3 * outCubic(halo)), 0, TAU); ctx.stroke();
    }
    // Sparks: short motion-blurred streaks thrown out and slowing down.
    const sk = clamp(after / .5);
    if (sk > 0 && sk < 1) {
      for (const m of bits.slice(16)) {
        const angle = m.a * TAU, reach = radius * (1.2 + 3.6 * m.b), d0 = reach * outCubic(Math.max(0, sk - .06)), d1 = reach * outCubic(sk);
        ctx.strokeStyle = `rgba(215,248,255,${(1 - sk) * (.5 + .5 * m.c)})`; ctx.lineWidth = .8 + m.d;
        ctx.beginPath(); ctx.moveTo(x + Math.cos(angle) * (radius * .8 + d0), y + Math.sin(angle) * (radius * .8 + d0));
        ctx.lineTo(x + Math.cos(angle) * (radius * .8 + d1), y + Math.sin(angle) * (radius * .8 + d1)); ctx.stroke();
      }
    }
    // Afterglow on the planet.
    const warm = 1 - clamp((after - .1) / .9);
    if (warm > 0) glow(ctx, x, y, radius * 1.9, [[.45, `rgba(120,225,255,${.22 * warm})`], [1, "rgba(56,217,255,0)"]]);
  }
  ctx.restore();
}

/** The city is beamed up: a flash swallows it, motes lift, and a soft beam leaves upward. */
export function drawWarpDeparture(ctx: CanvasRenderingContext2D, x: number, y: number, bodyRadius: number, elapsedMs: number, seed = "depart") {
  const t = elapsedMs / WARP_DEPARTURE_MS;
  if (t < 0 || t > 1) return;
  const radius = Math.max(16, bodyRadius), bits = motes(seed, 18);
  const flicker = .86 + .14 * Math.sin(elapsedMs * .085);
  ctx.save();
  ctx.globalCompositeOperation = "lighter";
  const flash = Math.sin(Math.PI * clamp(t / .66));
  if (flash > 0) {
    glow(ctx, x, y, radius * 3.4, [[0, `rgba(150,232,255,${.4 * flash})`], [1, "rgba(56,217,255,0)"]]);
    glow(ctx, x, y, radius * (1.3 + .5 * flash), [[0, `rgba(255,255,255,${flash})`], [.55, `rgba(210,246,255,${.5 * flash})`], [1, "rgba(160,236,255,0)"]]);
  }
  const rise = clamp((t - .22) / .78);
  if (rise > 0) {
    const fade = 1 - rise, length = radius * 10, foot = y - length * outCubic(rise) * .95;
    drawBeam(ctx, x, foot - length, foot, radius * .55, fade, flicker, false);
  }
  for (const m of bits) {
    const k = clamp((t - m.a * .3) / .7);
    if (k <= 0 || k >= 1) continue;
    const my = y - radius * (.2 + 7 * outCubic(k) * (.5 + m.b)), mx = x + (m.c - .5) * radius * 1.4 * (1 - k * .6);
    ctx.fillStyle = `rgba(225,250,255,${.8 * (1 - k)})`;
    ctx.beginPath(); ctx.arc(mx, my, .6 + m.d * 1.2, 0, TAU); ctx.fill();
  }
  ctx.restore();
}

export default function WorldArrivalLayer({ arrival, viewportRef, zoom, dprCap = 2 }: {
  arrival: WorldArrival | null;
  viewportRef: RefObject<Viewport>;
  zoom: number;
  dprCap?: number;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const zoomRef = useRef(zoom);
  zoomRef.current = zoom;

  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (!arrival || !canvas || !ctx) return;
    const started = performance.now();
    let raf = 0;
    const draw = (time: number) => {
      const rect = canvas.getBoundingClientRect();
      const dpr = Math.min(dprCap, window.devicePixelRatio || 1);
      const width = Math.max(1, rect.width), height = Math.max(1, rect.height);
      if (canvas.width !== Math.round(width * dpr) || canvas.height !== Math.round(height * dpr)) { canvas.width = Math.round(width * dpr); canvas.height = Math.round(height * dpr); }
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, width, height);
      const viewport = viewportRef.current;
      const elapsed = time - started;
      const duration = arrival.kind === "depart" ? WARP_DEPARTURE_MS : arrival.fx?.durationMs ?? WARP_ARRIVAL_MS;
      if (viewport && elapsed <= duration) {
        const x = ((arrival.position.x - viewport.x) / viewport.width) * width;
        const y = ((arrival.position.y - viewport.y) / viewport.height) * height;
        (arrival.kind === "depart" ? drawWarpDeparture : arrival.fx?.draw ?? drawWarpArrival)(ctx, x, y, worldVisualBodyRadius(zoomRef.current, true, false, true), elapsed, arrival.key);
        raf = requestAnimationFrame(draw);
      }
    };
    raf = requestAnimationFrame(draw);
    return () => { cancelAnimationFrame(raf); ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.clearRect(0, 0, canvas.width, canvas.height); };
  }, [arrival, viewportRef, dprCap]);

  return <canvas ref={canvasRef} className="world-arrival-layer" aria-hidden="true" />;
}
