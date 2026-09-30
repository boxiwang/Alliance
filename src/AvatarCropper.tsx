import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { encodeAvatar } from "./lib/avatar-image";

const FRAME = 280;
const MAX_ZOOM = 4;

/**
 * Crop & zoom a portrait before upload: drag to position, wheel / slider / pinch to zoom.
 * The frame is the same rounded square the commander card shows; the image always covers it.
 */
export default function AvatarCropper({ image, busy, onCancel, onConfirm }: {
  image: HTMLImageElement;
  busy: boolean;
  onCancel: () => void;
  onConfirm: (blob: Blob) => void;
}) {
  const cover = Math.max(FRAME / image.naturalWidth, FRAME / image.naturalHeight);
  const [zoom, setZoom] = useState(1);
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const pinch = useRef<{ distance: number; zoom: number } | null>(null);
  const scale = cover * zoom;
  const width = image.naturalWidth * scale, height = image.naturalHeight * scale;

  // Keep the image covering the frame whatever the zoom.
  const clamp = (next: { x: number; y: number }, z = zoom) => {
    const w = image.naturalWidth * cover * z, h = image.naturalHeight * cover * z;
    const maxX = (w - FRAME) / 2, maxY = (h - FRAME) / 2;
    return { x: Math.max(-maxX, Math.min(maxX, next.x)), y: Math.max(-maxY, Math.min(maxY, next.y)) };
  };
  const setZoomClamped = (z: number) => { const next = Math.max(1, Math.min(MAX_ZOOM, z)); setZoom(next); setOffset((current) => clamp(current, next)); };

  useEffect(() => {
    const close = (event: KeyboardEvent) => { if (event.key === "Escape") onCancel(); };
    window.addEventListener("keydown", close);
    return () => window.removeEventListener("keydown", close);
  }, [onCancel]);

  function down(event: ReactPointerEvent<HTMLDivElement>) {
    event.currentTarget.setPointerCapture(event.pointerId);
    pointers.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
    if (pointers.current.size === 2) {
      const [a, b] = [...pointers.current.values()];
      pinch.current = { distance: Math.hypot(a.x - b.x, a.y - b.y), zoom };
    }
  }
  function move(event: ReactPointerEvent<HTMLDivElement>) {
    const last = pointers.current.get(event.pointerId);
    if (!last) return;
    pointers.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
    if (pointers.current.size === 2 && pinch.current) {
      const [a, b] = [...pointers.current.values()];
      setZoomClamped(pinch.current.zoom * Math.hypot(a.x - b.x, a.y - b.y) / pinch.current.distance);
      return;
    }
    setOffset((current) => clamp({ x: current.x + event.clientX - last.x, y: current.y + event.clientY - last.y }));
  }
  function up(event: ReactPointerEvent<HTMLDivElement>) {
    pointers.current.delete(event.pointerId);
    if (pointers.current.size < 2) pinch.current = null;
  }

  async function confirm() {
    // Frame → source pixels: the frame's top-left sits at (width - FRAME) / 2 - offset in the scaled image.
    const side = FRAME / scale;
    const sx = ((width - FRAME) / 2 - offset.x) / scale, sy = ((height - FRAME) / 2 - offset.y) / scale;
    onConfirm(await encodeAvatar(image, sx, sy, side));
  }

  return <div className="avatar-cropper-backdrop" role="dialog" aria-modal="true" aria-label="Crop your portrait">
    <div className="avatar-cropper">
      <header><b>ADJUST PORTRAIT</b><span>Drag to position · scroll or pinch to zoom</span></header>
      <div className="avatar-cropper-frame" style={{ width: FRAME, height: FRAME }}
        onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={up}
        onWheel={(event) => setZoomClamped(zoom * Math.exp(-event.deltaY * .0015))}>
        <img src={image.src} alt="" draggable={false} style={{ width, height, transform: `translate(${(FRAME - width) / 2 + offset.x}px, ${(FRAME - height) / 2 + offset.y}px)` }} />
      </div>
      <label className="avatar-cropper-zoom"><span>−</span><input type="range" aria-label="Zoom" min={1} max={MAX_ZOOM} step={.01} value={zoom} onChange={(event) => setZoomClamped(Number(event.target.value))} /><span>+</span></label>
      <div className="avatar-cropper-actions">
        <button type="button" className="profile-action" onClick={onCancel} disabled={busy}>CANCEL</button>
        <button type="button" className="profile-action primary" onClick={() => void confirm()} disabled={busy}>{busy ? "UPLOADING…" : "USE THIS PORTRAIT"}</button>
      </div>
    </div>
  </div>;
}
