import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const output = new URL("../public/assets/items/speedups-v2/", import.meta.url);
mkdirSync(output, { recursive: true });

const durations = [
  { id: "1m", label: "1m", accent: "#718697", secondary: "#718697", glow: 0.08, ticks: 1 },
  { id: "5m", label: "5m", accent: "#38d9ff", secondary: "#38d9ff", glow: 0.14, ticks: 2 },
  { id: "1h", label: "1h", accent: "#68a6ff", secondary: "#68a6ff", glow: 0.18, ticks: 3 },
  { id: "3h", label: "3h", accent: "#aa82ff", secondary: "#aa82ff", glow: 0.22, ticks: 4 },
  { id: "8h", label: "8h", accent: "#e8b24c", secondary: "#e8b24c", glow: 0.25, ticks: 5 },
  { id: "24h", label: "24h", accent: "#f5f7ff", secondary: "#ff4fd8", glow: 0.32, ticks: 6 },
];

const categories = {
  universal: { label: "UNIVERSAL", color: "#8edfff", glyph: "" },
  construction: {
    label: "CONSTRUCTION", color: "#ffb454",
    glyph: '<path d="M74 55h20v8H74zM78 47h12v8H78zM80 63v22M88 63v22M72 85h24"/>',
  },
  training: {
    label: "TRAINING", color: "#ff7188",
    glyph: '<path d="M70 57v10M75 53v18M91 53v18M96 57v10M75 62h16"/>',
  },
  research: {
    label: "RESEARCH", color: "#aa82ff",
    glyph: '<path d="M69 51c5-2 10 0 14 4 4-4 9-6 14-4v21c-5-2-10 0-14 4-4-4-9-6-14-4zM83 55v21"/>',
  },
  healing: {
    label: "HEALING", color: "#43f2a1",
    glyph: '<path d="M69 63h8l4-9 5 17 4-8h8"/>',
  },
};

function tickMarks(active, accent, secondary) {
  return Array.from({ length: 6 }, (_, index) => {
    const x = 75 + index * 18;
    const on = index < active;
    const color = on && index === 5 ? secondary : on ? accent : "#223449";
    return `<rect x="${x}" y="208" width="11" height="3" rx="1.5" fill="${color}" opacity="${on ? 0.95 : 0.62}"/>`;
  }).join("");
}

function iconSvg(categoryKey, category, duration) {
  const special = categoryKey !== "universal";
  const labelSize = duration.id === "24h" ? 52 : 64;
  const uid = `${categoryKey}-${duration.id}`;
  const badge = special ? `
    <circle cx="200" cy="54" r="24" fill="${category.color}" opacity=".055" filter="url(#softGlow-${uid})"/>
    <g transform="translate(117 -8)" fill="none" stroke="${category.color}" stroke-width="4" stroke-linecap="round" stroke-linejoin="round" filter="url(#softGlow-${uid})">${category.glyph}</g>` : "";
  return `<svg xmlns="http://www.w3.org/2000/svg" width="256" height="256" viewBox="0 0 256 256" role="img" aria-label="${duration.label} ${category.label.toLowerCase()} speedup">
  <defs>
    <radialGradient id="field-${uid}" cx="50%" cy="46%" r="65%">
      <stop offset="0" stop-color="${duration.accent}" stop-opacity="${duration.glow}"/>
      <stop offset=".5" stop-color="#0b1a2e" stop-opacity=".96"/>
      <stop offset="1" stop-color="#040914"/>
    </radialGradient>
    <linearGradient id="edge-${uid}" x1="0" y1="0" x2="1" y2="1">
      <stop stop-color="${duration.accent}" stop-opacity=".92"/>
      <stop offset=".48" stop-color="#29435d" stop-opacity=".48"/>
      <stop offset="1" stop-color="${duration.secondary}" stop-opacity=".78"/>
    </linearGradient>
    <filter id="softGlow-${uid}" x="-40%" y="-40%" width="180%" height="180%">
      <feGaussianBlur stdDeviation="4" result="blur"/>
      <feMerge><feMergeNode in="blur"/><feMergeNode in="SourceGraphic"/></feMerge>
    </filter>
  </defs>
  <path d="M46 14h148l48 48v143l-37 37H51l-37-37V51z" fill="url(#field-${uid})" stroke="#1c3046" stroke-width="2"/>
  <path d="M49 25h137l43 43v130l-31 31H58l-31-31V58z" fill="none" stroke="#b8dcf0" stroke-opacity=".08"/>
  <path d="M27 82V57l30-30h50M149 27h35l45 45v33M229 155v42l-31 31h-48M107 228H58l-31-31v-24" fill="none" stroke="url(#edge-${uid})" stroke-width="3"/>
  <path d="M36 46h30M46 36v30M220 190v19l-11 11h-19" fill="none" stroke="${duration.accent}" stroke-width="2" stroke-opacity=".58"/>
  <circle cx="112" cy="131" r="62" fill="none" stroke="${duration.accent}" stroke-opacity=".09"/>
  <circle cx="112" cy="131" r="49" fill="none" stroke="${duration.accent}" stroke-width="2" stroke-dasharray="2 9" stroke-opacity=".22"/>
  <path d="M112 70v13M112 179v13M52 131h13" stroke="${duration.accent}" stroke-width="2" stroke-opacity=".38"/>
  <text x="105" y="151" text-anchor="middle" fill="#e8f8ff" font-family="Chakra Petch, IBM Plex Mono, ui-monospace, monospace" font-size="${labelSize}" font-weight="600" letter-spacing="-3">${duration.label}</text>
  <g fill="none" stroke="${duration.id === "24h" ? duration.secondary : duration.accent}" stroke-width="8" stroke-linecap="square" stroke-linejoin="miter" opacity=".88" filter="url(#softGlow-${uid})">
    <path d="m153 107 22 24-22 24"/><path d="m176 107 22 24-22 24"/>
  </g>
  ${tickMarks(duration.ticks, duration.accent, duration.secondary)}
  ${badge}
  ${duration.id === "24h" ? `<path d="M27 82V57l30-30h50" fill="none" stroke="${duration.secondary}" stroke-width="3"/><circle cx="42" cy="200" r="6" fill="#050a13" stroke="${duration.secondary}"/><path d="M42 188v5M42 207v5M30 200h5M49 200h5" stroke="${duration.secondary}" stroke-width="2" filter="url(#softGlow-${uid})"/>` : ""}
</svg>`;
}

for (const [categoryKey, category] of Object.entries(categories)) {
  for (const duration of durations) {
    writeFileSync(join(output.pathname, `${categoryKey}-${duration.id}.svg`), iconSvg(categoryKey, category, duration).replace(/[ \t]+$/gm, ""));
  }
}

const cells = [];
const columnWidth = 214;
const rowHeight = 170;
const left = 210;
const top = 94;
Object.keys(categories).forEach((categoryKey, column) => {
  durations.forEach((duration, row) => {
    const x = left + column * columnWidth;
    const y = top + row * rowHeight;
    const full = iconSvg(categoryKey, categories[categoryKey], duration);
    const inner = full.slice(full.indexOf(">") + 1, full.lastIndexOf("</svg>"));
    cells.push(`<svg x="${x}" y="${y}" width="144" height="144" viewBox="0 0 256 256">${inner}</svg>`);
  });
});

const categoryLabels = Object.entries(categories).map(([key, value], column) => {
  const x = left + column * columnWidth + 72;
  return `<text x="${x}" y="68" text-anchor="middle" fill="${value.color}" font-size="14" font-family="ui-monospace, monospace" font-weight="600" letter-spacing="1.5">${value.label}</text>`;
}).join("");

const durationLabels = durations.map((duration, row) => {
  const y = top + row * rowHeight + 78;
  return `<text x="118" y="${y}" text-anchor="middle" fill="${duration.accent}" font-size="20" font-family="ui-monospace, monospace" font-weight="600">${duration.label}</text>`;
}).join("");

writeFileSync(join(output.pathname, "speedup-icon-system-v2.svg"), `<svg xmlns="http://www.w3.org/2000/svg" width="1320" height="1135" viewBox="0 0 1320 1135">
  <rect width="1320" height="1135" fill="#040813"/>
  <text x="54" y="44" fill="#dbe2f3" font-size="18" font-family="ui-monospace, monospace" font-weight="600" letter-spacing="2">SPEEDUP ICON SYSTEM</text>
  <text x="1265" y="44" text-anchor="end" fill="#536d80" font-size="11" font-family="ui-monospace, monospace" letter-spacing="1.4">TIME FIRST · TYPE SECOND</text>
  ${categoryLabels}
  ${durationLabels}
  ${cells.join("\n")}
</svg>`.replace(/[ \t]+$/gm, ""));
