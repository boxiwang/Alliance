import { useEffect, useLayoutEffect, useRef, type RefObject } from "react";
import type { WorldViewport } from "./WorldVisualLayer";

// Static Star Map scaffold (ground, nebula, stars, grids, sector rings, wormhole
// glow) drawn from the LIVE camera. It used to live inside the panned SVG, whose
// pre-rasterized margin runs out on a long drag and exposes the black shell
// behind it. A canvas redrawn from the camera can never run out, and it only
// repaints when the camera, zoom or size actually changes.

type Props = {
  viewportRef: RefObject<WorldViewport>;
  worldWidth: number;
  worldHeight: number;
  center: { x: number; y: number };
  worldRadius: number;
  reserveRadius: number;
  zoom: number;
  dprCap: number;
  animateStars: boolean;
};

const STAR_TILE = 64;
const STARS: [number, number, number, string, number][] = [
  [7, 13, .42, "201,244,255", .72],
  [43, 8, .25, "168,200,255", .55],
  [27, 47, .35, "226,212,255", .64],
  [58, 36, .18, "255,255,255", .8],
  [12, 59, .2, "115,223,255", .48],
];
const STAR_SPIN_SECONDS = 420;

export default function WorldBackdropLayer(props: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const propsRef = useRef(props);
  const dirtyRef = useRef(true);
  useLayoutEffect(() => { propsRef.current = props; dirtyRef.current = true; });

  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return;
    let raf = 0, cw = 1, ch = 1, dpr = 1, lastKey = "", lastSpin = -1;
    const resize = () => {
      dpr = Math.max(1, Math.min(propsRef.current.dprCap || 2, window.devicePixelRatio || 1));
      cw = Math.max(1, canvas.clientWidth); ch = Math.max(1, canvas.clientHeight);
      canvas.width = Math.round(cw * dpr); canvas.height = Math.round(ch * dpr);
      dirtyRef.current = true;
    };
    const observer = new ResizeObserver(resize);
    observer.observe(canvas);
    resize();

    const draw = (now: number) => {
      raf = requestAnimationFrame(draw);
      if (document.hidden) return;
      const p = propsRef.current, vp = p.viewportRef.current;
      if (!vp) return;
      // Stars turn once per 7 minutes; re-rendering them ~5x/s is indistinguishable.
      const spin = p.animateStars ? Math.floor(now / 200) : 0;
      const key = `${vp.x.toFixed(3)}|${vp.y.toFixed(3)}|${vp.width.toFixed(3)}|${cw}|${ch}`;
      if (!dirtyRef.current && key === lastKey && spin === lastSpin) return;
      dirtyRef.current = false; lastKey = key; lastSpin = spin;

      // Same viewBox "meet" mapping as the SVG and the other canvas layers.
      const s = Math.min(cw / vp.width, ch / vp.height);
      const ox = (cw - vp.width * s) / 2, oy = (ch - vp.height * s) / 2;
      const X = (x: number) => ox + (x - vp.x) * s, Y = (y: number) => oy + (y - vp.y) * s;
      const minX = vp.x - ox / s, maxX = vp.x + (cw - ox) / s, minY = vp.y - oy / s, maxY = vp.y + (ch - oy) / s;
      const W = p.worldWidth, H = p.worldHeight, z = Math.max(1, p.zoom);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, cw, ch);

      // Ground + nebula: the SVG radial gradients were objectBoundingBox on a 3W×3H rect.
      const ellipse = (cx: number, cy: number, stops: [number, string][]) => {
        const rx = 1.5 * W * s, ry = 1.5 * H * s, gx = X(cx), gy = Y(cy);
        const g = ctx.createRadialGradient(0, 0, 0, 0, 0, 1);
        stops.forEach(([o, c]) => g.addColorStop(o, c));
        ctx.save(); ctx.translate(gx, gy); ctx.scale(rx, ry); ctx.fillStyle = g;
        ctx.fillRect(-gx / rx, -gy / ry, cw / rx, ch / ry); ctx.restore();
      };
      ellipse(-W + .58 * 3 * W, -H + .42 * 3 * H, [[0, "#152044"], [.34, "#0b1532"], [.72, "#060c20"], [1, "#02050e"]]);
      ellipse(.5 * W, .5 * H, [[0, "rgba(122,73,216,.16)"], [.48, "rgba(33,94,155,.07)"], [1, "rgba(3,7,17,0)"]]);

      // Stars: 64-unit tile, slowly rotating about the wormhole like the old <animateTransform>.
      const angle = p.animateStars ? (now / 1000 / STAR_SPIN_SECONDS) * Math.PI * 2 : 0;
      const cos = Math.cos(angle), sin = Math.sin(angle), c = p.center;
      const back = (x: number, y: number) => [c.x + (x - c.x) * cos + (y - c.y) * sin, c.y - (x - c.x) * sin + (y - c.y) * cos];
      const corners = [back(minX, minY), back(maxX, minY), back(minX, maxY), back(maxX, maxY)];
      const bx0 = Math.min(...corners.map((q) => q[0])), bx1 = Math.max(...corners.map((q) => q[0]));
      const by0 = Math.min(...corners.map((q) => q[1])), by1 = Math.max(...corners.map((q) => q[1]));
      for (const [sx, sy, r, rgb, a] of STARS) {
        ctx.fillStyle = `rgba(${rgb},${a})`;
        ctx.beginPath();
        const rad = Math.max(.35, (r / z) * s);
        for (let tx = Math.floor(bx0 / STAR_TILE) * STAR_TILE; tx <= bx1; tx += STAR_TILE) {
          for (let ty = Math.floor(by0 / STAR_TILE) * STAR_TILE; ty <= by1; ty += STAR_TILE) {
            const wx = tx + sx, wy = ty + sy;
            const px = X(c.x + (wx - c.x) * cos - (wy - c.y) * sin), py = Y(c.y + (wx - c.x) * sin + (wy - c.y) * cos);
            if (px < -2 || py < -2 || px > cw + 2 || py > ch + 2) continue;
            ctx.moveTo(px + rad, py); ctx.arc(px, py, rad, 0, Math.PI * 2);
          }
        }
        ctx.fill();
      }

      // Grids. The SVG patterns stroked each line on the tile edge, so the tile
      // clipped away half of it (and three quarters of the corner dot): draw half
      // the stroke width, and fade sub-pixel lines instead of widening them.
      const lines = (step: number, rgb: string, alpha: number, width: number) => {
        const effective = width / 2, lw = Math.max(effective, .35);
        ctx.strokeStyle = `rgba(${rgb},${alpha * Math.min(1, effective / lw)})`; ctx.lineWidth = lw; ctx.beginPath();
        for (let x = Math.ceil(minX / step) * step; x <= maxX; x += step) { const px = X(x); ctx.moveTo(px, 0); ctx.lineTo(px, ch); }
        for (let y = Math.ceil(minY / step) * step; y <= maxY; y += step) { const py = Y(y); ctx.moveTo(0, py); ctx.lineTo(cw, py); }
        ctx.stroke();
      };
      lines(8, "23,52,74", .34, (.25 / z) * s);
      lines(40, "46,120,146", .52, (.48 / z) * s);
      const dot = (.7 / z) * s / 2;
      ctx.fillStyle = `rgba(65,223,252,${.5 * Math.min(1, dot / .35)})`; ctx.beginPath();
      const dr = Math.max(dot, .35);
      for (let x = Math.ceil(minX / 40) * 40; x <= maxX; x += 40) for (let y = Math.ceil(minY / 40) * 40; y <= maxY; y += 40) { ctx.moveTo(X(x) + dr, Y(y)); ctx.arc(X(x), Y(y), dr, 0, Math.PI * 2); }
      ctx.fill();

      // Sector rings (non-scaling dashed strokes; the SVG plane renders at 1.65x, hence ~0.86px).
      const cx = X(c.x), cy = Y(c.y);
      ctx.setLineDash([3.3, 8.25]); ctx.strokeStyle = "#2c7892"; ctx.lineWidth = .86;
      for (let ring = 1; ring <= 5; ring++) {
        ctx.globalAlpha = ring === 5 ? .9 : .34;
        ctx.beginPath(); ctx.arc(cx, cy, (p.worldRadius * ring / 5) * s, 0, Math.PI * 2); ctx.stroke();
      }
      ctx.globalAlpha = 1;

      // Wormhole reserve: glow, dashed rings and the cross hair.
      const rr = p.reserveRadius * s;
      const core = ctx.createRadialGradient(cx, cy, 0, cx, cy, rr * 1.55);
      [[0, "rgba(1,2,8,1)"], [.22, "rgba(9,5,29,1)"], [.48, "rgba(163,92,255,.42)"], [.72, "rgba(56,217,255,.16)"], [1, "rgba(29,18,58,0)"]]
        .forEach(([o, col]) => core.addColorStop(o as number, col as string));
      ctx.fillStyle = core; ctx.beginPath(); ctx.arc(cx, cy, rr * 1.55, 0, Math.PI * 2); ctx.fill();
      ctx.strokeStyle = "#aa82ff"; ctx.shadowColor = "#aa82ff"; ctx.shadowBlur = 4;
      ctx.setLineDash([5, 3.3]); ctx.lineWidth = 1.65; ctx.beginPath(); ctx.arc(cx, cy, rr, 0, Math.PI * 2); ctx.stroke();
      ctx.globalAlpha = .64; ctx.setLineDash([1.65, 3.3]); ctx.lineWidth = .75; ctx.beginPath(); ctx.arc(cx, cy, rr * .62, 0, Math.PI * 2); ctx.stroke();
      ctx.shadowBlur = 0; ctx.setLineDash([]); ctx.globalAlpha = .55; ctx.lineWidth = .6;
      const arm = rr + 8 * s;
      ctx.beginPath(); ctx.moveTo(cx - arm, cy); ctx.lineTo(cx + arm, cy); ctx.moveTo(cx, cy - arm); ctx.lineTo(cx, cy + arm); ctx.stroke();
      ctx.globalAlpha = 1;
    };
    raf = requestAnimationFrame(draw);
    return () => { cancelAnimationFrame(raf); observer.disconnect(); };
  }, []);

  return <canvas ref={canvasRef} className="world-backdrop-layer" aria-hidden="true" />;
}
