// Central numbers accessor. The game reads getN() instead of importing the JSON directly,
// so an admin-tuned override (localStorage) takes effect. MVP: override applies on next load
// (admin offers "Save & reload"). Later: a backend serves these to all clients.
import DEFAULTS from "../../docs/numbers.json";

const KEY = "ruglands:numbers";

export function defaultN(): any {
  return DEFAULTS;
}

// Effective numbers = saved override if present, else the bundled defaults.
export function getN(): any {
  try {
    const s = localStorage.getItem(KEY);
    return s ? JSON.parse(s) : DEFAULTS;
  } catch {
    return DEFAULTS;
  }
}

export function saveN(obj: any) {
  try {
    localStorage.setItem(KEY, JSON.stringify(obj));
  } catch {}
}

export function resetN() {
  try {
    localStorage.removeItem(KEY);
  } catch {}
}

export function hasOverride(): boolean {
  try {
    return localStorage.getItem(KEY) != null;
  } catch {
    return false;
  }
}
