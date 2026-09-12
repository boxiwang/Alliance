import { useEffect, useRef, useState } from "react";
import {
  COSMETIC_VAULT_CHANGED_EVENT,
  loadCosmeticVault,
  type GameCursorId,
} from "./lib/player-account";

const CURSOR_HOTSPOTS: Record<GameCursorId, { x: number; y: number }> = {
  reticle: { x: 14, y: 14 },
  comet: { x: 5, y: 5 },
  sigil: { x: 15, y: 15 },
};

export function CursorGlyph({ cursor, className = "" }: { cursor: GameCursorId; className?: string }) {
  if (cursor === "reticle") return <svg className={className} width="28" height="28" viewBox="0 0 28 28" aria-hidden="true">
    <circle cx="14" cy="14" r="9" fill="none" stroke="currentColor" strokeWidth="1.6" />
    <circle cx="14" cy="14" r="1.8" fill="currentColor" />
    <path d="M14 1v6M14 21v6M1 14h6M21 14h6" stroke="currentColor" strokeWidth="1.6" />
  </svg>;
  if (cursor === "comet") return <svg className={className} width="32" height="32" viewBox="0 0 32 32" aria-hidden="true">
    <path d="M5 5 26 14 15 16 13 27Z" fill="currentColor" stroke="#d6f6ff" strokeWidth="1" />
    <circle cx="5" cy="5" r="2.6" fill="#fff" />
  </svg>;
  return <svg className={className} width="30" height="30" viewBox="0 0 30 30" aria-hidden="true">
    <g transform="rotate(45 15 15)"><rect x="8" y="8" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.7" /><rect x="12.5" y="12.5" width="5" height="5" fill="currentColor" /></g>
  </svg>;
}

export default function GameCursor({ address, active }: { address: string; active: boolean }) {
  const [cursor, setCursor] = useState<GameCursorId | null>(() => address ? loadCosmeticVault(address).equipped.cursor : null);
  const [finePointer, setFinePointer] = useState(false);
  const follower = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const media = window.matchMedia("(hover: hover) and (pointer: fine)");
    const sync = () => setFinePointer(media.matches);
    sync();
    media.addEventListener?.("change", sync);
    return () => media.removeEventListener?.("change", sync);
  }, []);

  useEffect(() => {
    const sync = () => setCursor(address ? loadCosmeticVault(address).equipped.cursor : null);
    sync();
    window.addEventListener(COSMETIC_VAULT_CHANGED_EVENT, sync);
    window.addEventListener("storage", sync);
    return () => {
      window.removeEventListener(COSMETIC_VAULT_CHANGED_EVENT, sync);
      window.removeEventListener("storage", sync);
    };
  }, [address]);

  useEffect(() => {
    const enabled = active && finePointer && !!cursor;
    document.documentElement.classList.toggle("game-cursor-active", enabled);
    if (!enabled || !cursor) return () => document.documentElement.classList.remove("game-cursor-active");
    const hotspot = CURSOR_HOTSPOTS[cursor];
    const move = (event: PointerEvent) => {
      const node = follower.current;
      if (!node) return;
      node.style.opacity = "1";
      node.style.transform = `translate3d(${event.clientX - hotspot.x}px,${event.clientY - hotspot.y}px,0)`;
    };
    const leave = () => { if (follower.current) follower.current.style.opacity = "0"; };
    window.addEventListener("pointermove", move, { passive: true });
    document.documentElement.addEventListener("mouseleave", leave);
    return () => {
      document.documentElement.classList.remove("game-cursor-active");
      window.removeEventListener("pointermove", move);
      document.documentElement.removeEventListener("mouseleave", leave);
    };
  }, [active, cursor, finePointer]);

  if (!active || !finePointer || !cursor) return null;
  return <div ref={follower} className={`game-cursor game-cursor-${cursor}`} aria-hidden="true"><CursorGlyph cursor={cursor} /></div>;
}
