// Active buffs for the nav buff bar (shown only while something is active).
// Today: the shield (lib/shield.ts rule). Later: march speed, attack/defence buffs.
import { loadLocalWorldSession } from "./world-adapter";

export const BUFFS_CHANGED_EVENT = "alliance:buffs-changed";
/** Anything over a year counts as "until turned off" (the GM permanent shield). */
const PERMANENT_AFTER_MS = 365 * 86_400_000;

const shieldKey = (address: string) => `ruglands:own-shield:${address.toLowerCase()}`;

/** Remember the shield-item expiry the server reports for your own city (any page). */
export function rememberOwnShield(address: string, shieldUntil: number | undefined): void {
  const value = Math.max(0, Number(shieldUntil) || 0);
  try {
    if (Number(localStorage.getItem(shieldKey(address)) || 0) === value) return;
    localStorage.setItem(shieldKey(address), String(value));
  } catch { return; }
  if (typeof window !== "undefined") window.dispatchEvent(new Event(BUFFS_CHANGED_EVENT));
}

export function ownShieldUntil(address: string): number {
  try { return Math.max(0, Number(localStorage.getItem(shieldKey(address)) || 0)); } catch { return 0; }
}

export type ActiveBuff = { id: "shield"; label: string; endsAt: number | null; permanent: boolean; note?: string };

export function activeBuffs(address: string, coreLevel: number, now: number, numbers: any): ActiveBuff[] {
  const session = loadLocalWorldSession(address);
  const cityId = session?.world.players[session.playerId]?.cityId;
  const city = cityId ? session?.world.entities[cityId] : null;
  const home = city?.kind === "city" ? city : null;
  if (home?.hasAttacked) return [];
  const until = Math.max(ownShieldUntil(address), home?.shieldUntil ?? 0);
  if (until > now) return [{ id: "shield", label: "SHIELD", endsAt: until, permanent: until - now > PERMANENT_AFTER_MS }];
  const protectedUntil = Number(numbers?.global?.shield?.protectedUntilKeepLevel) || 0;
  if (coreLevel < protectedUntil) return [{ id: "shield", label: "SHIELD", endsAt: null, permanent: false, note: `UNTIL CORE ${protectedUntil}` }];
  return [];
}

/** 7:42:10 under a day, then 2d 4h; the GM permanent shield reads as ∞. */
export function buffTimeLeft(buff: ActiveBuff, now: number): string {
  if (buff.permanent) return "∞";
  if (buff.endsAt == null) return buff.note || "";
  const sec = Math.max(0, Math.ceil((buff.endsAt - now) / 1000));
  if (sec >= 86_400) return `${Math.floor(sec / 86_400)}d ${Math.floor((sec % 86_400) / 3600)}h`;
  const h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60), s = sec % 60;
  return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}
