import { useLayoutEffect, useRef, type RefObject } from "react";
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
  /** Current Star Map style: zone tint, grid LOD and a parallax star layer (false = archived classic look). */
  calm?: boolean;
  /** Graphics tier: low = clean scaffold; medium + nebula/parallax/micro stars;
   *  high + anti-tiling nebula detail and dust; ultra + a living (drifting, twinkling) sky. */
  tier?: "low" | "medium" | "high" | "ultra";
};

// Deep-zoom nebula detail + dust, computed per pixel on the GPU from WORLD
// coordinates (domain-warped fbm): nothing tiles, at any zoom, and the
// Full-Spectrum drift is continuous. Rendered soft at ≤1× backing resolution.
const NEBULA_VERT = "attribute vec2 aPos;void main(){gl_Position=vec4(aPos,0.,1.);}";
const NEBULA_FRAG = `
#ifdef GL_FRAGMENT_PRECISION_HIGH
precision highp float;
#else
precision mediump float;
#endif
uniform vec2 uRes;uniform vec4 uCam;uniform vec2 uOff;uniform float uTime,uDeep,uInner,uScale;
float h(vec2 p){p=fract(p*vec2(123.34,456.21));p+=dot(p,p+45.32);return fract(p.x*p.y);}
float n(vec2 p){vec2 i=floor(p),f=fract(p);f=f*f*(3.-2.*f);return mix(mix(h(i),h(i+vec2(1,0)),f.x),mix(h(i+vec2(0,1)),h(i+vec2(1,1)),f.x),f.y);}
float fbm(vec2 p){float v=0.,a=.5;mat2 m=mat2(1.6,1.2,-1.2,1.6);for(int i=0;i<5;i++){v+=a*n(p);p=m*p+vec2(3.1,1.7);a*=.5;}return v;}
void main(){
  vec2 css=vec2(gl_FragCoord.x,uRes.y-gl_FragCoord.y)/uScale;
  vec2 w=uCam.xy*.9+(css-uOff)/uCam.z;            // parallax depth .9
  vec2 q=w/14.+vec2(uTime*.02,uTime*.008);
  vec2 warp=vec2(fbm(q+vec2(1.7,9.2)),fbm(q+vec2(8.3,2.8)));
  float cloud=smoothstep(.46,.86,fbm(q+warp*1.6));
  float dust=smoothstep(.56,.94,fbm(w/3.1+warp*2.2+vec2(uTime*.03,0.)));
  vec3 col=mix(vec3(.27,.66,.78),vec3(.58,.38,.9),uInner);
  float a=(cloud*.24+dust*.15)*uDeep;
  gl_FragColor=vec4(col*a,a);
}`;

/** Deterministic hash → [0,1) for a world cell, so procedural stars never tile. */
function hash2(ix: number, iy: number, salt: number): number {
  let h = Math.imul(ix, 374761393) ^ Math.imul(iy, 668265263) ^ Math.imul(salt, 2246822519);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

const STAR_TILE = 64;
const STARS: [number, number, number, string, number][] = [
  [7, 13, .42, "201,244,255", .72],
  [43, 8, .25, "168,200,255", .55],
  [27, 47, .35, "226,212,255", .64],
  [58, 36, .18, "255,255,255", .8],
  [12, 59, .2, "115,223,255", .48],
];
const STAR_SPIN_SECONDS = 420;

/** Seamless value-noise fbm tile, colourised into `rgb` with alpha from the noise. */
function makeNoiseTile(size: number, seed: number, rgb: [number, number, number], opts: { base: number; octaves: number; lo: number; hi: number; alpha: number; grain?: number }): HTMLCanvasElement {
  let state = seed >>> 0;
  const rand = () => { state = (state + 0x6d2b79f5) >>> 0; let t = state; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  const layers: { period: number; grid: Float32Array }[] = [];
  for (let o = 0; o < opts.octaves; o += 1) {
    const period = opts.base * 2 ** o;
    const grid = new Float32Array(period * period);
    for (let i = 0; i < grid.length; i += 1) grid[i] = rand();
    layers.push({ period, grid });
  }
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext("2d")!;
  const image = ctx.createImageData(size, size);
  const fade = (t: number) => t * t * (3 - 2 * t);
  for (let y = 0; y < size; y += 1) for (let x = 0; x < size; x += 1) {
    let value = 0, amp = .5, norm = 0;
    for (const { period, grid } of layers) {
      const fx = x / size * period, fy = y / size * period;
      const x0 = Math.floor(fx), y0 = Math.floor(fy), tx = fade(fx - x0), ty = fade(fy - y0);
      const at = (gx: number, gy: number) => grid[((gy % period) * period) + (gx % period)];
      const top = at(x0, y0) + (at(x0 + 1, y0) - at(x0, y0)) * tx;
      const bottom = at(x0, y0 + 1) + (at(x0 + 1, y0 + 1) - at(x0, y0 + 1)) * tx;
      value += (top + (bottom - top) * ty) * amp; norm += amp; amp *= .5;
    }
    value /= norm;
    let a = Math.max(0, Math.min(1, (value - opts.lo) / (opts.hi - opts.lo)));
    a = a * a * (3 - 2 * a) * opts.alpha;
    if (opts.grain) a += (rand() < opts.grain ? .55 : 0) * opts.alpha;
    const i = (y * size + x) * 4;
    image.data[i] = rgb[0]; image.data[i + 1] = rgb[1]; image.data[i + 2] = rgb[2]; image.data[i + 3] = Math.round(Math.min(1, a) * 255);
  }
  ctx.putImageData(image, 0, 0);
  return canvas;
}

export default function WorldBackdropLayer(props: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const starsRef = useRef<HTMLCanvasElement>(null);
  const glRef = useRef<HTMLCanvasElement>(null);
  const propsRef = useRef(props);
  const dirtyRef = useRef(true);
  useLayoutEffect(() => { propsRef.current = props; dirtyRef.current = true; });

  // Layout effect: set up and paint the first frame before the browser shows the
  // map, so a refresh never shows the empty shell behind the markers.
  useLayoutEffect(() => {
    const canvas = canvasRef.current, starCanvas = starsRef.current;
    const ctx = canvas?.getContext("2d"), sctx = starCanvas?.getContext("2d");
    if (!canvas || !ctx || !starCanvas || !sctx) return;
    let raf = 0, cw = 1, ch = 1, dpr = 1, lastKey = "", lastStarsAt = -Infinity, lastAliveAt = -Infinity;
    let drawNow: (() => void) | null = null;
    // Texture tiles are generated once, after the first paint (≈20ms, idle), then
    // the base layer repaints with them. Patterns are world-anchored below.
    let textures: { teal: CanvasPattern; violet: CanvasPattern } | null = null;
    // GPU nebula (Enhanced / Full-Spectrum), created lazily the first time it is needed.
    const glCanvas = glRef.current;
    let gl: WebGLRenderingContext | null = null, glFailed = false, glU: Record<string, WebGLUniformLocation | null> = {};
    const glScale = () => Math.min(1, dpr) * .75;
    const ensureGL = (): WebGLRenderingContext | null => {
      if (gl || glFailed || !glCanvas) return gl;
      const c = glCanvas.getContext("webgl", { alpha: true, premultipliedAlpha: true, antialias: false, powerPreference: "low-power" });
      const compile = (type: number, src: string) => { const sh = c!.createShader(type)!; c!.shaderSource(sh, src); c!.compileShader(sh); return c!.getShaderParameter(sh, c!.COMPILE_STATUS) ? sh : null; };
      const vs = c && compile(c.VERTEX_SHADER, NEBULA_VERT), fs = c && compile(c.FRAGMENT_SHADER, NEBULA_FRAG);
      if (!c || !vs || !fs) { glFailed = true; return null; }
      const prog = c.createProgram()!; c.attachShader(prog, vs); c.attachShader(prog, fs); c.linkProgram(prog);
      if (!c.getProgramParameter(prog, c.LINK_STATUS)) { glFailed = true; return null; }
      c.useProgram(prog);
      const buf = c.createBuffer(); c.bindBuffer(c.ARRAY_BUFFER, buf);
      c.bufferData(c.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, -1, 1, 1, -1, 1, 1]), c.STATIC_DRAW);
      const loc = c.getAttribLocation(prog, "aPos"); c.enableVertexAttribArray(loc); c.vertexAttribPointer(loc, 2, c.FLOAT, false, 0, 0);
      for (const name of ["uRes", "uCam", "uOff", "uTime", "uDeep", "uInner", "uScale"]) glU[name] = c.getUniformLocation(prog, name);
      gl = c;
      return gl;
    };
    const texTimer = window.setTimeout(() => {
      if ((propsRef.current.tier ?? "high") === "low") return;
      const teal = makeNoiseTile(256, 4663, [70, 170, 200], { base: 3, octaves: 5, lo: .46, hi: .86, alpha: .16 });
      const violet = makeNoiseTile(256, 9001, [150, 96, 230], { base: 3, octaves: 5, lo: .5, hi: .9, alpha: .15 });
      const tp = ctx.createPattern(teal, "repeat"), vp = ctx.createPattern(violet, "repeat");
      if (tp && vp) { textures = { teal: tp, violet: vp }; dirtyRef.current = true; }
    }, 60);
    const resize = () => {
      const nextDpr = Math.max(1, Math.min(propsRef.current.dprCap || 2, window.devicePixelRatio || 1));
      const nextW = Math.max(1, canvas.clientWidth), nextH = Math.max(1, canvas.clientHeight);
      // Assigning canvas.width clears it: only touch the backing store on a real
      // size change, and repaint in the same frame (observer callbacks run before paint).
      if (nextW === cw && nextH === ch && nextDpr === dpr) return;
      dpr = nextDpr; cw = nextW; ch = nextH;
      for (const c of [canvas, starCanvas]) { c.width = Math.round(cw * dpr); c.height = Math.round(ch * dpr); }
      if (glCanvas) { glCanvas.width = Math.max(1, Math.round(cw * glScale())); glCanvas.height = Math.max(1, Math.round(ch * glScale())); }
      dirtyRef.current = true;
      drawNow?.();
    };
    const observer = new ResizeObserver(resize);
    observer.observe(canvas);
    resize();

    const draw = (now: number) => {
      raf = requestAnimationFrame(draw);
      if (document.hidden) return;
      const p = propsRef.current, vp = p.viewportRef.current;
      if (!vp) return;
      const key = `${vp.x.toFixed(3)}|${vp.y.toFixed(3)}|${vp.width.toFixed(3)}|${cw}|${ch}`;
      const tier = p.tier ?? "high";
      const alive = tier === "ultra" && p.animateStars;
      const aliveTick = alive && now - lastAliveAt >= 66;
      if (aliveTick) lastAliveAt = now;
      const baseDirty = dirtyRef.current || key !== lastKey || aliveTick;
      dirtyRef.current = false; lastKey = key;

      // Same viewBox "meet" mapping as the SVG and the other canvas layers.
      const s = Math.min(cw / vp.width, ch / vp.height);
      const ox = (cw - vp.width * s) / 2, oy = (ch - vp.height * s) / 2;
      const X = (x: number) => ox + (x - vp.x) * s, Y = (y: number) => oy + (y - vp.y) * s;
      const minX = vp.x - ox / s, maxX = vp.x + (cw - ox) / s, minY = vp.y - oy / s, maxY = vp.y + (ch - oy) / s;
      const W = p.worldWidth, H = p.worldHeight, z = Math.max(1, p.zoom);

      // The star field turns about the Wormhole (one turn / 7 min). Its on-screen
      // speed grows with zoom, so repaint it often enough that no step exceeds
      // ~0.4px: a few times a second zoomed out, every frame zoomed in.
      const c = p.center;
      const reach = Math.max(...[[minX, minY], [maxX, minY], [minX, maxY], [maxX, maxY]].map(([x, y]) => Math.hypot(x - c.x, y - c.y)));
      const pxPerSecond = (Math.PI * 2 / STAR_SPIN_SECONDS) * reach * s;
      const starInterval = Math.max(0, Math.min(250, 400 / Math.max(.001, pxPerSecond)));
      // Full-Spectrum: as the depth veil darkens the ground, the stars brighten
      // (same smoothstep as the veil, so both move together).
      const depth = Math.max(0, Math.min(1, (z - 2.5) / 9.5));
      const starLift = tier === "ultra" ? depth * depth * (3 - 2 * depth) : 0;
      function drawStars(now: number) {
        sctx!.setTransform(dpr, 0, 0, dpr, 0, 0); sctx!.clearRect(0, 0, cw, ch);
        // Stars: 64-unit tile, slowly rotating about the wormhole like the old <animateTransform>.
        const angle = p.animateStars ? (now / 1000 / STAR_SPIN_SECONDS) * Math.PI * 2 : 0;
        const cos = Math.cos(angle), sin = Math.sin(angle);
        const back = (x: number, y: number) => [c.x + (x - c.x) * cos + (y - c.y) * sin, c.y - (x - c.x) * sin + (y - c.y) * cos];
        const corners = [back(minX, minY), back(maxX, minY), back(minX, maxY), back(maxX, maxY)];
        const bx0 = Math.min(...corners.map((q) => q[0])), bx1 = Math.max(...corners.map((q) => q[0]));
        const by0 = Math.min(...corners.map((q) => q[1])), by1 = Math.max(...corners.map((q) => q[1]));
        for (const [sx, sy, r, rgb, a] of STARS) {
          sctx!.fillStyle = `rgba(${rgb},${Math.min(1, a * (1 + starLift * .9)).toFixed(3)})`;
          sctx!.beginPath();
          const rad = Math.max(.35, (r / z) * s) * (1 + starLift * .2);
          for (let tx = Math.floor(bx0 / STAR_TILE) * STAR_TILE; tx <= bx1; tx += STAR_TILE) {
            for (let ty = Math.floor(by0 / STAR_TILE) * STAR_TILE; ty <= by1; ty += STAR_TILE) {
              const wx = tx + sx, wy = ty + sy;
              const px = X(c.x + (wx - c.x) * cos - (wy - c.y) * sin), py = Y(c.y + (wx - c.x) * sin + (wy - c.y) * cos);
              if (px < -2 || py < -2 || px > cw + 2 || py > ch + 2) continue;
              sctx!.moveTo(px + rad, py); sctx!.arc(px, py, rad, 0, Math.PI * 2);
            }
          }
          sctx!.fill();
        }
      }
      if (baseDirty || (p.animateStars && now - lastStarsAt >= starInterval)) { lastStarsAt = now; drawStars(now); }
      if (!baseDirty) return;
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

      if (p.calm) {
        // Zone tint: cool teal at the rim warming to violet toward the Wormhole.
        const zone = ctx.createRadialGradient(X(p.center.x), Y(p.center.y), 0, X(p.center.x), Y(p.center.y), p.worldRadius * s);
        zone.addColorStop(0, "rgba(124,72,226,.12)"); zone.addColorStop(.4, "rgba(78,82,210,.06)");
        zone.addColorStop(.78, "rgba(34,140,170,.05)"); zone.addColorStop(1, "rgba(20,110,140,0)");
        ctx.fillStyle = zone; ctx.fillRect(0, 0, cw, ch);
        if (textures && tier !== "low") {
          // World-anchored pattern with parallax: tileWorld world units per tile,
          // the layer travels `depth` × the camera (farther = slower). `rot`
          // turns a copy so two overlapping scales never line up into a grid.
          const drift = alive ? now / 1000 * .35 : 0; // Full-Spectrum: slow nebula drift (world units)
          const layer = (pattern: CanvasPattern, tilePx: number, tileWorld: number, depth: number, alpha: number, rot = 0, flow = 1) => {
            if (alpha <= .004) return;
            const k = (tileWorld * s) / tilePx;
            pattern.setTransform(new DOMMatrix().translateSelf(ox - (vp.x * depth - drift * flow) * s, oy - (vp.y * depth - drift * flow * .4) * s).rotateSelf(rot).scaleSelf(k, k));
            ctx.globalAlpha = alpha; ctx.fillStyle = pattern; ctx.fillRect(0, 0, cw, ch);
          };
          // Nebula colour follows depth into the map: teal at the rim, violet near the Wormhole.
          const vcx = vp.x + vp.width / 2, vcy = vp.y + vp.height / 2;
          const inner = Math.max(0, Math.min(1, 1 - Math.hypot(vcx - p.center.x, vcy - p.center.y) / p.worldRadius));
          layer(textures.teal, 256, 150, .82, 1 - inner * .75, 0, .6);
          layer(textures.violet, 256, 190, .78, .25 + inner * .75, 23, .45);
          ctx.globalAlpha = 1;
        }
        // Depth darkening: from afar the gas reads as colour; up close space is mostly
        // black. The veil sits over the ground/nebula but under every star layer.
        const dark = Math.max(0, Math.min(1, (z - 2.5) / 9.5));
        const veil = dark * dark * (3 - 2 * dark) * .72;
        if (veil > .003) { ctx.fillStyle = `rgba(2,3,9,${veil.toFixed(3)})`; ctx.fillRect(0, 0, cw, ch); }
        // Deep-zoom nebula detail + dust on the GPU (Enhanced / Full-Spectrum only).
        const gpuNebula = (tier === "high" || tier === "ultra") ? ensureGL() : null;
        if (gpuNebula && glCanvas) {
          const g = gpuNebula, scale = glScale();
          const vcx = vp.x + vp.width / 2, vcy = vp.y + vp.height / 2;
          const inner = Math.max(0, Math.min(1, 1 - Math.hypot(vcx - p.center.x, vcy - p.center.y) / p.worldRadius));
          const deep = Math.max(0, Math.min(1, (z - 2.5) / 4.5));
          g.viewport(0, 0, glCanvas.width, glCanvas.height);
          g.clearColor(0, 0, 0, 0); g.clear(g.COLOR_BUFFER_BIT);
          if (deep > .004) {
            g.uniform2f(glU.uRes, glCanvas.width, glCanvas.height);
            g.uniform4f(glU.uCam, vp.x, vp.y, s, 1);
            g.uniform2f(glU.uOff, ox, oy);
            g.uniform1f(glU.uTime, alive ? now / 1000 : 0);
            g.uniform1f(glU.uDeep, deep * (1 - veil * .55)); // faint wisps survive in the dark
            g.uniform1f(glU.uInner, inner);
            g.uniform1f(glU.uScale, scale);
            g.drawArrays(g.TRIANGLES, 0, 6);
          }
        } else if (gl && glCanvas) {
          gl.clearColor(0, 0, 0, 0); gl.clear(gl.COLOR_BUFFER_BIT); // tier lowered: hide the GPU layer
        }
        if (tier !== "low") {
          // Far stars at 55% of the camera's travel: depth while panning. Hashed per
          // cell (no repeating lattice).
          const fs = s * .55, fminX = vp.x - ox / fs, fmaxX = vp.x + (cw - ox) / fs, fminY = vp.y - oy / fs, fmaxY = vp.y + (ch - oy) / fs;
          ctx.fillStyle = `rgba(190,215,255,${(.34 * (1 + starLift * .7)).toFixed(3)})`; ctx.beginPath();
          for (let cx0 = Math.floor(fminX / 24); cx0 <= Math.floor(fmaxX / 24); cx0 += 1) for (let cy0 = Math.floor(fminY / 24); cy0 <= Math.floor(fmaxY / 24); cy0 += 1) {
            if (hash2(cx0, cy0, 1) > .55) continue;
            const px = ox + (cx0 * 24 + hash2(cx0, cy0, 2) * 24 - vp.x) * fs, py = oy + (cy0 * 24 + hash2(cx0, cy0, 3) * 24 - vp.y) * fs;
            ctx.moveTo(px + .6, py); ctx.arc(px, py, .6, 0, Math.PI * 2);
          }
          ctx.fill();
          // Micro stars: world-anchored, fading in with depth; three brightness groups.
          const micro = Math.max(0, Math.min(1, (z - 3.5) / 5));
          if (micro > 0) {
            const t = alive ? now / 1000 : 0;
            for (let group = 0; group < 3; group += 1) {
              ctx.fillStyle = `rgba(215,230,255,${Math.min(1, micro * [.28, .45, .7][group] * (1 + starLift * .45)).toFixed(3)})`; ctx.beginPath();
              for (let cx0 = Math.floor(minX / 5); cx0 <= Math.floor(maxX / 5); cx0 += 1) for (let cy0 = Math.floor(minY / 5); cy0 <= Math.floor(maxY / 5); cy0 += 1) {
                const seed = hash2(cx0, cy0, 11);
                if (seed > .7) continue;
                // Full-Spectrum: each star drifts between brightness groups (twinkle).
                const g = alive ? (Math.floor(seed * 3 + t * (.5 + seed)) % 3) : Math.floor(hash2(cx0, cy0, 12) * 3);
                if (g !== group) continue;
                const r = .45 + hash2(cx0, cy0, 13) * .65;
                const px = X(cx0 * 5 + hash2(cx0, cy0, 14) * 5), py = Y(cy0 * 5 + hash2(cx0, cy0, 15) * 5);
                ctx.moveTo(px + r, py); ctx.arc(px, py, r, 0, Math.PI * 2);
              }
              ctx.fill();
            }
          }
        }
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
      if (!p.calm || z >= 3) lines(8, "23,52,74", .34, (.25 / z) * s);
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
    drawNow = () => { cancelAnimationFrame(raf); draw(performance.now()); };
    draw(performance.now());
    return () => {
      cancelAnimationFrame(raf); observer.disconnect(); window.clearTimeout(texTimer);
      // Release the nebula context when the Star Map unmounts (skipped in dev: StrictMode
      // remounts onto the same canvas, which would then only hand back the lost context).
      if (gl && !import.meta.env.DEV) gl.getExtension("WEBGL_lose_context")?.loseContext();
    };
  }, []);

  return <>
    <canvas ref={canvasRef} className="world-backdrop-layer" aria-hidden="true" />
    <canvas ref={glRef} className="world-backdrop-layer world-backdrop-nebula" aria-hidden="true" />
    <canvas ref={starsRef} className="world-backdrop-layer world-backdrop-stars" aria-hidden="true" />
  </>;
}
