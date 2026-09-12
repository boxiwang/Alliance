import { useEffect, useRef } from "react";
import type { HeadlessWorld, HeadlessMarch } from "./lib/world-engine";
import type { MarchSignatureId } from "./lib/player-account";
import type { GraphicsQuality } from "./lib/graphics-tier";

// Rich fleet signatures on the starmap. This mirrors the Vault's Canvas trail
// renderer (MarchSignaturePreview) so a fleet in the field looks as good as it
// does in the loadout preview — trails, aurora ribbons, warp braids, comet
// embers — instead of the flat SVG paths the map used before. Runs only for the
// Medium+ tiers; Low / reduced-motion keep the plain SVG kite in World.tsx.

const TACTICAL_ZOOM = 3;
type Color = [number, number, number];
const CYAN: Color = [89, 220, 255];
const VIOLET: Color = [169, 108, 255];
const AURORA: Color = [79, 240, 208];
const GOLD: Color = [243, 196, 107];
const RED: Color = [255, 95, 120];
const rgba = (c: Color, a: number) => `rgba(${c[0]},${c[1]},${c[2]},${a})`;
const mix = (a: Color, b: Color, t: number): Color => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];

type TailPoint = { x: number; y: number; ang: number; age: number };

// Progress of a moving fleet along its straight origin→destination vector.
function marchProgress(march: HeadlessMarch, now: number): number {
  if (march.state === "outbound") return Math.max(0, Math.min(1, (now - march.dispatchedAt) / Math.max(1, march.arriveAt - march.dispatchedAt)));
  if (march.state !== "returning") return march.state === "gathering" ? 1 : 0;
  const fullTravel = Math.max(1, march.arriveAt - march.dispatchedAt);
  const legacyRecallStart = march.workUntil > 0 ? march.returnAt - fullTravel : (march.returnAt + march.dispatchedAt) / 2;
  const returnStartedAt = march.returnStartedAt || (march.outcome === "recalled" ? legacyRecallStart : march.workUntil || march.arriveAt);
  const outboundAtReturn = returnStartedAt >= march.arriveAt ? 1 : Math.max(0, Math.min(1, (returnStartedAt - march.dispatchedAt) / fullTravel));
  const returnProgress = (now - returnStartedAt) / Math.max(1, march.returnAt - returnStartedAt);
  return Math.max(0, Math.min(1, outboundAtReturn * (1 - returnProgress)));
}

function drawHull(ctx: CanvasRenderingContext2D, x: number, y: number, angle: number, color: Color, sc: number) {
  ctx.save();
  ctx.translate(x, y); ctx.rotate(angle); ctx.scale(sc, sc);
  const glow = ctx.createRadialGradient(0, 0, 0, 0, 0, 12);
  glow.addColorStop(0, rgba(color, 0.55)); glow.addColorStop(1, rgba(color, 0));
  ctx.fillStyle = glow; ctx.beginPath(); ctx.arc(0, 0, 12, 0, Math.PI * 2); ctx.fill();
  const hull = ctx.createLinearGradient(-6, 0, 9, 0);
  hull.addColorStop(0, rgba(color, 0.2)); hull.addColorStop(0.7, rgba(color, 0.9)); hull.addColorStop(1, "#f5fbff");
  ctx.fillStyle = hull;
  ctx.beginPath(); ctx.moveTo(9, 0); ctx.lineTo(0, 3.6); ctx.lineTo(-6, 0); ctx.lineTo(0, -3.6); ctx.closePath(); ctx.fill();
  ctx.strokeStyle = "rgba(255,255,255,.55)"; ctx.lineWidth = 0.7; ctx.stroke();
  ctx.fillStyle = "white"; ctx.beginPath(); ctx.arc(1.8, 0, 1.25, 0, Math.PI * 2); ctx.fill();
  ctx.restore();
}

function drawIon(ctx: CanvasRenderingContext2D, tail: TailPoint[], hx: number, hy: number, angle: number, sc: number, rich: boolean) {
  for (let i = 1; i < tail.length; i++) {
    const a = tail[i - 1], b = tail[i];
    ctx.strokeStyle = rgba(CYAN, (1 - b.age) * 0.5); ctx.lineWidth = (1 - b.age) * 2.2 * sc;
    ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
  }
  if (rich) for (let i = 0; i < tail.length; i += 3) {
    const p = tail[i], offset = (i % 2 ? 1 : -1) * p.age * 7 * sc;
    ctx.fillStyle = rgba([190, 240, 255], (1 - p.age) * 0.6);
    ctx.beginPath(); ctx.arc(p.x - Math.sin(p.ang) * offset, p.y + Math.cos(p.ang) * offset, (1 - p.age) * 1.6 * sc, 0, Math.PI * 2); ctx.fill();
  }
  drawHull(ctx, hx, hy, angle, CYAN, sc);
}

function drawWarp(ctx: CanvasRenderingContext2D, tail: TailPoint[], hx: number, hy: number, angle: number, now: number, sc: number, rich: boolean) {
  const off = (p: TailPoint, amt: number) => ({ x: p.x - Math.sin(p.ang) * amt, y: p.y + Math.cos(p.ang) * amt });
  if (rich) for (const dir of [1, -1]) {
    ctx.strokeStyle = rgba(VIOLET, 0.14); ctx.lineWidth = 1; ctx.beginPath();
    tail.forEach((p, i) => { const q = off(p, dir * (3.4 * (1 - p.age) + 0.8) * sc); i ? ctx.lineTo(q.x, q.y) : ctx.moveTo(q.x, q.y); }); ctx.stroke();
  }
  const braid = (phase: number, color: Color, lw: number, alpha: number) => {
    ctx.strokeStyle = rgba(color, alpha); ctx.lineWidth = lw * sc; ctx.beginPath();
    tail.forEach((p, i) => { const q = off(p, Math.sin(i * 0.6 - now / 150 + phase) * 4.6 * (1 - p.age) * sc); i ? ctx.lineTo(q.x, q.y) : ctx.moveTo(q.x, q.y); }); ctx.stroke();
  };
  braid(0, VIOLET, 2.2, 0.55); braid(Math.PI, CYAN, 1.7, 0.5);
  ctx.save(); ctx.translate(hx, hy); ctx.rotate(angle); ctx.scale(sc, sc);
  for (let ring = 1; ring <= 3; ring++) { ctx.strokeStyle = rgba(CYAN, (4 - ring) / 12); ctx.lineWidth = 1; ctx.beginPath(); ctx.arc(3, 0, 4 + ring * 3, -0.75, 0.75); ctx.stroke(); }
  if (rich) for (let r = 9; r >= 4; r -= 2.5) { ctx.strokeStyle = rgba(VIOLET, 0.14 * (9 / r)); ctx.beginPath(); ctx.arc(0, 0, r + Math.sin(now / 260) * 1.1, 0, Math.PI * 2); ctx.stroke(); }
  ctx.fillStyle = rgba(CYAN, 0.7); ctx.beginPath(); ctx.arc(-0.9, 0, 2.3, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = rgba(VIOLET, 0.7); ctx.beginPath(); ctx.arc(0.9, 0, 2.3, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = "#f0f8ff"; ctx.beginPath(); ctx.arc(0, 0, 1.9, 0, Math.PI * 2); ctx.fill();
  ctx.restore();
}

function drawAurora(ctx: CanvasRenderingContext2D, tail: TailPoint[], hx: number, hy: number, angle: number, now: number, sc: number, rich: boolean) {
  const freq = 0.13, drift = now / 900, amp = 10.5 * sc;
  const ribbon = (baseWidth: number, alpha: number) => {
    for (let i = 1; i < tail.length; i++) {
      const a = tail[i - 1], b = tail[i];
      const hw = ((1 - b.age) * baseWidth + 1.6) * sc;
      const waveA = Math.sin((i - 1) * freq - drift) * amp * (1 - a.age);
      const waveB = Math.sin(i * freq - drift) * amp * (1 - b.age);
      const nA = { x: -Math.sin(a.ang), y: Math.cos(a.ang) }, nB = { x: -Math.sin(b.ang), y: Math.cos(b.ang) };
      const f = b.age; const color = f < 0.5 ? mix(AURORA, CYAN, f * 2) : mix(CYAN, VIOLET, (f - 0.5) * 2);
      ctx.fillStyle = rgba(color, (1 - b.age) * alpha);
      ctx.beginPath();
      ctx.moveTo(a.x + nA.x * (hw + waveA), a.y + nA.y * (hw + waveA));
      ctx.lineTo(b.x + nB.x * (hw + waveB), b.y + nB.y * (hw + waveB));
      ctx.lineTo(b.x + nB.x * (-hw + waveB), b.y + nB.y * (-hw + waveB));
      ctx.lineTo(a.x + nA.x * (-hw + waveA), a.y + nA.y * (-hw + waveA));
      ctx.closePath(); ctx.fill();
    }
  };
  if (rich) ribbon(15, 0.07);
  ribbon(9, 0.17);
  ctx.strokeStyle = rgba(CYAN, 0.5); ctx.lineWidth = 1.4 * sc; ctx.beginPath();
  tail.forEach((p, i) => { const w = Math.sin(i * freq - drift) * amp * (1 - p.age); const x = p.x - Math.sin(p.ang) * w, y = p.y + Math.cos(p.ang) * w; i ? ctx.lineTo(x, y) : ctx.moveTo(x, y); });
  ctx.stroke();
  drawHull(ctx, hx, hy, angle, AURORA, sc);
}

function drawComet(ctx: CanvasRenderingContext2D, tail: TailPoint[], hx: number, hy: number, color: Color, sc: number) {
  tail.forEach((p) => { ctx.fillStyle = rgba(color, (1 - p.age) * 0.34); ctx.beginPath(); ctx.arc(p.x, p.y, ((1 - p.age) * 4.2 + 0.4) * sc, 0, Math.PI * 2); ctx.fill(); });
  const glow = ctx.createRadialGradient(hx, hy, 0, hx, hy, 13 * sc);
  glow.addColorStop(0, rgba(color, 0.85)); glow.addColorStop(0.4, rgba(color, 0.35)); glow.addColorStop(1, rgba(color, 0));
  ctx.fillStyle = glow; ctx.beginPath(); ctx.arc(hx, hy, 13 * sc, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = "rgba(255,255,255,.95)"; ctx.beginPath(); ctx.arc(hx, hy, 2.4 * sc, 0, Math.PI * 2); ctx.fill();
}

type Viewport = { x: number; y: number; width: number; height: number };

export default function WorldMarchLayer({
  world, viewport, zoom, viewerId, quality,
}: {
  world: HeadlessWorld;
  viewport: Viewport;
  zoom: number;
  viewerId: string;
  quality: GraphicsQuality;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const latestRef = useRef({ world, viewport, zoom, viewerId, quality });
  latestRef.current = { world, viewport, zoom, viewerId, quality };
  const rafRef = useRef<number | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d", { alpha: true });
    if (!ctx) return;
    let cw = 0, ch = 0, dpr = 1;
    const resize = () => {
      const rect = canvas.getBoundingClientRect();
      cw = Math.max(1, rect.width); ch = Math.max(1, rect.height);
      dpr = Math.min(latestRef.current.quality.dprCap, window.devicePixelRatio || 1);
      const w = Math.round(cw * dpr), h = Math.round(ch * dpr);
      if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; }
    };
    const observer = new ResizeObserver(resize); observer.observe(canvas); resize();

    const render = (now: number) => {
      // `now` is the rAF timestamp (page-relative) — good for animation drift.
      // Fleet PROGRESS must use epoch time, since march.dispatchedAt/arriveAt are
      // Date.now() values; mixing the two pins every fleet to its origin.
      const nowMs = Date.now();
      const { world: w, viewport: vp, zoom: z, viewerId: vid, quality: q } = latestRef.current;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0); ctx.clearRect(0, 0, cw, ch);
      if (q.marchFx === "kite") { rafRef.current = requestAnimationFrame(render); return; }
      // viewBox "meet" mapping — uniform scale + centering — so fleets land on
      // the SVG route line, planets and harvest marks exactly.
      const scale = Math.min(cw / vp.width, ch / vp.height);
      const ox = (cw - vp.width * scale) / 2, oy = (ch - vp.height * scale) / 2;
      const toX = (x: number) => ox + (x - vp.x) * scale, toY = (y: number) => oy + (y - vp.y) * scale;
      const rich = q.marchFx === "full";
      const sc = z < TACTICAL_ZOOM ? 0.8 : Math.min(1.2, 0.9 + Math.log2(z / TACTICAL_ZOOM) * 0.09);
      const N = rich ? 26 : 16, L = 62 * sc;
      let drew = false;

      ctx.globalCompositeOperation = "lighter";
      for (const march of Object.values(w.marches)) {
        if (march.state !== "outbound" && march.state !== "returning") continue; // gathering → SVG harvest mark
        if (march.playerId !== vid && z < TACTICAL_ZOOM) continue; // rivals only in Tactical
        const signature = w.players[march.playerId]?.cosmetics?.marchSignature as MarchSignatureId | undefined;
        if (!signature) continue;
        const p = marchProgress(march, nowMs);
        const wx = march.origin.x + (march.destination.x - march.origin.x) * p;
        const wy = march.origin.y + (march.destination.y - march.origin.y) * p;
        const hx = toX(wx), hy = toY(wy);
        if (hx < -80 || hx > cw + 80 || hy < -80 || hy > ch + 80) continue;
        const angle = march.state === "returning"
          ? Math.atan2(march.origin.y - march.destination.y, march.origin.x - march.destination.x)
          : Math.atan2(march.destination.y - march.origin.y, march.destination.x - march.origin.x);
        // Fixed-length comet tail behind the head — reads well no matter how slow
        // the real march travels.
        const tail: TailPoint[] = [];
        for (let i = 0; i < N; i++) { const age = i / (N - 1), d = age * L; tail.push({ x: hx - Math.cos(angle) * d, y: hy - Math.sin(angle) * d, ang: angle, age }); }

        if (signature === "ion-wake") drawIon(ctx, tail, hx, hy, angle, sc, rich);
        else if (signature === "warp-thread") drawWarp(ctx, tail, hx, hy, angle, now, sc, rich);
        else if (signature === "aurora-sail") drawAurora(ctx, tail, hx, hy, angle, now, sc, rich);
        else { const color = march.action === "scout" ? CYAN : march.action === "gather" ? GOLD : RED; drawComet(ctx, tail, hx, hy, color, sc); }
        drew = true;
      }
      ctx.globalCompositeOperation = "source-over";
      void drew;
      rafRef.current = document.hidden ? null : requestAnimationFrame(render);
    };
    rafRef.current = requestAnimationFrame(render);
    const onVis = () => { if (!document.hidden && rafRef.current == null) rafRef.current = requestAnimationFrame(render); };
    document.addEventListener("visibilitychange", onVis);
    return () => { if (rafRef.current != null) cancelAnimationFrame(rafRef.current); rafRef.current = null; observer.disconnect(); document.removeEventListener("visibilitychange", onVis); };
  }, [quality.dprCap]);

  return <canvas ref={canvasRef} className="world-march-layer" aria-hidden="true" />;
}
