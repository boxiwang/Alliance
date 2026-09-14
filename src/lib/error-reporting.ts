// Global client error reporting for the alpha. Uncaught errors + unhandled
// promise rejections + React render crashes are batched to the backend via the
// existing telemetry channel (/events), so a friend hitting a bug shows up in the
// dashboard instead of vanishing into a white screen. Best-effort and never
// throws — reporting must not itself break the app.

import { queuePlayerEvent } from "./backend";

let currentAddress = "";
let installed = false;

/** App sets this whenever the signed-in player changes (""/anon before login). */
export function setErrorReportingAddress(address: string): void {
  currentAddress = address || "";
}

export function reportClientError(kind: string, message: string, stack?: string, extra?: Record<string, unknown>): void {
  try {
    if (!currentAddress) return; // no session yet → cannot authenticate telemetry
    queuePlayerEvent(currentAddress, {
      name: "client.error",
      page: (typeof window !== "undefined" && window.location ? window.location.search.replace(/^\?/, "").split("&")[0] : "") || "app",
      properties: {
        kind,
        message: String(message || "").slice(0, 500),
        stack: stack ? String(stack).slice(0, 2000) : undefined,
        userAgent: typeof navigator !== "undefined" ? navigator.userAgent.slice(0, 200) : undefined,
        ...extra,
      },
    });
  } catch {}
}

export function installGlobalErrorReporting(): void {
  if (installed || typeof window === "undefined") return;
  installed = true;
  window.addEventListener("error", (event) => {
    reportClientError("window.onerror", event.message || "error", event.error?.stack, {
      source: event.filename, line: event.lineno, col: event.colno,
    });
  });
  window.addEventListener("unhandledrejection", (event) => {
    const reason = event.reason;
    reportClientError("unhandledrejection", reason?.message || String(reason || "rejection"), reason?.stack);
  });
}
