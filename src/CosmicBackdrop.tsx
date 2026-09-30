import { useEffect, useRef, useState } from "react";
import { detectAutoTier, resolveGraphicsQuality } from "./lib/graphics-tier";
import { loadPlayerAccount, PLAYER_ACCOUNT_CHANGED_EVENT } from "./lib/player-account";

type Star = {
  x: number;
  y: number;
  radius: number;
  alpha: number;
  phase: number;
  twinkle: number;
  vx: number;
  vy: number;
  glow: boolean;
};

function seededRandom(seed: number) {
  let value = seed >>> 0;
  return () => {
    value += 0x6d2b79f5;
    let next = value;
    next = Math.imul(next ^ (next >>> 15), next | 1);
    next ^= next + Math.imul(next ^ (next >>> 7), next | 61);
    return ((next ^ (next >>> 14)) >>> 0) / 4294967296;
  };
}

function wrap(value: number, limit: number) {
  return ((value % limit) + limit) % limit;
}

function backgroundShouldAnimate(address: string): boolean {
  if (!address) return true;
  const account = loadPlayerAccount(address);
  return resolveGraphicsQuality(account.graphicsTier, {
    autoTier: detectAutoTier(),
    reducedMotion: account.reducedMotion,
  }).bgAnimate;
}

export default function CosmicBackdrop({ address = "" }: { address?: string }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [animate, setAnimate] = useState(() => backgroundShouldAnimate(address));

  useEffect(() => {
    const refresh = () => setAnimate(backgroundShouldAnimate(address));
    refresh();
    window.addEventListener(PLAYER_ACCOUNT_CHANGED_EVENT, refresh);
    window.addEventListener("storage", refresh);
    return () => {
      window.removeEventListener(PLAYER_ACCOUNT_CHANGED_EVENT, refresh);
      window.removeEventListener("storage", refresh);
    };
  }, [address]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const context = canvas.getContext("2d");
    if (!context) return;

    const reducedMotion = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
    let width = 1;
    let height = 1;
    let stars: Star[] = [];
    let animationFrame = 0;
    const motionScale = reducedMotion ? 0.5 : 1;

    const resize = () => {
      const ratio = Math.min(1.5, window.devicePixelRatio || 1);
      width = Math.max(1, window.innerWidth);
      height = Math.max(1, window.innerHeight);
      canvas.width = Math.round(width * ratio);
      canvas.height = Math.round(height * ratio);
      canvas.style.width = `${width}px`;
      canvas.style.height = `${height}px`;
      context.setTransform(ratio, 0, 0, ratio, 0, 0);

      const random = seededRandom(4663 + width * 7 + height * 13);
      const count = Math.max(90, Math.min(220, Math.round((width * height) / 7200)));
      stars = Array.from({ length: count }, (_, index) => {
        const depth = index % 3;
        const depthSpeed = [0.7, 1.25, 2][depth];
        return {
          x: random() * width,
          y: random() * height,
          radius: (0.35 + random() * 0.7) * [0.72, 1, 1.28][depth],
          alpha: 0.2 + random() * 0.5,
          phase: random() * Math.PI * 2,
          twinkle: 0.24 + random() * 0.5,
          vx: (0.16 + random() * 0.2) * depthSpeed * (random() > 0.2 ? 1 : -1),
          vy: (0.05 + random() * 0.12) * depthSpeed,
          glow: depth === 2 && random() > 0.86,
        };
      });
    };

    // Rare shooting stars (motion allowed only): one every ~25–50 s, a short fading streak.
    type Meteor = { x: number; y: number; vx: number; vy: number; born: number; life: number };
    let meteor: Meteor | null = null;
    let nextMeteor = performance.now() + 8000 + Math.random() * 14000;
    const drawMeteor = (now: number) => {
      if (reducedMotion) return;
      if (!meteor && now >= nextMeteor) {
        const angle = (0.12 + Math.random() * 0.3) * Math.PI;
        const speed = 0.55 + Math.random() * 0.35;
        meteor = { x: width * (0.15 + Math.random() * 0.7), y: height * (0.05 + Math.random() * 0.35), vx: Math.cos(angle) * speed * (Math.random() > 0.5 ? 1 : -1), vy: Math.sin(angle) * speed, born: now, life: 900 + Math.random() * 500 };
        nextMeteor = now + 25000 + Math.random() * 25000;
      }
      if (!meteor) return;
      const age = now - meteor.born;
      if (age > meteor.life) { meteor = null; return; }
      const k = age / meteor.life, fade = Math.sin(Math.PI * k);
      const hx = meteor.x + meteor.vx * age, hy = meteor.y + meteor.vy * age;
      const tail = 90 + 60 * fade, tx = hx - meteor.vx / Math.hypot(meteor.vx, meteor.vy) * tail, ty = hy - meteor.vy / Math.hypot(meteor.vx, meteor.vy) * tail;
      const gradient = context.createLinearGradient(hx, hy, tx, ty);
      gradient.addColorStop(0, `rgba(235,246,255,${0.85 * fade})`);
      gradient.addColorStop(1, "rgba(150,200,255,0)");
      context.strokeStyle = gradient; context.lineWidth = 1.4; context.lineCap = "round";
      context.beginPath(); context.moveTo(hx, hy); context.lineTo(tx, ty); context.stroke();
    };

    let last = 0;
    const draw = (timestamp: number) => {
      if (animate) animationFrame = window.requestAnimationFrame(draw);
      if (document.hidden) return;        // don't burn CPU/GPU when the tab/window is hidden
      if (timestamp - last < 33) return;  // cap ~30fps — plenty for an ambient starfield
      last = timestamp;
      const seconds = timestamp / 1000;
      context.clearRect(0, 0, width, height);
      for (const star of stars) {
        const x = wrap(star.x + seconds * star.vx * motionScale, width);
        const y = wrap(star.y + seconds * star.vy * motionScale, height);
        const pulse = reducedMotion ? 0 : Math.sin(seconds * star.twinkle + star.phase) * 0.13;
        const alpha = Math.max(0.12, Math.min(0.9, star.alpha + pulse));
        const tone = star.phase > Math.PI ? "190,225,255" : "213,203,255";

        if (star.glow) {
          context.beginPath();
          context.fillStyle = `rgba(${tone},${alpha * 0.13})`;
          context.arc(x, y, star.radius * 4.2, 0, Math.PI * 2);
          context.fill();
        }
        context.beginPath();
        context.fillStyle = `rgba(${tone},${alpha})`;
        context.arc(x, y, star.radius, 0, Math.PI * 2);
        context.fill();
      }
      if (animate) drawMeteor(timestamp);
    };

    resize();
    window.addEventListener("resize", resize);
    animationFrame = window.requestAnimationFrame(draw);
    return () => {
      window.removeEventListener("resize", resize);
      window.cancelAnimationFrame(animationFrame);
    };
  }, [animate]);

  return (
    <div className={`cosmic-backdrop${animate ? " is-moving" : " is-still"}`} aria-hidden="true">
      <div className="cosmic-nebula" />
      <div className="cosmic-nebula drift-b" />
      <canvas ref={canvasRef} />
    </div>
  );
}
