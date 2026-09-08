import type { BKey } from "./lib/game";

export default function BuildingGlyph({ building }: { building: BKey }) {
  const mark = (() => {
    switch (building) {
      case "keep": return <><path d="M4 19V8l8-4 8 4v11"/><path d="M8 19v-6h8v6M9 9h.01M15 9h.01"/></>;
      case "bank": return <><path d="M3 9h18L12 4 3 9ZM5 10v7M9 10v7M15 10v7M19 10v7M3 20h18"/></>;
      case "oilwell": return <path d="M12 3C9 7 6 10 6 14a6 6 0 0 0 12 0c0-4-3-7-6-11Z"/>;
      case "powerplant": return <path d="m13 2-8 12h7l-1 8 8-12h-7l1-8Z"/>;
      case "storage": return <><path d="m4 8 8-4 8 4-8 4-8-4Z"/><path d="m4 8v8l8 4 8-4V8M12 12v8"/></>;
      case "wall": return <><path d="M4 5h5v4h6V5h5v15H4V5Z"/><path d="M9 14h6v6"/></>;
      case "armyCamp": return <><path d="M5 17 12 4l7 13H5Z"/><path d="M8 17v3M16 17v3M9 12h6"/></>;
      case "navalBase": return <><path d="M12 3v13M8 7h8M5 12h14"/><path d="M4 17c2 0 2 2 4 2s2-2 4-2 2 2 4 2 2-2 4-2"/></>;
      case "airfield": return <><path d="m3 13 8-2V4l2-1 2 8 6 2v2l-6 1-1 5h-4l-1-5-6-1v-2Z"/></>;
      case "hospital": return <path d="M9 3h6v6h6v6h-6v6H9v-6H3V9h6V3Z"/>;
      case "academy": return <><circle cx="12" cy="12" r="2"/><ellipse cx="12" cy="12" rx="9" ry="4"/><ellipse cx="12" cy="12" rx="4" ry="9" transform="rotate(40 12 12)"/></>;
      case "watchtower": return <><path d="M8 21h8l-2-12h-4L8 21ZM7 9h10"/><path d="M5 6c2-2 4-3 7-3s5 1 7 3"/></>;
      case "embassy": return <><circle cx="6" cy="7" r="2"/><circle cx="18" cy="7" r="2"/><circle cx="12" cy="17" r="2"/><path d="m8 8 3 7M16 8l-3 7M8 7h8"/></>;
      case "milestone": return <><path d="m12 3 2.3 4.7 5.2.8-3.8 3.7.9 5.2-4.6-2.5-4.6 2.5.9-5.2-3.8-3.7 5.2-.8L12 3Z"/></>;
      default: return <circle cx="12" cy="12" r="8"/>;
    }
  })();
  return <svg className="building-glyph" viewBox="0 0 24 24" aria-hidden="true">{mark}</svg>;
}
