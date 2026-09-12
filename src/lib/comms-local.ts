import type { LanguageCode } from "./player-account";
import type { SharedWorldIntel } from "./shared-intel";
import type { HeadlessWorld } from "./world-engine";

export type LocalCommsMessage = {
  id?: string;
  a?: string;
  f?: string;
  v?: boolean;
  t?: string;
  b?: string;
  tag?: string;
  own?: boolean;
  pin?: string;
  spam?: number;
  blocked?: string;
  sys?: "mil" | "eco" | "sec";
  coord?: { c: string; k: string };
  rally?: boolean;
  intel?: SharedWorldIntel;
  sourceLanguage?: LanguageCode | "auto";
  authorLocale?: LanguageCode;
  createdAt?: number;
};

export type LocalCommsStore = Record<string, LocalCommsMessage[]>;

export const LOCAL_COMMS_CHANGED_EVENT = "ruglands:comms-changed";
const sentKey = (address: string) => `ruglands:comms-sent:${address.toLowerCase()}`;

export function loadLocalComms(address: string): LocalCommsStore {
  try {
    const parsed = JSON.parse(localStorage.getItem(sentKey(address)) || "{}");
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    return Object.fromEntries(Object.entries(parsed)
      .filter(([, value]) => Array.isArray(value))) as LocalCommsStore;
  } catch {
    return {};
  }
}

export function saveLocalComms(address: string, messages: LocalCommsStore): void {
  try {
    localStorage.setItem(sentKey(address), JSON.stringify(messages));
    if (typeof window !== "undefined" && typeof window.dispatchEvent === "function") {
      window.dispatchEvent(new CustomEvent(LOCAL_COMMS_CHANGED_EVENT, { detail: { address: address.toLowerCase() } }));
    }
  } catch {}
}

export function appendLocalCommsMessage(address: string, channel: string, message: LocalCommsMessage): LocalCommsStore {
  const current = loadLocalComms(address);
  const next = { ...current, [channel]: [...(current[channel] ?? []), message] };
  saveLocalComms(address, next);
  return next;
}

export function refreshLocalCommsIntel(address: string, world: HeadlessWorld): LocalCommsStore {
  const current = loadLocalComms(address);
  let changed = false;
  const next = Object.fromEntries(Object.entries(current).map(([channel, messages]) => [channel, messages.map((message) => {
    const share = message.intel;
    if (!share || share.kind !== "scout-intel") return message;
    const report = world.reports[share.reportId];
    const snapshot = report?.payload.snapshot;
    if (!snapshot || typeof snapshot !== "object") return message;
    const currentMight = Number(share.snapshot.might);
    const reportMight = Number((snapshot as Record<string, unknown>).might);
    if (currentMight === reportMight) return message;
    changed = true;
    return { ...message, intel: { ...share, snapshot: structuredClone(snapshot) as Record<string, unknown> } };
  })])) as LocalCommsStore;
  if (changed) saveLocalComms(address, next);
  return changed ? next : current;
}
