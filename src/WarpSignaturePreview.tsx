import { useEffect, useRef } from "react";
import type { WarpSignatureId } from "./lib/player-account";
import { warpSignatureFx } from "./warp-signatures";

const TAU = Math.PI * 2;
const PAUSE_MS = 1100;

/** Relic Vault preview: the arrival loops over a small starfield; the city appears when the relic delivers it. */
export default function WarpSignaturePreview({ signature, reducedMotion = false }: { signature: WarpSignatureId; reducedMotion?: boolean }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const canvas = ref.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return;
    const fx = warpSignatureFx(signature);
    const stars = Array.from({ length: 90 }, (_, i) => ({ x: (Math.sin(i * 91.7) + 1) / 2, y: (Math.sin(i * 47.3 + 2) + 1) / 2, a: .25 + ((i * 37) % 10) / 16, s: .6 + (i % 3) * .4 }));
    const started = performance.now();
    let raf = 0;
    const draw = (time: number) => {
      const rect = canvas.getBoundingClientRect(), dpr = Math.min(2, window.devicePixelRatio || 1);
      const w = Math.max(1, rect.width), h = Math.max(1, rect.height);
      if (canvas.width !== Math.round(w * dpr)) { canvas.width = Math.round(w * dpr); canvas.height = Math.round(h * dpr); }
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      const bg = ctx.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, Math.max(w, h) * .7);
      bg.addColorStop(0, "#0b1630"); bg.addColorStop(1, "#03060d");
      ctx.fillStyle = bg; ctx.fillRect(0, 0, w, h);
      for (const star of stars) { ctx.fillStyle = `rgba(200,225,255,${star.a})`; ctx.fillRect(star.x * w, star.y * h, star.s, star.s); }
      const cycle = fx.durationMs + PAUSE_MS, t = reducedMotion ? fx.durationMs : (time - started) % cycle;
      const x = w / 2, y = h / 2, r = Math.min(w, h) * .085;
      if (t >= fx.revealMs) {
        const halo = ctx.createRadialGradient(x, y, r * .8, x, y, r * 1.9);
        halo.addColorStop(0, "rgba(90,200,255,.35)"); halo.addColorStop(1, "rgba(90,200,255,0)");
        ctx.fillStyle = halo; ctx.beginPath(); ctx.arc(x, y, r * 1.9, 0, TAU); ctx.fill();
        const body = ctx.createRadialGradient(x - r * .35, y - r * .4, r * .1, x, y, r);
        body.addColorStop(0, "#c9f6ff"); body.addColorStop(.35, "#4fb8f0"); body.addColorStop(.75, "#1a4f9a"); body.addColorStop(1, "#0a1f45");
        ctx.fillStyle = body; ctx.beginPath(); ctx.arc(x, y, r, 0, TAU); ctx.fill();
      }
      if (t <= fx.durationMs) fx.draw(ctx, x, y, r, t, `preview:${signature}`);
      if (!reducedMotion) raf = requestAnimationFrame(draw);
    };
    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, [signature, reducedMotion]);
  return <canvas ref={ref} className="warp-signature-preview" aria-label="Warp arrival preview" />;
}
