import { useEffect, useState } from "react";
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

// Native CSS cursor: the OS composites it, so it never trails the pointer even
// when a heavy page (Star Map) is busy. The old DOM follower moved on
// pointermove and lagged whenever frames were slow.
const CURSOR_COLOR: Record<GameCursorId, string> = { reticle: "#59dcff", comet: "#59dcff", sigil: "#f3c46b" };
const PAD = 5;

function cursorMarkup(cursor: GameCursorId): { svg: string; size: number } {
  const c = CURSOR_COLOR[cursor];
  const glyph = cursor === "reticle"
    ? `<circle cx="14" cy="14" r="9" fill="none" stroke="${c}" stroke-width="1.6"/><circle cx="14" cy="14" r="1.8" fill="${c}"/><path d="M14 1v6M14 21v6M1 14h6M21 14h6" stroke="${c}" stroke-width="1.6"/>`
    : cursor === "comet"
      ? `<path d="M5 5 26 14 15 16 13 27Z" fill="${c}" stroke="#d6f6ff" stroke-width="1"/><circle cx="5" cy="5" r="2.6" fill="#fff"/>`
      : `<g transform="rotate(45 15 15)"><rect x="8" y="8" width="14" height="14" fill="none" stroke="${c}" stroke-width="1.7"/><rect x="12.5" y="12.5" width="5" height="5" fill="${c}"/></g>`;
  const base = cursor === "reticle" ? 28 : cursor === "comet" ? 32 : 30;
  const size = base + PAD * 2;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}"><defs><filter id="g" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="1.6" result="b"/><feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge></filter></defs><g transform="translate(${PAD} ${PAD})" filter="url(#g)">${glyph}</g></svg>`;
  return { svg, size };
}

export function gameCursorCss(cursor: GameCursorId): string {
  const { svg } = cursorMarkup(cursor);
  const hotspot = CURSOR_HOTSPOTS[cursor];
  return `url("data:image/svg+xml,${encodeURIComponent(svg)}") ${hotspot.x + PAD} ${hotspot.y + PAD}, auto`;
}

export default function GameCursor({ address, active }: { address: string; active: boolean }) {
  const [cursor, setCursor] = useState<GameCursorId | null>(() => address ? loadCosmeticVault(address).equipped.cursor : null);
  const [finePointer, setFinePointer] = useState(false);

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
    const root = document.documentElement;
    const enabled = active && finePointer && !!cursor;
    root.classList.toggle("game-cursor-active", enabled);
    if (enabled && cursor) root.style.setProperty("--game-cursor", gameCursorCss(cursor));
    return () => { root.classList.remove("game-cursor-active"); root.style.removeProperty("--game-cursor"); };
  }, [active, cursor, finePointer]);

  return null;
}
