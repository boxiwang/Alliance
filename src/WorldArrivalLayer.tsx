import { useEffect, useRef, type RefObject } from "react";
import type { Point } from "./lib/world-engine";
import { worldVisualBodyRadius } from "./WorldVisualLayer";

type Viewport = { x: number; y: number; width: number; height: number };
export type WorldArrival = { key: string; position: Point };

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
  // Beam: drops from above, then thins and fades upward.
  const drop = outCubic(clamp(t / land)), beamFade = 1 - clamp((t - land) / .38);
  if (beamFade > 0) {
    const top = y - radius * 14, bottom = y - radius * 14 + radius * 14 * drop;
    const halfWidth = radius * (.55 - .35 * clamp((t - land) / .38));
    const beam = ctx.createLinearGradient(x - halfWidth, 0, x + halfWidth, 0);
    beam.addColorStop(0, "rgba(56,217,255,0)");
    beam.addColorStop(.5, `rgba(235,252,255,${.9 * beamFade})`);
    beam.addColorStop(1, "rgba(56,217,255,0)");
    ctx.fillStyle = beam;
    ctx.fillRect(x - halfWidth, top, halfWidth * 2, bottom - top);
    const core = ctx.createLinearGradient(0, top, 0, bottom);
    core.addColorStop(0, "rgba(255,255,255,0)"); core.addColorStop(1, `rgba(255,255,255,${beamFade})`);
    ctx.fillStyle = core;
    ctx.fillRect(x - halfWidth * .18, top, halfWidth * .36, bottom - top);
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
      if (viewport && elapsed <= WARP_ARRIVAL_MS) {
        const x = ((arrival.position.x - viewport.x) / viewport.width) * width;
        const y = ((arrival.position.y - viewport.y) / viewport.height) * height;
        drawWarpArrival(ctx, x, y, worldVisualBodyRadius(zoomRef.current, true, false, true), elapsed);
        raf = requestAnimationFrame(draw);
      }
    };
    raf = requestAnimationFrame(draw);
    return () => { cancelAnimationFrame(raf); ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.clearRect(0, 0, canvas.width, canvas.height); };
  }, [arrival, viewportRef, dprCap]);

  return <canvas ref={canvasRef} className="world-arrival-layer" aria-hidden="true" />;
}
