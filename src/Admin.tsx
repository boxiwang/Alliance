import { useMemo, useState } from "react";
import { getN, saveN, resetN, hasOverride } from "./lib/numbers";

// ---- generic deep helpers (immutable set-by-path) ----

type Path = (string | number)[];

function deepClone<T>(v: T): T {
  return JSON.parse(JSON.stringify(v));
}

function getAt(obj: any, path: Path): any {
  let cur = obj;
  for (const k of path) {
    if (cur == null) return undefined;
    cur = cur[k as any];
  }
  return cur;
}

function setAt(obj: any, path: Path, value: any): any {
  if (path.length === 0) return value;
  const [head, ...rest] = path;
  const isArr = Array.isArray(obj);
  const next: any = isArr ? [...obj] : { ...obj };
  next[head as any] = setAt(obj ? obj[head as any] : undefined, rest, value);
  return next;
}

const TOP_ORDER = ["meta", "global", "resources", "startingLayout", "buildings", "troops"];

function orderedTopKeys(obj: any): string[] {
  const keys = Object.keys(obj || {});
  const known = TOP_ORDER.filter((k) => keys.includes(k));
  const rest = keys.filter((k) => !TOP_ORDER.includes(k));
  return [...known, ...rest];
}

function labelFor(key: string | number): string {
  return String(key);
}

// ---- leaf editors ----

function NumberRow({
  path,
  label,
  value,
  onChange,
}: {
  path: Path;
  label: string;
  value: number;
  onChange: (path: Path, v: number) => void;
}) {
  return (
    <div className="adm-row">
      <span className="adm-label mono">{label}</span>
      <input
        className="adm-input mono"
        type="number"
        step="any"
        value={Number.isFinite(value) ? value : 0}
        onChange={(e) => {
          const v = e.target.value === "" ? 0 : parseFloat(e.target.value);
          onChange(path, Number.isNaN(v) ? 0 : v);
        }}
      />
    </div>
  );
}

function BoolRow({
  path,
  label,
  value,
  onChange,
}: {
  path: Path;
  label: string;
  value: boolean;
  onChange: (path: Path, v: boolean) => void;
}) {
  return (
    <div className="adm-row">
      <span className="adm-label mono">{label}</span>
      <input
        className="adm-checkbox"
        type="checkbox"
        checked={!!value}
        onChange={(e) => onChange(path, e.target.checked)}
      />
    </div>
  );
}

function StringRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="adm-row adm-row-readonly">
      <span className="adm-label mono">{label}</span>
      <span className="adm-string mono">{value}</span>
    </div>
  );
}

// ---- recursive node renderer ----

function Node({
  path,
  value,
  onChange,
  depth,
}: {
  path: Path;
  value: any;
  onChange: (path: Path, v: any) => void;
  depth: number;
}) {
  if (value === null || value === undefined) {
    return <StringRow label={labelFor(path[path.length - 1])} value={String(value)} />;
  }

  const t = typeof value;
  const lastKey = path[path.length - 1];

  if (t === "number") {
    return <NumberRow path={path} label={labelFor(lastKey)} value={value} onChange={onChange} />;
  }
  if (t === "boolean") {
    return <BoolRow path={path} label={labelFor(lastKey)} value={value} onChange={onChange} />;
  }
  if (t === "string") {
    return <StringRow label={labelFor(lastKey)} value={value} />;
  }

  if (Array.isArray(value)) {
    // array of primitives or objects — render each index
    return (
      <div className="adm-array" style={{ ["--depth" as any]: depth }}>
        {value.map((item, i) => (
          <Node key={i} path={[...path, i]} value={item} onChange={onChange} depth={depth + 1} />
        ))}
      </div>
    );
  }

  if (t === "object") {
    const keys = Object.keys(value);
    return (
      <div className="adm-object" style={{ ["--depth" as any]: depth }}>
        {keys.map((k) => (
          <Node key={k} path={[...path, k]} value={value[k]} onChange={onChange} depth={depth + 1} />
        ))}
      </div>
    );
  }

  return null;
}

// ---- collapsible section (top-level, and named subsections for buildings/troops) ----

function Section({
  title,
  subtitle,
  defaultOpen,
  children,
}: {
  title: string;
  subtitle?: string;
  defaultOpen?: boolean;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen !== false);
  return (
    <div className="adm-section">
      <button className="adm-section-head" onClick={() => setOpen((o) => !o)}>
        <span className="adm-caret">{open ? "▾" : "▸"}</span>
        <span className="adm-section-title">{title}</span>
        {subtitle && <span className="adm-section-sub mono">{subtitle}</span>}
      </button>
      {open && <div className="adm-section-body">{children}</div>}
    </div>
  );
}

// For top-level keys whose value is an object-of-objects (buildings, troops),
// break each child key into its own subsection so ~30-leaf configs are scannable.
function GroupedTopLevel({
  topKey,
  value,
  onChange,
}: {
  topKey: string;
  value: any;
  onChange: (path: Path, v: any) => void;
}) {
  const isGroupOfObjects =
    value &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    Object.values(value).every((v) => v && typeof v === "object" && !Array.isArray(v));

  if (isGroupOfObjects) {
    const childKeys = Object.keys(value);
    return (
      <>
        {childKeys.map((ck) => (
          <Section key={ck} title={ck} defaultOpen={false}>
            <Node path={[topKey, ck]} value={value[ck]} onChange={onChange} depth={0} />
          </Section>
        ))}
      </>
    );
  }

  return <Node path={[topKey]} value={value} onChange={onChange} depth={0} />;
}

function countEditableLeaves(value: any): number {
  if (value === null || value === undefined) return 0;
  const t = typeof value;
  if (t === "number" || t === "boolean") return 1;
  if (t === "string") return 0;
  if (Array.isArray(value)) return value.reduce((s, v) => s + countEditableLeaves(v), 0);
  if (t === "object") {
    let sum = 0;
    for (const v of Object.values(value) as any[]) sum += countEditableLeaves(v);
    return sum;
  }
  return 0;
}

export default function Admin() {
  const [working, setWorking] = useState<any>(() => deepClone(getN()));
  const [overrideActive, setOverrideActive] = useState<boolean>(() => hasOverride());
  const [savedNote, setSavedNote] = useState<string>("");

  const topKeys = useMemo(() => orderedTopKeys(working), [working]);
  const leafCount = useMemo(() => countEditableLeaves(working), [working]);

  function handleChange(path: Path, v: any) {
    setWorking((prev: any) => setAt(prev, path, v));
  }

  function onSaveReload() {
    saveN(working);
    location.reload();
  }

  function onRevert() {
    setWorking(deepClone(getN()));
    setOverrideActive(hasOverride());
    setSavedNote("Reverted to last saved/effective numbers.");
    setTimeout(() => setSavedNote(""), 2000);
  }

  function onResetDefaults() {
    resetN();
    location.reload();
  }

  function onExport() {
    const json = JSON.stringify(working, null, 2);
    const blob = new Blob([json], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "numbers.json";
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  return (
    <div className="admin">
      <div className="adm-toolbar">
        <div className="adm-toolbar-left">
          <span className="adm-title">RUGLANDS — Numbers Admin</span>
          <span className="adm-subtitle mono">internal tuning · edits are local until exported</span>
        </div>
        <div className="adm-toolbar-right">
          <button className="adm-btn adm-btn-primary" onClick={onSaveReload}>
            Save &amp; reload
          </button>
          <button className="adm-btn" onClick={onRevert}>
            Revert edits
          </button>
          <button className="adm-btn adm-btn-danger" onClick={onResetDefaults}>
            Reset to defaults
          </button>
          <button className="adm-btn" onClick={onExport}>
            Export numbers.json
          </button>
        </div>
      </div>

      <div className="adm-status mono">
        <span className={"adm-badge" + (overrideActive ? " on" : "")}>
          {overrideActive ? "override active" : "using bundled defaults"}
        </span>
        <span className="adm-leafcount">{leafCount} editable numbers</span>
        <span className="adm-note">changes apply after Save &amp; reload</span>
        {savedNote && <span className="adm-savednote">{savedNote}</span>}
      </div>

      <div className="adm-body">
        {topKeys.map((tk) => (
          <Section key={tk} title={tk} defaultOpen={tk === "meta" ? false : true}>
            <GroupedTopLevel topKey={tk} value={working[tk]} onChange={handleChange} />
          </Section>
        ))}
      </div>
    </div>
  );
}
