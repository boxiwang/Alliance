import { useEffect, useMemo, useRef, useState } from "react";
import { STRIKE_SIGNATURES, type StrikeSignatureId } from "./lib/player-account";
import {
  STRIKE_EFFECT_DURATION_MS, STRIKE_EFFECT_FRAME_SIZE, STRIKE_EFFECT_STAGES,
  drawStrikeEffect, drawStrikePreviewBackdrop, drawStrikePreviewTarget,
} from "./strike-effects";

export default function StrikeSignaturePreview({ signature, reducedMotion = false }: { signature: StrikeSignatureId; reducedMotion?: boolean }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [replay, setReplay] = useState(0);
  const definition = useMemo(() => STRIKE_SIGNATURES.find((item) => item.id === signature)!, [signature]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d", { alpha: false });
    if (!ctx) return;
    let frame = 0, width = 0, height = 0, dpr = 1;
    const startedAt = performance.now();
    const resize = () => {
      const rect = canvas.getBoundingClientRect();
      width = Math.max(260, rect.width); height = Math.max(220, rect.height); dpr = Math.min(2, window.devicePixelRatio || 1);
      canvas.width = Math.round(width * dpr); canvas.height = Math.round(height * dpr); ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      // Resizing clears the bitmap. Animated previews repaint on their next RAF;
      // the reduced-motion preview needs one explicitly or it remains blank.
      if (reducedMotion) { cancelAnimationFrame(frame); frame = requestAnimationFrame(render); }
    };
    const render = (time: number) => {
      const duration = STRIKE_EFFECT_DURATION_MS[signature], cycle = duration + 650;
      const progress = reducedMotion ? .76 : Math.min(1, ((time - startedAt) % cycle) / duration);
      drawStrikePreviewBackdrop(ctx, width, height, time);
      const x = width / 2, y = height * .5, targetRadius = Math.max(15, Math.min(23, width * .035));
      drawStrikePreviewTarget(ctx, x, y, targetRadius, definition.tier === "UR" && progress > .42 && progress < .8 ? .38 : 0);
      const scale = Math.min(width, height) * .92 / STRIKE_EFFECT_FRAME_SIZE[signature];
      drawStrikeEffect(ctx, signature, progress, x, y, scale, { bloom: 1, particleDensity: 1 });
      if (!reducedMotion) frame = requestAnimationFrame(render);
    };
    const observer = new ResizeObserver(resize); observer.observe(canvas); resize();
    frame = requestAnimationFrame(render);
    return () => { cancelAnimationFrame(frame); observer.disconnect(); };
  }, [definition.tier, reducedMotion, replay, signature]);

  return <div className={"strike-signature-preview strike-" + signature}>
    <canvas ref={canvasRef} role="img" aria-label={definition.name + " animated strike preview"} />
    <span className="strike-preview-tier"><i />{definition.tier}</span>
    <span className="strike-preview-sequence">{STRIKE_EFFECT_STAGES[signature]}</span>
    <button type="button" onClick={() => setReplay((value) => value + 1)}>RECAST</button>
    <small>TACTICAL IMPACT SIMULATION // LIVE</small>
  </div>;
}
