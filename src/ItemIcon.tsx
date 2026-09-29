import { speedupIconPath, type MvpItem } from "./lib/mvp-items";

// Item art for the Warehouse. Speedups use their shipped SVG set; every other item is
// drawn here in the same card language (octagonal plate, corner ticks, glowing glyph)
// with an accent per item family, so the whole backpack reads as one set.

const ACCENT: Record<string, string> = {
  "resource.cash": "#43f2a1", "resource.oil": "#ffb454", "resource.power": "#38d9ff",
  energy: "#aa82ff", "war.shield": "#6aaeff", "war.relocator.random": "#38d9ff", "war.relocator.advanced": "#ffd27a",
  identity: "#9fc4d8", relic: "#d99bff",
};

function accentFor(id: string): string {
  const key = Object.keys(ACCENT).find((prefix) => id.startsWith(prefix));
  return key ? ACCENT[key] : "#8fb0c4";
}

function glyph(id: string, color: string) {
  const stroke = { fill: "none", stroke: color, strokeWidth: 7, strokeLinecap: "round" as const, strokeLinejoin: "round" as const };
  if (id.startsWith("resource.")) {
    const mark = id.includes("cash") ? <path d="M112 118h32M112 134h32M128 108v36" {...stroke} strokeWidth={6} />
      : id.includes("oil") ? <path d="M128 104c-9 13-16 21-16 30a16 16 0 0 0 32 0c0-9-7-17-16-30Z" {...stroke} strokeWidth={6} />
        : <path d="m134 102-16 26h13l-4 24 17-28h-13l3-22Z" {...stroke} strokeWidth={6} />;
    return <>
      <path d="M78 104 128 80l50 24v58l-50 24-50-24Z" {...stroke} />
      <path d="M78 104l50 24 50-24M128 128v58" {...stroke} strokeOpacity={.55} />
      <g transform="translate(0 -22)">{mark}</g>
    </>;
  }
  if (id.startsWith("energy.")) return <>
    <rect x="80" y="96" width="92" height="64" rx="10" {...stroke} />
    <path d="M172 116h10v24h-10" {...stroke} />
    <path d="M94 128h14l8-14 12 28 9-14h15" {...stroke} strokeWidth={6} />
  </>;
  if (id.startsWith("war.shield")) return <>
    <path d="M128 78 176 96v34c0 30-20 48-48 60-28-12-48-30-48-60V96Z" {...stroke} />
    <path d="M128 98v72M104 118h48M104 144h48" {...stroke} strokeWidth={4} strokeOpacity={.55} />
  </>;
  if (id.startsWith("war.relocator")) {
    const precise = id.endsWith("advanced");
    return <>
      <circle cx="128" cy="128" r="46" {...stroke} strokeOpacity={.5} strokeDasharray="6 10" />
      <path d="M128 92a36 36 0 1 1-34 24" {...stroke} />
      <path d="m88 104 6 14 14-6" {...stroke} />
      {precise ? <path d="M128 112v32M112 128h32" {...stroke} strokeWidth={6} /> : <circle cx="128" cy="128" r="7" fill={color} />}
    </>;
  }
  if (id.startsWith("identity.")) return <>
    <path d="M86 164c18-4 24-40 42-40 12 0 6 22 18 22 8 0 12-10 24-10" {...stroke} />
    <path d="m150 84 20 20-44 44-24 4 4-24Z" {...stroke} strokeWidth={6} />
  </>;
  if (id.startsWith("relic.")) return <>
    <circle cx="104" cy="112" r="22" {...stroke} />
    <path d="M120 128 172 180M150 158l12-12M162 170l10-10" {...stroke} />
  </>;
  return <circle cx="128" cy="128" r="30" {...stroke} />;
}

export default function ItemIcon({ item, className }: { item: Pick<MvpItem, "id" | "category" | "speedupQueue">; className?: string }) {
  if (item.category === "speedup") return <img className={className} src={speedupIconPath(item)} alt="" />;
  const color = accentFor(item.id);
  const uid = item.id.replace(/[^a-z0-9]/gi, "-");
  return <svg className={className} viewBox="0 0 256 256" aria-hidden="true">
    <defs>
      <radialGradient id={`item-field-${uid}`} cx="50%" cy="46%" r="65%">
        <stop offset="0" stopColor={color} stopOpacity=".18" /><stop offset=".5" stopColor="#0b1a2e" stopOpacity=".96" /><stop offset="1" stopColor="#040914" />
      </radialGradient>
      <filter id={`item-glow-${uid}`} x="-40%" y="-40%" width="180%" height="180%"><feGaussianBlur stdDeviation="4" result="blur" /><feMerge><feMergeNode in="blur" /><feMergeNode in="SourceGraphic" /></feMerge></filter>
    </defs>
    <path d="M46 14h148l48 48v143l-37 37H51l-37-37V51z" fill={`url(#item-field-${uid})`} stroke="#1c3046" strokeWidth="2" />
    <path d="M27 82V57l30-30h50M149 27h35l45 45v33M229 155v42l-31 31h-48M107 228H58l-31-31v-24" fill="none" stroke={color} strokeOpacity=".7" strokeWidth="3" />
    <path d="M36 46h30M46 36v30M220 190v19l-11 11h-19" fill="none" stroke={color} strokeWidth="2" strokeOpacity=".58" />
    <g filter={`url(#item-glow-${uid})`}>{glyph(item.id, color)}</g>
  </svg>;
}
