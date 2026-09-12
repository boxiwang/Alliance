import { useEffect, useMemo, useRef, useState } from "react";
import {
  detectAutoTier, resolveGraphicsQuality, type GraphicsQuality, type GraphicsTier, type ResolvedTier,
} from "./lib/graphics-tier";
import { loadPlayerAccount, PLAYER_ACCOUNT_CHANGED_EVENT } from "./lib/player-account";

interface BatteryLike extends EventTarget { charging: boolean; level: number }

// Watch the account graphics setting + reduced-motion, detect the device once,
// and — only in Auto — ease the tier down when unplugged or when the frame
// rate can't hold. Everything funnels through resolveGraphicsQuality so the
// knob matrix stays the single source of truth.
export function useGraphicsQuality(address: string): GraphicsQuality {
  const [setting, setSetting] = useState<GraphicsTier>(() => loadPlayerAccount(address).graphicsTier);
  const [accountReduced, setAccountReduced] = useState<boolean>(() => loadPlayerAccount(address).reducedMotion);
  const [systemReduced, setSystemReduced] = useState(false);
  const [unplugged, setUnplugged] = useState(false);
  const [downgradeSteps, setDowngradeSteps] = useState(0);

  const autoTier = useMemo<ResolvedTier>(() => detectAutoTier(), []);

  // Account setting / reduced-motion, kept live across setting changes.
  useEffect(() => {
    const sync = () => { const a = loadPlayerAccount(address); setSetting(a.graphicsTier); setAccountReduced(a.reducedMotion); };
    sync();
    window.addEventListener(PLAYER_ACCOUNT_CHANGED_EVENT, sync);
    return () => window.removeEventListener(PLAYER_ACCOUNT_CHANGED_EVENT, sync);
  }, [address]);

  // System prefers-reduced-motion.
  useEffect(() => {
    if (typeof matchMedia !== "function") return;
    const mq = matchMedia("(prefers-reduced-motion: reduce)");
    const on = () => setSystemReduced(mq.matches);
    on();
    mq.addEventListener?.("change", on);
    return () => mq.removeEventListener?.("change", on);
  }, []);

  // Battery: Auto eases down while on battery power.
  useEffect(() => {
    const getBattery = (navigator as Navigator & { getBattery?: () => Promise<BatteryLike> }).getBattery;
    if (typeof getBattery !== "function") return;
    let battery: BatteryLike | null = null;
    let cancelled = false;
    const update = () => { if (battery) setUnplugged(!battery.charging || battery.level <= 0.2); };
    getBattery.call(navigator).then((b) => {
      if (cancelled) return;
      battery = b; update();
      b.addEventListener("chargingchange", update);
      b.addEventListener("levelchange", update);
    }).catch(() => {});
    return () => { cancelled = true; if (battery) { battery.removeEventListener("chargingchange", update); battery.removeEventListener("levelchange", update); } };
  }, []);

  // Runtime FPS probe — only meaningful in Auto. Hysteresis so we don't flap.
  const stepsRef = useRef(0);
  useEffect(() => {
    if (setting !== "auto") { stepsRef.current = 0; setDowngradeSteps(0); return; }
    let raf = 0; let windowStart = performance.now(); let frames = 0; let stopped = false;
    const tick = (t: number) => {
      if (stopped) return;
      frames++;
      const elapsed = t - windowStart;
      if (elapsed >= 2000) {
        const fps = (frames * 1000) / elapsed;
        if (fps < 45 && stepsRef.current < 2) { stepsRef.current++; setDowngradeSteps(stepsRef.current); }
        else if (fps > 55 && stepsRef.current > 0) { stepsRef.current--; setDowngradeSteps(stepsRef.current); }
        windowStart = t; frames = 0;
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => { stopped = true; cancelAnimationFrame(raf); };
  }, [setting]);

  return useMemo(
    () => resolveGraphicsQuality(setting, { autoTier, reducedMotion: accountReduced || systemReduced, unplugged, downgradeSteps }),
    [setting, autoTier, accountReduced, systemReduced, unplugged, downgradeSteps],
  );
}
