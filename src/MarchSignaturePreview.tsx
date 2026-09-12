import { useEffect, useRef, useState } from "react";
import { MARCH_SIGNATURES, type MarchSignatureId } from "./lib/player-account";

type Color = [number, number, number];
type Point = { x: number; y: number; dx: number; dy: number };
type TrailPoint = Point & { t: number; ang: number; f: number };
type Ember = { x: number; y: number; vx: number; vy: number; t: number; life: number };

const COLORS = {
  cyan: [89, 220, 255] as Color,
  violet: [169, 108, 255] as Color,
  gold: [243, 196, 107] as Color,
  red: [255, 95, 120] as Color,
  ink: [234, 244, 255] as Color,
  aurora: [79, 240, 208] as Color,
};

const INTENTS = [
  { name: "SCOUT", color: COLORS.cyan, css: "#59dcff" },
  { name: "GATHER", color: COLORS.gold, css: "#f3c46b" },
  { name: "ATTACK", color: COLORS.red, css: "#ff5f78" },
];

const rgba = (color: Color, alpha: number) => `rgba(${color[0]},${color[1]},${color[2]},${alpha})`;
const mix = (a: Color, b: Color, amount: number): Color => [a[0] + (b[0] - a[0]) * amount, a[1] + (b[1] - a[1]) * amount, a[2] + (b[2] - a[2]) * amount];

function seeded(seed: number) {
  return () => {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return seed / 4294967296;
  };
}

/** The Vault renderer mirrors Claude's Genesis-drop Canvas reference. */
export default function MarchSignaturePreview({ signature }: { signature: MarchSignatureId }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [intentIndex, setIntentIndex] = useState(0);
  const definition = MARCH_SIGNATURES.find((item) => item.id === signature) || MARCH_SIGNATURES[0];

  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return;

    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const trail: TrailPoint[] = [];
    const embers: Ember[] = [];
    let stars: Array<{ x: number; y: number; r: number; a: number; tw: number }> = [];
    let width = 2;
    let height = 2;
    let start = performance.now() - 6800;
    let arrivedAt = 0;
    let departAt = start;
    let lastSample = 0;
    let loops = 0;
    let frameId = 0;

    const pathPoint = (amount: number): Point => {
      const p0 = { x: 0.12, y: 0.72 };
      const control = { x: 0.51, y: 0.12 };
      const p2 = { x: 0.9, y: 0.42 };
      const inverse = 1 - amount;
      return {
        x: (inverse * inverse * p0.x + 2 * inverse * amount * control.x + amount * amount * p2.x) * width,
        y: (inverse * inverse * p0.y + 2 * inverse * amount * control.y + amount * amount * p2.y) * height,
        dx: (2 * inverse * (control.x - p0.x) + 2 * amount * (p2.x - control.x)) * width,
        dy: (2 * inverse * (control.y - p0.y) + 2 * amount * (p2.y - control.y)) * height,
      };
    };

    const accent = (): Color => {
      if (signature === "ion-wake") return COLORS.cyan;
      if (signature === "warp-thread") return COLORS.violet;
      if (signature === "aurora-sail") return COLORS.aurora;
      return INTENTS[loops % INTENTS.length].color;
    };

    const resize = () => {
      const rect = canvas.getBoundingClientRect();
      width = Math.max(2, rect.width);
      height = Math.max(2, rect.height);
      canvas.width = Math.round(width * dpr);
      canvas.height = Math.round(height * dpr);
      const random = seeded(1337 + Math.round(width));
      stars = Array.from({ length: 54 }, () => ({ x: random(), y: random(), r: 0.4 + random() * 1.1, a: 0.15 + random() * 0.5, tw: random() * Math.PI * 2 }));
    };

    const drawNode = (point: Point, color: Color, home: boolean) => {
      ctx.globalCompositeOperation = "lighter";
      const glow = ctx.createRadialGradient(point.x, point.y, 0, point.x, point.y, 16);
      glow.addColorStop(0, rgba(color, 0.48));
      glow.addColorStop(1, rgba(color, 0));
      ctx.fillStyle = glow;
      ctx.beginPath();
      ctx.arc(point.x, point.y, 16, 0, Math.PI * 2);
      ctx.fill();
      ctx.globalCompositeOperation = "source-over";
      if (home) {
        ctx.save();
        ctx.translate(point.x, point.y);
        ctx.rotate(Math.PI / 4);
        ctx.fillStyle = rgba(color, 0.95);
        ctx.fillRect(-3.4, -3.4, 6.8, 6.8);
        ctx.restore();
      } else {
        ctx.strokeStyle = rgba(color, 0.85);
        ctx.lineWidth = 1.4;
        ctx.beginPath();
        ctx.arc(point.x, point.y, 5.4, 0, Math.PI * 2);
        ctx.stroke();
        ctx.fillStyle = rgba(color, 0.9);
        ctx.beginPath();
        ctx.arc(point.x, point.y, 1.7, 0, Math.PI * 2);
        ctx.fill();
      }
    };

    const drawHull = (current: Point, angle: number, color: Color) => {
      ctx.save();
      ctx.translate(current.x, current.y);
      ctx.rotate(angle);
      const glow = ctx.createRadialGradient(0, 0, 0, 0, 0, 12);
      glow.addColorStop(0, rgba(color, 0.55));
      glow.addColorStop(1, rgba(color, 0));
      ctx.fillStyle = glow;
      ctx.beginPath();
      ctx.arc(0, 0, 12, 0, Math.PI * 2);
      ctx.fill();
      const hull = ctx.createLinearGradient(-6, 0, 9, 0);
      hull.addColorStop(0, rgba(color, 0.2));
      hull.addColorStop(0.7, rgba(color, 0.9));
      hull.addColorStop(1, "#f5fbff");
      ctx.fillStyle = hull;
      ctx.beginPath();
      ctx.moveTo(9, 0);
      ctx.lineTo(0, 3.6);
      ctx.lineTo(-6, 0);
      ctx.lineTo(0, -3.6);
      ctx.closePath();
      ctx.fill();
      ctx.strokeStyle = "rgba(255,255,255,.55)";
      ctx.lineWidth = 0.7;
      ctx.stroke();
      ctx.fillStyle = "white";
      ctx.beginPath();
      ctx.arc(1.8, 0, 1.25, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    };

    const drawIon = (current: Point, angle: number, now: number) => {
      for (let index = 1; index < trail.length; index++) {
        const a = trail[index - 1];
        const b = trail[index];
        const age = (now - b.t) / 2600;
        if (age > 1) continue;
        ctx.strokeStyle = rgba(COLORS.cyan, (1 - age) * 0.5);
        ctx.lineWidth = (1 - age) * 2.2;
        ctx.beginPath();
        ctx.moveTo(a.x, a.y);
        ctx.lineTo(b.x, b.y);
        ctx.stroke();
      }
      for (let index = 0; index < trail.length; index += 3) {
        const point = trail[index];
        const age = (now - point.t) / 2900;
        if (age > 1) continue;
        const offset = (index % 2 ? 1 : -1) * age * 7;
        ctx.fillStyle = rgba([190, 240, 255], (1 - age) * 0.6);
        ctx.beginPath();
        ctx.arc(point.x - Math.sin(point.ang) * offset, point.y + Math.cos(point.ang) * offset, (1 - age) * 1.6, 0, Math.PI * 2);
        ctx.fill();
      }
      drawHull(current, angle, COLORS.cyan);
    };

    const drawWarp = (current: Point, angle: number, now: number) => {
      const offsetPoint = (point: TrailPoint, amount: number) => ({ x: point.x - Math.sin(point.ang) * amount, y: point.y + Math.cos(point.ang) * amount });
      for (const direction of [1, -1]) {
        ctx.strokeStyle = rgba(COLORS.violet, 0.14);
        ctx.lineWidth = 1;
        ctx.beginPath();
        let moved = false;
        trail.forEach((point) => {
          const age = (now - point.t) / 4200;
          if (age > 1) return;
          const p = offsetPoint(point, direction * (3.4 * (1 - age) + 0.8));
          moved ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y);
          moved = true;
        });
        ctx.stroke();
      }
      const braid = (phase: number, color: Color, lineWidth: number, alpha: number) => {
        ctx.strokeStyle = rgba(color, alpha);
        ctx.lineWidth = lineWidth;
        ctx.beginPath();
        let moved = false;
        trail.forEach((point, index) => {
          const age = (now - point.t) / 4200;
          if (age > 1) return;
          const p = offsetPoint(point, Math.sin(index * 0.6 - now / 150 + phase) * 4.6 * (1 - age));
          moved ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y);
          moved = true;
        });
        ctx.stroke();
      };
      braid(0, COLORS.violet, 2.2, 0.55);
      braid(Math.PI, COLORS.cyan, 1.7, 0.5);
      ctx.save();
      ctx.translate(current.x, current.y);
      ctx.rotate(angle);
      for (let ring = 1; ring <= 3; ring++) {
        ctx.strokeStyle = rgba(COLORS.cyan, (4 - ring) / 12);
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.arc(3, 0, 4 + ring * 3, -0.75, 0.75);
        ctx.stroke();
      }
      for (let radius = 9; radius >= 4; radius -= 2.5) {
        ctx.strokeStyle = rgba(COLORS.violet, 0.14 * (9 / radius));
        ctx.beginPath();
        ctx.arc(0, 0, radius + Math.sin(now / 260) * 1.1, 0, Math.PI * 2);
        ctx.stroke();
      }
      ctx.fillStyle = rgba(COLORS.cyan, 0.7);
      ctx.beginPath(); ctx.arc(-0.9, 0, 2.3, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = rgba(COLORS.violet, 0.7);
      ctx.beginPath(); ctx.arc(0.9, 0, 2.3, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = "#f0f8ff";
      ctx.beginPath(); ctx.arc(0, 0, 1.9, 0, Math.PI * 2); ctx.fill();
      ctx.restore();
    };

    const drawAurora = (current: Point, angle: number, now: number) => {
      const frequency = 0.13;
      const drift = now / 900;
      const amplitude = 10.5;
      const ribbon = (baseWidth: number, alpha: number) => {
        for (let index = 1; index < trail.length; index++) {
          const a = trail[index - 1];
          const b = trail[index];
          const age = (now - b.t) / 5200;
          if (age > 1) continue;
          const halfWidth = (1 - age) * baseWidth + 1.6;
          const waveA = Math.sin((index - 1) * frequency - drift) * amplitude * (1 - age);
          const waveB = Math.sin(index * frequency - drift) * amplitude * (1 - age);
          const normalA = { x: -Math.sin(a.ang), y: Math.cos(a.ang) };
          const normalB = { x: -Math.sin(b.ang), y: Math.cos(b.ang) };
          const color = b.f < 0.5 ? mix(COLORS.aurora, COLORS.cyan, b.f * 2) : mix(COLORS.cyan, COLORS.violet, (b.f - 0.5) * 2);
          ctx.fillStyle = rgba(color, (1 - age) * alpha);
          ctx.beginPath();
          ctx.moveTo(a.x + normalA.x * (halfWidth + waveA), a.y + normalA.y * (halfWidth + waveA));
          ctx.lineTo(b.x + normalB.x * (halfWidth + waveB), b.y + normalB.y * (halfWidth + waveB));
          ctx.lineTo(b.x + normalB.x * (-halfWidth + waveB), b.y + normalB.y * (-halfWidth + waveB));
          ctx.lineTo(a.x + normalA.x * (-halfWidth + waveA), a.y + normalA.y * (-halfWidth + waveA));
          ctx.closePath();
          ctx.fill();
        }
      };
      ribbon(15, 0.07);
      ribbon(9, 0.17);
      ctx.strokeStyle = rgba(COLORS.cyan, 0.5);
      ctx.lineWidth = 1.4;
      ctx.beginPath();
      let moved = false;
      trail.forEach((point, index) => {
        const age = (now - point.t) / 5200;
        if (age > 1) return;
        const wobble = Math.sin(index * frequency - drift) * amplitude * (1 - age);
        const x = point.x - Math.sin(point.ang) * wobble;
        const y = point.y + Math.cos(point.ang) * wobble;
        moved ? ctx.lineTo(x, y) : ctx.moveTo(x, y);
        moved = true;
      });
      ctx.stroke();
      drawHull(current, angle, COLORS.aurora);
    };

    const drawComet = (current: Point, now: number) => {
      const color = accent();
      trail.forEach((point) => {
        const age = (now - point.t) / 3800;
        if (age > 1) return;
        ctx.fillStyle = rgba(color, (1 - age) * 0.34);
        ctx.beginPath();
        ctx.arc(point.x, point.y, (1 - age) * 4.2 + 0.4, 0, Math.PI * 2);
        ctx.fill();
      });
      for (let index = embers.length - 1; index >= 0; index--) {
        const ember = embers[index];
        const age = (now - ember.t) / ember.life;
        if (age >= 1) { embers.splice(index, 1); continue; }
        ember.x += ember.vx;
        ember.y += ember.vy;
        ctx.fillStyle = rgba(color, (1 - age) * 0.8);
        ctx.beginPath();
        ctx.arc(ember.x, ember.y, (1 - age) * 1.5 + 0.3, 0, Math.PI * 2);
        ctx.fill();
      }
      const glow = ctx.createRadialGradient(current.x, current.y, 0, current.x, current.y, 13);
      glow.addColorStop(0, rgba(color, 0.85));
      glow.addColorStop(0.4, rgba(color, 0.35));
      glow.addColorStop(1, rgba(color, 0));
      ctx.fillStyle = glow;
      ctx.beginPath(); ctx.arc(current.x, current.y, 13, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = "rgba(255,255,255,.95)";
      ctx.beginPath(); ctx.arc(current.x, current.y, 2.4, 0, Math.PI * 2); ctx.fill();
    };

    const drawFrame = (now: number) => {
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, width, height);
      ctx.globalCompositeOperation = "source-over";
      stars.forEach((star) => {
        const twinkle = reduce ? 1 : 0.55 + 0.45 * Math.sin(now / 700 + star.tw);
        ctx.fillStyle = rgba(COLORS.ink, star.a * 0.5 * twinkle);
        ctx.beginPath(); ctx.arc(star.x * width, star.y * height, star.r, 0, Math.PI * 2); ctx.fill();
      });

      const home = pathPoint(0);
      const target = pathPoint(1);
      ctx.save();
      ctx.setLineDash([4, 7]);
      ctx.lineWidth = 1;
      ctx.strokeStyle = "rgba(96,150,196,.22)";
      ctx.beginPath(); ctx.moveTo(home.x, home.y);
      for (let amount = 0; amount <= 1.001; amount += 0.05) { const point = pathPoint(amount); ctx.lineTo(point.x, point.y); }
      ctx.stroke();
      ctx.restore();

      const travelMs = signature === "warp-thread" ? 22000 : 20000;
      let linear = (now - start) / travelMs;
      let arrived = false;
      if (linear >= 1) {
        linear = 1;
        arrived = true;
        if (!arrivedAt) arrivedAt = now;
        if (now - arrivedAt > 1400) {
          start = now;
          departAt = now;
          arrivedAt = 0;
          trail.length = 0;
          embers.length = 0;
          loops++;
          if (signature === "comet-vanguard") setIntentIndex(loops % INTENTS.length);
        }
      }
      if (reduce) linear = 0.6;
      const progress = linear * linear * (3 - 2 * linear);
      const current = pathPoint(progress);
      const angle = Math.atan2(current.dy, current.dx);

      drawNode(home, COLORS.violet, true);
      drawNode(target, accent(), false);
      const departure = now - departAt;
      if (departure < 520 && !arrived) {
        const amount = departure / 520;
        ctx.globalCompositeOperation = "lighter";
        ctx.strokeStyle = rgba(accent(), (1 - amount) * 0.6);
        ctx.lineWidth = 2;
        ctx.beginPath(); ctx.arc(home.x, home.y, 6 + amount * 22, 0, Math.PI * 2); ctx.stroke();
      }

      if (!arrived && !reduce && now - lastSample > 45) {
        lastSample = now;
        trail.push({ ...current, t: now, ang: angle, f: progress });
        if (trail.length > 260) trail.shift();
        if (signature === "comet-vanguard") {
          embers.push({
            x: current.x, y: current.y,
            vx: -Math.cos(angle) * (0.25 + Math.random() * 0.4) + (Math.random() - 0.5) * 0.5,
            vy: -Math.sin(angle) * (0.25 + Math.random() * 0.4) + (Math.random() - 0.5) * 0.5,
            t: now, life: 1600 + Math.random() * 1400,
          });
        }
      } else if (reduce && trail.length === 0) {
        for (let amount = 0; amount < progress; amount += 0.02) {
          const point = pathPoint(amount);
          trail.push({ ...point, t: now - (progress - amount) * travelMs, ang: Math.atan2(point.dy, point.dx), f: amount });
        }
      }

      ctx.globalCompositeOperation = "lighter";
      if (signature === "ion-wake") drawIon(current, angle, now);
      else if (signature === "warp-thread") drawWarp(current, angle, now);
      else if (signature === "aurora-sail") drawAurora(current, angle, now);
      else drawComet(current, now);

      if (arrivedAt) {
        const amount = Math.min(1, (now - arrivedAt) / 600);
        if (signature === "warp-thread") {
          const collapse = amount < 0.5 ? amount * 2 : (1 - amount) * 2;
          ctx.fillStyle = rgba(accent(), (1 - amount) * 0.9);
          ctx.beginPath(); ctx.arc(target.x, target.y, 2 + collapse * 10, 0, Math.PI * 2); ctx.fill();
        }
        ctx.strokeStyle = rgba(accent(), (1 - amount) * 0.7);
        ctx.lineWidth = 1.5;
        ctx.beginPath(); ctx.arc(target.x, target.y, 4 + amount * 20, 0, Math.PI * 2); ctx.stroke();
      }
      ctx.globalCompositeOperation = "source-over";
    };

    const loop = (now: number) => {
      drawFrame(now);
      if (!reduce && !document.hidden) frameId = requestAnimationFrame(loop);
    };
    const onVisibility = () => {
      cancelAnimationFrame(frameId);
      if (!document.hidden && !reduce) frameId = requestAnimationFrame(loop);
    };
    resize();
    const observer = new ResizeObserver(resize);
    observer.observe(canvas);
    document.addEventListener("visibilitychange", onVisibility);
    frameId = requestAnimationFrame(loop);
    return () => {
      cancelAnimationFrame(frameId);
      observer.disconnect();
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [signature]);

  const intent = INTENTS[intentIndex];
  return <div className={`march-signature-preview march-${signature}`}>
    <canvas ref={canvasRef} aria-label={`${definition.name} animated fleet signature`} />
    <span className="march-preview-tier"><i />{definition.tier}</span>
    {signature === "comet-vanguard" && <span className="march-preview-intent">INTENT · <b style={{ color: intent.css }}>{intent.name}</b></span>}
    <small>FLEET VECTOR // LIVE SIGNATURE</small>
  </div>;
}
