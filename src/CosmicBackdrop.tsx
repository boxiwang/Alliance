import { useEffect, useRef } from "react";

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

export default function CosmicBackdrop() {
  const canvasRef = useRef<HTMLCanvasElement>(null);

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

    const resize = () => {
      const ratio = Math.min(2, window.devicePixelRatio || 1);
      width = Math.max(1, window.innerWidth);
      height = Math.max(1, window.innerHeight);
      canvas.width = Math.round(width * ratio);
      canvas.height = Math.round(height * ratio);
      canvas.style.width = `${width}px`;
      canvas.style.height = `${height}px`;
      context.setTransform(ratio, 0, 0, ratio, 0, 0);

      const random = seededRandom(4663 + width * 7 + height * 13);
      const count = Math.max(120, Math.min(360, Math.round((width * height) / 4300)));
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

    const draw = (timestamp: number) => {
      const seconds = timestamp / 1000;
      context.clearRect(0, 0, width, height);
      for (const star of stars) {
        const x = wrap(star.x + seconds * star.vx, width);
        const y = wrap(star.y + seconds * star.vy, height);
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
      if (!reducedMotion) animationFrame = window.requestAnimationFrame(draw);
    };

    resize();
    window.addEventListener("resize", resize);
    animationFrame = window.requestAnimationFrame(draw);
    return () => {
      window.removeEventListener("resize", resize);
      window.cancelAnimationFrame(animationFrame);
    };
  }, []);

  return (
    <div className="cosmic-backdrop" aria-hidden="true">
      <div className="cosmic-nebula" />
      <canvas ref={canvasRef} />
    </div>
  );
}
