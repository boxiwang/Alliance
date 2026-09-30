import { useEffect, useRef, type RefObject } from "react";
import type { Point } from "./lib/world-engine";
import { worldVisualBodyRadius } from "./WorldVisualLayer";

type Viewport = { x: number; y: number; width: number; height: number };
export type WorldArrival = { key: string; position: Point };

/** Basic warp arrival every civilization gets; styled arrivals are future cosmetics (docs/IDEAS.md). */
export const WARP_ARRIVAL_MS = 950;
const TAU = Math.PI * 2;
const clamp = (value: number) => Math.max(0, Math.min(1, value));
const outCubic = (value: number) => 1 - Math.pow(1 - value, 3);

/** One frame of the basic arrival: a flash that "switches on" the city, then two expanding rings. */
export function drawWarpArrival(ctx: CanvasRenderingContext2D, x: number, y: number, radius: number, elapsedMs: number) {
  const t = elapsedMs / WARP_ARRIVAL_MS;
  if (t < 0 || t > 1) return;
  ctx.save();
  ctx.globalCompositeOperation = "lighter";
  const flash = 1 - clamp(t / .45);
  if (flash > 0) {
    const size = radius * (1.2 + 1.3 * outCubic(clamp(t / .25)));
    const glow = ctx.createRadialGradient(x, y, 0, x, y, size * 1.6);
    glow.addColorStop(0, `rgba(255,255,255,${.95 * flash})`);
    glow.addColorStop(.35, `rgba(150,232,255,${.6 * flash})`);
    glow.addColorStop(1, "rgba(56,217,255,0)");
    ctx.fillStyle = glow;
    ctx.beginPath(); ctx.arc(x, y, size * 1.6, 0, TAU); ctx.fill();
  }
  for (const [start, reach, width, color] of [[0, 4.2, 3, "143,233,255"], [.14, 2.8, 1.6, "210,246,255"]] as const) {
    const k = clamp((t - start) / (1 - start));
    if (k <= 0 || k >= 1) continue;
    ctx.strokeStyle = `rgba(${color},${(1 - k) * .9})`;
    ctx.lineWidth = width * (1 - k * .6);
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
