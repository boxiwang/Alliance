import { useEffect, useRef, useState } from "react";
import type { HeadlessWorld, Point, WorldReport } from "./lib/world-engine";
import type { StrikeSignatureId } from "./lib/player-account";
import {
  STRIKE_EFFECT_DURATION_MS, STRIKE_EFFECT_IDS, STRIKE_EFFECT_WORLD_SIZE,
  beginStrikeFrameCacheBudget, drawCachedStrikeEffect, strikeFrameCacheStats,
} from "./strike-effects";

type Viewport = { x: number; y: number; width: number; height: number };
type ActiveStrike = {
  key: string;
  signature: StrikeSignatureId;
  position?: Point;
  normalized?: Point;
  targetKind: "city" | "monster" | "demo";
  startedAt: number;
};
export type StrikePerformanceMetrics = {
  active: number;
  stress: number;
  fps: number;
  frameP95Ms: number;
  drawP95Ms: number;
  longFrames: number;
  cacheEntries: number;
  cacheHitRate: number;
};

declare global {
  interface Window {
    __ALLIANCE_STRIKE_DIAGNOSTICS__?: StrikePerformanceMetrics;
  }
}

function percentile(samples: number[], ratio: number): number {
  if (!samples.length) return 0;
  const sorted = samples.slice().sort((left, right) => left - right);
  return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * ratio))];
}

function isStrikeReport(report: WorldReport): boolean {
  return report.stage === "arrival" && (report.action === "attack_city" || report.action === "attack_monster");
}

export function resolveStrikeArrival(world: HeadlessWorld, report: WorldReport): Pick<ActiveStrike, "signature" | "position" | "targetKind"> | null {
  if (!isStrikeReport(report)) return null;
  const march = world.marches[report.marchId], target = world.entities[report.targetId];
  if (!march || !target || (target.kind !== "city" && target.kind !== "monster")) return null;
  const signature = world.players[march.playerId]?.cosmetics?.strikeSignature;
  if (!signature || !STRIKE_EFFECT_IDS.includes(signature)) return null;
  return { signature, position: { ...target.position }, targetKind: target.kind };
}

export function strikeVisibleAtZoom(targetKind: ActiveStrike["targetKind"], zoom: number): boolean {
  return targetKind !== "city" || zoom >= 3;
}

export default function WorldStrikeLayer({
  world, viewport, zoom, gm, stressCount, burstNonce, dprCap = 2,
}: {
  world: HeadlessWorld;
  viewport: Viewport;
  zoom: number;
  gm: boolean;
  stressCount: number;
  burstNonce: number;
  /** Upper bound on canvas backing-store DPR — lower tiers cap this to save fill. */
  dprCap?: number;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const activeRef = useRef<ActiveStrike[]>([]);
  const knownReports = useRef<Set<string>>(new Set());
  const playedMarches = useRef<Set<string>>(new Set());
  const initializedReports = useRef(false);
  const rafRef = useRef<number | null>(null);
  const ensureLoopRef = useRef<() => void>(() => {});
  const latestRef = useRef({ world, viewport, zoom, stressCount });
  const [metrics, setMetrics] = useState<StrikePerformanceMetrics | null>(null);
  latestRef.current = { world, viewport, zoom, stressCount };

  useEffect(() => {
    const reports = Object.values(world.reports);
    if (!initializedReports.current) {
      reports.forEach((report) => { knownReports.current.add(report.id); if (isStrikeReport(report)) playedMarches.current.add(report.marchId); });
      initializedReports.current = true;
      return;
    }
    const discovered: ActiveStrike[] = [];
    reports.forEach((report) => {
      if (knownReports.current.has(report.id)) return;
      knownReports.current.add(report.id);
      if (!isStrikeReport(report) || playedMarches.current.has(report.marchId)) return;
      playedMarches.current.add(report.marchId);
      const strike = resolveStrikeArrival(world, report);
      if (!strike) return;
      discovered.push({ key: report.marchId, ...strike, startedAt: performance.now() });
    });
    if (discovered.length) {
      activeRef.current = activeRef.current.concat(discovered).slice(-128);
      ensureLoopRef.current();
    }
  }, [world.entities, world.marches, world.players, world.reports]);

  useEffect(() => {
    if (!burstNonce) return;
    const now = performance.now();
    activeRef.current = activeRef.current.concat(STRIKE_EFFECT_IDS.map((signature, index) => ({
      key: "gm-suite-" + burstNonce + "-" + signature,
      signature,
      normalized: { x: (index % 4 + .5) / 4, y: (Math.floor(index / 4) + .5) / 2 },
      targetKind: "demo" as const,
      startedAt: now + index * 70,
    }))).slice(-128);
    ensureLoopRef.current();
  }, [burstNonce]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d", { alpha: true, desynchronized: true });
    if (!ctx) return;
    let width = 0, height = 0, dpr = 1, lastFrame = 0, lastMetrics = 0, longFrames = 0;
    const frameSamples: number[] = [], drawSamples: number[] = [];
    const resize = () => {
      const rect = canvas.getBoundingClientRect();
      width = Math.max(1, rect.width); height = Math.max(1, rect.height); dpr = Math.min(dprCap, window.devicePixelRatio || 1);
      const nextWidth = Math.round(width * dpr), nextHeight = Math.round(height * dpr);
      if (canvas.width !== nextWidth || canvas.height !== nextHeight) { canvas.width = nextWidth; canvas.height = nextHeight; }
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };
    const observer = new ResizeObserver(resize); observer.observe(canvas); resize();

    const render = (time: number) => {
      rafRef.current = null;
      if (document.hidden) return;
      const frameDelta = lastFrame ? time - lastFrame : 16.7; lastFrame = time;
      frameSamples.push(frameDelta); if (frameSamples.length > 240) frameSamples.shift(); if (frameDelta > 33.4) longFrames += 1;
      const drawStarted = performance.now(), latest = latestRef.current;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0); ctx.clearRect(0, 0, width, height);
      beginStrikeFrameCacheBudget(2);

      activeRef.current = activeRef.current.filter((strike) => time - strike.startedAt <= STRIKE_EFFECT_DURATION_MS[strike.signature] + 80);
      const screenScale = latest.zoom < 3 ? .78 : Math.min(1.12, .92 + Math.log2(latest.zoom / 3) * .07);
      let drawn = 0;
      activeRef.current.forEach((strike) => {
        const elapsed = time - strike.startedAt;
        if (elapsed < 0) return;
        if (!strikeVisibleAtZoom(strike.targetKind, latest.zoom)) return;
        const x = strike.normalized ? strike.normalized.x * width : ((strike.position!.x - latest.viewport.x) / latest.viewport.width) * width;
        const y = strike.normalized ? strike.normalized.y * height : ((strike.position!.y - latest.viewport.y) / latest.viewport.height) * height;
        const margin = STRIKE_EFFECT_WORLD_SIZE[strike.signature] * screenScale * .55;
        if (x < -margin || x > width + margin || y < -margin || y > height + margin) return;
        drawCachedStrikeEffect(ctx, strike.signature, elapsed / STRIKE_EFFECT_DURATION_MS[strike.signature], x, y, screenScale); drawn += 1;
      });

      if (latest.stressCount > 0) {
        const columns = Math.max(1, Math.ceil(Math.sqrt(latest.stressCount * Math.max(1, width / height))));
        const rows = Math.max(1, Math.ceil(latest.stressCount / columns));
        for (let index = 0; index < latest.stressCount; index += 1) {
          const signature = STRIKE_EFFECT_IDS[index % STRIKE_EFFECT_IDS.length], duration = STRIKE_EFFECT_DURATION_MS[signature];
          // Keep every synthetic impact on a different deterministic phase. If we
          // align copies of the same imprint, a stress run only measures drawImage
          // fan-out and hides the expensive many-battle case from the profiler.
          const cycle = duration + 420, phaseOffset = (index * 137 + Math.floor(index / STRIKE_EFFECT_IDS.length) * 359) % cycle;
          const elapsed = (time + phaseOffset) % cycle;
          const progress = Math.min(1, elapsed / duration), x = (index % columns + .5) / columns * width, y = (Math.floor(index / columns) + .5) / rows * height;
          const tileScale = Math.min(screenScale, Math.max(.24, Math.min(width / columns, height / rows) / STRIKE_EFFECT_WORLD_SIZE[signature] * 1.3));
          drawCachedStrikeEffect(ctx, signature, progress, x, y, tileScale); drawn += 1;
        }
      }

      const drawDuration = performance.now() - drawStarted; drawSamples.push(drawDuration); if (drawSamples.length > 240) drawSamples.shift();
      if (gm && time - lastMetrics > 700) {
        const cache = strikeFrameCacheStats(), totalCache = cache.hits + cache.misses;
        const next = {
          active: drawn, stress: latest.stressCount,
          fps: Math.round(10000 / (frameSamples.reduce((sum, value) => sum + value, 0) / Math.max(1, frameSamples.length))) / 10,
          frameP95Ms: Math.round(percentile(frameSamples, .95) * 10) / 10,
          drawP95Ms: Math.round(percentile(drawSamples, .95) * 10) / 10,
          longFrames, cacheEntries: cache.entries, cacheHitRate: Math.round((totalCache ? cache.hits / totalCache : 0) * 1000) / 10,
        };
        setMetrics(next); window.__ALLIANCE_STRIKE_DIAGNOSTICS__ = next; lastMetrics = time;
      }
      if (activeRef.current.length || latest.stressCount > 0) rafRef.current = requestAnimationFrame(render);
    };
    ensureLoopRef.current = () => { if (rafRef.current == null) { lastFrame = 0; rafRef.current = requestAnimationFrame(render); } };
    if (stressCount > 0 || activeRef.current.length) ensureLoopRef.current();
    const onVisibility = () => { if (!document.hidden && (latestRef.current.stressCount > 0 || activeRef.current.length)) ensureLoopRef.current(); };
    document.addEventListener("visibilitychange", onVisibility);
    return () => { if (rafRef.current != null) cancelAnimationFrame(rafRef.current); rafRef.current = null; observer.disconnect(); document.removeEventListener("visibilitychange", onVisibility); delete window.__ALLIANCE_STRIKE_DIAGNOSTICS__; };
  }, [gm, dprCap]);

  useEffect(() => { if (stressCount > 0) ensureLoopRef.current(); }, [stressCount]);

  return <>
    <canvas ref={canvasRef} className="world-strike-layer" aria-hidden="true" data-strike-stress={stressCount} />
    {gm && metrics && (stressCount > 0 || metrics.active > 0) && <output className="world-strike-metrics" aria-label="Strike renderer performance">
      <b>STRIKE COMPOSITOR</b><span>{metrics.active} LIVE</span><span>{metrics.fps} FPS</span><span>P95 {metrics.frameP95Ms}MS</span><span>DRAW {metrics.drawP95Ms}MS</span><span>CACHE {metrics.cacheHitRate}%</span>
    </output>}
  </>;
}
