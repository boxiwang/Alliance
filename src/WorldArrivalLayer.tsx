import { useEffect, useRef, type RefObject } from "react";
import type { Point } from "./lib/world-engine";
import { worldVisualBodyRadius } from "./WorldVisualLayer";

type Viewport = { x: number; y: number; width: number; height: number };
/** "depart" plays at the old home (the city is beamed up), "arrive" at the new one. */
export type WorldArrival = { key: string; position: Point; kind: "depart" | "arrive" };

/** Basic warp arrival every civilization gets; styled arrivals are future cosmetics (docs/IDEAS.md). */
export const WARP_ARRIVAL_MS = 1500;
const TAU = Math.PI * 2;
const clamp = (value: number) => Math.max(0, Math.min(1, value));
const outCubic = (value: number) => 1 - Math.pow(1 - value, 3);

/**
 * One frame of the basic arrival ("teleport beam"): a beam of light drops onto the new
 * coordinate, the landing flashes, then a glowing shock ring and a landing halo spread out.
 */
export function drawWarpArrival(ctx: CanvasRenderingContext2D, x: number, y: number, bodyRadius: number, elapsedMs: number) {
  const t = elapsedMs / WARP_ARRIVAL_MS;
  if (t < 0 || t > 1) return;
  const radius = Math.max(16, bodyRadius);
  const land = .16; // the beam hits at 16% (~240 ms)
  ctx.save();
  ctx.globalCompositeOperation = "lighter";
  // Beam: a soft cone of light drops from above — narrow and transparent at the top, widest
  // and brightest where it lands. Three stacked layers feather the edges; nothing is hard-cut.
  const drop = outCubic(clamp(t / land)), beamFade = 1 - outCubic(clamp((t - land) / .5));
  if (beamFade > 0) {
    const length = radius * 9, bottom = y - radius * .2, head = bottom - length * (1 - drop);
    const top = head - length * .85;
    for (const [spread, alpha, rgb] of [[1, .16, "56,217,255"], [.55, .3, "150,236,255"], [.2, .85, "255,255,255"]] as const) {
      const halfBottom = radius * .7 * spread * (1 - .45 * clamp((t - land) / .5)), halfTop = halfBottom * .15;
      const light = ctx.createLinearGradient(0, top, 0, head);
      light.addColorStop(0, `rgba(${rgb},0)`);
      light.addColorStop(.7, `rgba(${rgb},${alpha * .45 * beamFade})`);
      light.addColorStop(1, `rgba(${rgb},${alpha * beamFade})`);
      ctx.fillStyle = light;
      ctx.beginPath();
      ctx.moveTo(x - halfTop, top); ctx.lineTo(x + halfTop, top);
      ctx.lineTo(x + halfBottom, head); ctx.quadraticCurveTo(x, head + halfBottom * .6, x - halfBottom, head);
      ctx.closePath(); ctx.fill();
    }
  }
  // Landing flash.
  const flash = t < land ? 0 : 1 - clamp((t - land) / .3);
  if (flash > 0) {
    const size = radius * 3.2;
    const glow = ctx.createRadialGradient(x, y, 0, x, y, size);
    glow.addColorStop(0, `rgba(255,255,255,${flash})`);
    glow.addColorStop(.3, `rgba(160,236,255,${.75 * flash})`);
    glow.addColorStop(1, "rgba(56,217,255,0)");
    ctx.fillStyle = glow;
    ctx.beginPath(); ctx.arc(x, y, size, 0, TAU); ctx.fill();
  }
  // Shock ring (thick, glowing) + a slower landing halo.
  ctx.shadowColor = "#38d9ff";
  for (const [start, span, reach, width, color, blur] of [
    [land, .6, 5.2, 5, "150,236,255", 16],
    [land + .06, .78, 3.2, 2.2, "230,250,255", 8],
  ] as const) {
    const k = clamp((t - start) / span);
    if (k <= 0 || k >= 1) continue;
    ctx.shadowBlur = blur;
    ctx.strokeStyle = `rgba(${color},${(1 - k) * .95})`;
    ctx.lineWidth = width * (1 - k * .55);
    ctx.beginPath(); ctx.arc(x, y, radius * (1 + reach * outCubic(k)), 0, TAU); ctx.stroke();
  }
  ctx.restore();
}

export const WARP_DEPARTURE_MS = 520;

/** The city is beamed up: a flash swallows it, then a soft beam leaves upward. */
export function drawWarpDeparture(ctx: CanvasRenderingContext2D, x: number, y: number, bodyRadius: number, elapsedMs: number) {
  const t = elapsedMs / WARP_DEPARTURE_MS;
  if (t < 0 || t > 1) return;
  const radius = Math.max(16, bodyRadius);
  ctx.save();
  ctx.globalCompositeOperation = "lighter";
  const flash = Math.sin(Math.PI * clamp(t / .7));
  if (flash > 0) {
    const size = radius * (1.4 + 1.2 * flash);
    const glow = ctx.createRadialGradient(x, y, 0, x, y, size * 1.5);
    glow.addColorStop(0, `rgba(255,255,255,${flash})`);
    glow.addColorStop(.35, `rgba(160,236,255,${.7 * flash})`);
    glow.addColorStop(1, "rgba(56,217,255,0)");
    ctx.fillStyle = glow;
    ctx.beginPath(); ctx.arc(x, y, size * 1.5, 0, TAU); ctx.fill();
  }
  // Beam leaves upward: its foot lifts off the planet while it fades.
  const rise = clamp((t - .25) / .75);
  if (rise > 0) {
    const fade = 1 - rise, length = radius * 9, foot = y - length * outCubic(rise) * .9, top = foot - length;
    for (const [spread, alpha, rgb] of [[1, .16, "56,217,255"], [.55, .3, "150,236,255"], [.2, .85, "255,255,255"]] as const) {
      const half = radius * .6 * spread;
      const light = ctx.createLinearGradient(0, top, 0, foot);
      light.addColorStop(0, `rgba(${rgb},0)`); light.addColorStop(1, `rgba(${rgb},${alpha * fade})`);
      ctx.fillStyle = light;
      ctx.beginPath(); ctx.moveTo(x - half * .15, top); ctx.lineTo(x + half * .15, top); ctx.lineTo(x + half, foot); ctx.lineTo(x - half, foot); ctx.closePath(); ctx.fill();
    }
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
      const duration = arrival.kind === "depart" ? WARP_DEPARTURE_MS : WARP_ARRIVAL_MS;
      if (viewport && elapsed <= duration) {
        const x = ((arrival.position.x - viewport.x) / viewport.width) * width;
        const y = ((arrival.position.y - viewport.y) / viewport.height) * height;
        (arrival.kind === "depart" ? drawWarpDeparture : drawWarpArrival)(ctx, x, y, worldVisualBodyRadius(zoomRef.current, true, false, true), elapsed);
        raf = requestAnimationFrame(draw);
      }
    };
    raf = requestAnimationFrame(draw);
    return () => { cancelAnimationFrame(raf); ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.clearRect(0, 0, canvas.width, canvas.height); };
  }, [arrival, viewportRef, dprCap]);

  return <canvas ref={canvasRef} className="world-arrival-layer" aria-hidden="true" />;
}
