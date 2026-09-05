// Format a raw integer string (wei-style) with `decimals` into a human number.
export function fromRaw(raw: string | number, decimals: number): number {
  try {
    const neg = String(raw).startsWith("-");
    const s = String(raw).replace("-", "");
    const d = Math.max(0, decimals | 0);
    const padded = s.padStart(d + 1, "0");
    const intPart = padded.slice(0, padded.length - d) || "0";
    const fracPart = d ? padded.slice(padded.length - d) : "";
    const val = Number(intPart + (fracPart ? "." + fracPart : ""));
    return neg ? -val : val;
  } catch {
    return 0;
  }
}

export function compact(n: number): string {
  if (!isFinite(n)) return "0";
  const abs = Math.abs(n);
  if (abs >= 1e9) return (n / 1e9).toFixed(2) + "B";
  if (abs >= 1e6) return (n / 1e6).toFixed(2) + "M";
  if (abs >= 1e3) return (n / 1e3).toFixed(2) + "K";
  if (abs >= 1) return n.toFixed(2);
  if (abs === 0) return "0";
  return n.toPrecision(3);
}

export function usd(n: number): string {
  if (!isFinite(n) || n === 0) return "$0";
  return "$" + compact(n);
}

export function shortAddr(a: string): string {
  if (!a) return "";
  return a.slice(0, 6) + "…" + a.slice(-4);
}

export function ago(iso: string): string {
  if (!iso) return "—";
  const then = new Date(iso).getTime();
  if (isNaN(then)) return "—";
  const days = Math.floor((Date.now() - then) / 86400000);
  if (days <= 0) return "today";
  if (days === 1) return "1 day ago";
  if (days < 30) return days + " days ago";
  if (days < 365) return Math.floor(days / 30) + " mo ago";
  return (days / 365).toFixed(1) + " yr ago";
}
