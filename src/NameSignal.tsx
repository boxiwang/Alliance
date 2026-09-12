import { useEffect, useRef } from "react";
import type { ChatSignalId } from "./lib/player-account";

type NameSignalMode = "once" | "demo" | "static";

function SovereignNameCrown() {
  return <svg className="name-signal-crown" viewBox="0 -9 30 31" aria-hidden="true">
    <path d="M3 17 6.5 7 11 12 15 3 19 12 23.5 7 27 17Z" />
    <rect x="2.5" y="15.5" width="25" height="4.6" rx="1.5" />
    <circle cx="6.5" cy="7" r="1.15" /><circle cx="23.5" cy="7" r="1.15" />
    <circle className="name-signal-keystone" cx="15" cy="17.8" r="1.5" />
    <path className="name-signal-crown-star" d="M15-8 16.3-4 20-3 16.3-2 15 2 13.7-2 10-3 13.7-4Z" />
  </svg>;
}

function smooth(value: number): number { return value * value * (3 - 2 * value); }

/** Rich commander-name treatment. Canvas tiers settle into readable text in live feeds. */
export default function NameSignal({
  signal, children, mode = "once", reducedMotion = false, className = "",
}: {
  signal: ChatSignalId | null | undefined;
  children: string;
  mode?: NameSignalMode;
  reducedMotion?: boolean;
  className?: string;
}) {
  const id = signal || "clear-channel";
  const rootRef = useRef<HTMLSpanElement>(null);
  const textRef = useRef<HTMLSpanElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const rich = id === "void-whisper" || id === "ember-cipher" || id === "eclipse-herald";

  useEffect(() => {
    const root = rootRef.current;
    const text = textRef.current;
    const canvas = canvasRef.current;
    const systemReduced = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
    if (!root || !text || !canvas || !rich || mode === "static" || reducedMotion || systemReduced) return;
    const context = canvas.getContext("2d");
    if (!context) return;

    let width = 24;
    let height = 22;
    const padX = 18;
    const padY = 10;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    let raf = 0;
    let visible = true;
    let disposed = false;
    let last = performance.now();
    const started = last;
    const particles: Array<{ x: number; y: number; vy: number; life: number; max: number; radius: number }> = [];

    const resize = () => {
      const rect = text.getBoundingClientRect();
      width = Math.max(24, rect.width + padX * 2);
      height = Math.max(20, rect.height + padY * 2);
      canvas.style.left = `${-padX}px`;
      canvas.style.top = `${-padY}px`;
      canvas.style.width = `${width}px`;
      canvas.style.height = `${height}px`;
      canvas.width = Math.ceil(width * dpr);
      canvas.height = Math.ceil(height * dpr);
      context.setTransform(dpr, 0, 0, dpr, 0, 0);
    };
    resize();
    const resizeObserver = new ResizeObserver(resize);
    resizeObserver.observe(text);
    const intersection = new IntersectionObserver(([entry]) => { visible = entry?.isIntersecting ?? true; });
    intersection.observe(root);

    const progress = (now: number) => {
      const elapsed = now - started;
      if (mode === "demo") {
        const period = id === "ember-cipher" ? 5200 : id === "eclipse-herald" ? 6000 : 5600;
        return (elapsed % period) / period;
      }
      if (id === "void-whisper") return elapsed < 1050 ? Math.min(.18, elapsed / 1050 * .18) : .42;
      if (id === "ember-cipher") return elapsed < 1300 ? .05 + Math.min(.35, elapsed / 1300 * .35) : .56;
      return elapsed < 1200 ? .18 + Math.min(.16, elapsed / 1200 * .16) : .52;
    };

    const radialEllipse = (cx: number, cy: number, rx: number, ry: number, color: string, alpha: number) => {
      context.save(); context.translate(cx, cy); context.scale(rx, ry);
      const gradient = context.createRadialGradient(0, 0, 0, 0, 0, 1);
      gradient.addColorStop(0, `rgba(${color},${alpha})`);
      gradient.addColorStop(.5, `rgba(${color},${alpha * .5})`);
      gradient.addColorStop(1, `rgba(${color},0)`);
      context.fillStyle = gradient; context.beginPath(); context.arc(0, 0, 1, 0, Math.PI * 2); context.fill(); context.restore();
    };

    const frame = (now: number) => {
      if (disposed) return;
      raf = requestAnimationFrame(frame);
      if (!visible || document.hidden) { last = now; return; }
      const dt = Math.min(60, now - last); last = now;
      const p = progress(now);
      const textWidth = Math.max(1, width - padX * 2);
      const centerY = height / 2;
      context.clearRect(0, 0, width, height);
      context.globalCompositeOperation = "lighter";

      if (id === "void-whisper") {
        const hx = padX - 4;
        const maxRadius = Math.min(8, height * .3);
        let opacity = 0, blur = 0, scaleX = 1, translateX = 0, hole = 0, flash = 0, shockOut = 0, shockIn = 0;
        if (p < .10) { hole = maxRadius * (.4 + .6 * smooth(p / .10)); opacity = 0; }
        else if (p < .18) {
          const k = smooth((p - .10) / .08); flash = 1 - k; shockOut = k; hole = maxRadius * (1 - k * .7);
          opacity = k; blur = (1 - k) * 5; scaleX = .25 + .75 * k; translateX = -(1 - k) * textWidth * .55;
        } else if (p < .66) opacity = 1;
        else if (p < .80) {
          const k = smooth((p - .66) / .14); opacity = 1 - k; blur = k * 5; scaleX = 1 - .75 * k;
          translateX = -k * textWidth * .55; hole = maxRadius * k; shockIn = k;
        } else if (p < .90) hole = maxRadius * (1 - smooth((p - .80) / .10));
        if (shockOut > 0) {
          const radius = shockOut * textWidth * .55 + 4; context.strokeStyle = `rgba(190,140,255,${(1 - shockOut) * .9})`;
          context.lineWidth = (1 - shockOut) * 2.4 + .4; context.beginPath(); context.arc(hx + 6, centerY, radius, 0, Math.PI * 2); context.stroke();
        }
        if (shockIn > 0) {
          const radius = (1 - shockIn) * textWidth * .5 + 4; context.strokeStyle = `rgba(170,110,255,${shockIn * .75})`;
          context.lineWidth = shockIn * 2 + .4; context.beginPath(); context.arc(hx + 6, centerY, radius, 0, Math.PI * 2); context.stroke();
        }
        if (hole > .6) {
          const gradient = context.createRadialGradient(hx, centerY, hole * .5, hx, centerY, hole * 2.4);
          gradient.addColorStop(0, "rgba(160,80,255,0)"); gradient.addColorStop(.6, "rgba(160,80,255,.55)"); gradient.addColorStop(1, "rgba(160,80,255,0)");
          context.fillStyle = gradient; context.beginPath(); context.arc(hx, centerY, hole * 2.4, 0, Math.PI * 2); context.fill();
          context.save(); context.translate(hx, centerY); context.rotate(now / 700); context.strokeStyle = "rgba(210,160,255,.85)";
          context.lineWidth = 1.4; context.beginPath(); context.ellipse(0, 0, hole * 1.55, hole * .5, 0, 0, Math.PI * 2); context.stroke(); context.restore();
          context.globalCompositeOperation = "source-over"; context.fillStyle = "#05030a"; context.beginPath(); context.arc(hx, centerY, hole * .9, 0, Math.PI * 2); context.fill(); context.globalCompositeOperation = "lighter";
        }
        if (flash > 0) radialEllipse(hx + textWidth * .12, centerY, textWidth * .55, height * .44, "232,205,255", flash);
        text.style.transformOrigin = "left center"; text.style.opacity = String(opacity); text.style.filter = `blur(${blur}px)`; text.style.transform = `translateX(${translateX}px) scaleX(${scaleX})`;
      } else if (id === "ember-cipher") {
        let edge: number | undefined;
        let burning = false;
        if (p < .05) text.style.opacity = "0";
        else if (p < .40) {
          edge = smooth((p - .05) / .35); burning = true; text.style.opacity = "1";
          const mask = `linear-gradient(90deg,#000 ${edge * 105}%,transparent ${edge * 105 + 5}%)`; text.style.webkitMaskImage = mask; text.style.maskImage = mask;
        } else if (p < .70) { text.style.opacity = "1"; text.style.webkitMaskImage = "none"; text.style.maskImage = "none"; }
        else if (p < .94) {
          edge = smooth((p - .70) / .24); burning = true; text.style.opacity = "1";
          const mask = `linear-gradient(90deg,transparent ${edge * 105}%,#000 ${edge * 105 + 5}%)`; text.style.webkitMaskImage = mask; text.style.maskImage = mask;
        } else text.style.opacity = "0";
        text.style.filter = "none"; text.style.transform = "none";
        if (burning && edge !== undefined && particles.length < 28) for (let index = 0; index < 2; index += 1) particles.push({ x: padX + edge * textWidth + (Math.random() - .5) * 5, y: centerY + (Math.random() - .5) * height * .42, vy: -(.018 + Math.random() * .028), life: 0, max: 300 + Math.random() * 260, radius: .7 + Math.random() });
        for (let index = particles.length - 1; index >= 0; index -= 1) {
          const particle = particles[index]; particle.life += dt;
          if (particle.life >= particle.max) { particles.splice(index, 1); continue; }
          particle.y += particle.vy * dt; const age = particle.life / particle.max; const alpha = 1 - age; const color = age < .4 ? "255,226,140" : "255,105,28";
          radialEllipse(particle.x, particle.y, particle.radius * 2.8, particle.radius * 2.8, color, alpha);
        }
      } else {
        let opacity = 0, light = 1;
        if (p < .18) { light = 1; opacity = 0; }
        else if (p < .34) { const k = smooth((p - .18) / .16); light = 1 - k; opacity = k; }
        else if (p < .72) { light = 0; opacity = 1; }
        else if (p < .88) { const k = smooth((p - .72) / .16); light = k; opacity = 1 - k; }
        text.style.opacity = String(opacity); text.style.filter = `blur(${(1 - opacity) * 2.6}px)`; text.style.transform = "none";
        if (light > .01) {
          const centerX = padX + textWidth / 2;
          radialEllipse(centerX, centerY, textWidth * .74, height * .5, "255,224,156", .26 * light);
          radialEllipse(centerX, centerY, textWidth * .66, 5, "255,240,200", .36 * light);
          radialEllipse(centerX, centerY, textWidth * .60, 1.7, "255,251,240", .55 * light);
        }
      }
    };
    raf = requestAnimationFrame(frame);
    return () => {
      disposed = true; cancelAnimationFrame(raf); resizeObserver.disconnect(); intersection.disconnect();
      text.removeAttribute("style"); context.clearRect(0, 0, width, height);
    };
  }, [id, mode, reducedMotion, rich]);

  return <span ref={rootRef} className={`name-signal name-signal-${id} ${className}`.trim()}>
    {id === "sovereign-flare" && <SovereignNameCrown />}
    {rich && <canvas ref={canvasRef} aria-hidden="true" />}
    <span ref={textRef} className="name-signal-text">{children}</span>
  </span>;
}
