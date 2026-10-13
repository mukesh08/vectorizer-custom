/* Pre-crop: an image bigger than the chosen detail level has to be scaled down before tracing,
   which throws away the fine lines the tracer needs. Cropping to the part that matters keeps
   those pixels instead. Offered on upload; skipped entirely for images already within the cap. */
import { useCallback, useEffect, useRef, useState } from "react";
import Modal from "../ui/Modal";

export interface CropRect { x: number; y: number; w: number; h: number }

interface Props {
  img: HTMLImageElement;
  name: string;
  /** Trace resolution cap, in megapixels. 0 means "original pixels only": no cap. */
  limitMP: number;
  onCancel: () => void;
  onConfirm: (img: HTMLImageElement, name: string) => void;
}

const STAGE_W = 660, STAGE_H = 520;
const MIN_SIDE = 16;                       // never let the selection collapse to nothing

const mp = (w: number, h: number): number => w * h / 1e6;
const ratio = (w: number, h: number): string => w >= h ? `${+(w / h).toFixed(3)}:1` : `1:${+(h / w).toFixed(3)}`;
const fmtMP = (v: number): string => v < 0.1 ? v.toFixed(3) : v.toFixed(2);

type Grip = "nw" | "ne" | "sw" | "se" | "move";

export default function PreCrop({ img, name, limitMP, onCancel, onConfirm }: Props) {
  const [crop, setCrop] = useState<CropRect>({ x: 0, y: 0, w: img.naturalWidth, h: img.naturalHeight });
  const drag = useRef<{ grip: Grip; x: number; y: number; start: CropRect } | null>(null);

  // the image is shown fitted into the stage; all pointer deltas convert back through this scale
  const scale = Math.min(STAGE_W / img.naturalWidth, STAGE_H / img.naturalHeight, 1);
  const dw = img.naturalWidth * scale, dh = img.naturalHeight * scale;

  const onPointerDown = (grip: Grip) => (e: React.PointerEvent) => {
    e.preventDefault(); e.stopPropagation();
    (e.target as Element).setPointerCapture(e.pointerId);
    drag.current = { grip, x: e.clientX, y: e.clientY, start: { ...crop } };
  };

  const onPointerMove = (e: React.PointerEvent) => {
    const d = drag.current; if (!d) return;
    const dx = (e.clientX - d.x) / scale, dy = (e.clientY - d.y) / scale;
    const W = img.naturalWidth, H = img.naturalHeight, s = d.start;
    let { x, y, w, h } = s;
    if (d.grip === "move") {
      x = Math.min(W - s.w, Math.max(0, s.x + dx));
      y = Math.min(H - s.h, Math.max(0, s.y + dy));
    } else {
      const right = s.x + s.w, bottom = s.y + s.h;
      if (d.grip === "nw" || d.grip === "sw") { x = Math.min(right - MIN_SIDE, Math.max(0, s.x + dx)); w = right - x; }
      else { w = Math.min(W - s.x, Math.max(MIN_SIDE, s.w + dx)); }
      if (d.grip === "nw" || d.grip === "ne") { y = Math.min(bottom - MIN_SIDE, Math.max(0, s.y + dy)); h = bottom - y; }
      else { h = Math.min(H - s.y, Math.max(MIN_SIDE, s.h + dy)); }
    }
    setCrop({ x: Math.round(x), y: Math.round(y), w: Math.round(w), h: Math.round(h) });
  };

  const endDrag = () => { drag.current = null; };

  const confirm = useCallback(() => {
    const full = crop.x === 0 && crop.y === 0 && crop.w === img.naturalWidth && crop.h === img.naturalHeight;
    if (full) { onConfirm(img, name); return; }                 // nothing cropped: keep the original pixels
    const c = document.createElement("canvas");
    c.width = crop.w; c.height = crop.h;
    c.getContext("2d")!.drawImage(img, crop.x, crop.y, crop.w, crop.h, 0, 0, crop.w, crop.h);
    const out = new Image();
    out.onload = () => onConfirm(out, name);
    out.src = c.toDataURL("image/png");
  }, [crop, img, name, onConfirm]);

  // Escape is the Modal shell's job; Enter is this dialog's own shortcut
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Enter") confirm(); };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [confirm]);

  const origMP = mp(img.naturalWidth, img.naturalHeight), cropMP = mp(crop.w, crop.h);
  const over = limitMP > 0 && cropMP > limitMP;

  return (
    <Modal
      title="Crop before tracing"
      titleId="precropTitle"
      onClose={onCancel}
      actions={<>
        <button type="button" className="btn" onClick={onCancel}>Cancel</button>
        <button type="button" className="btn primary" onClick={confirm}>
          {crop.w === img.naturalWidth && crop.h === img.naturalHeight ? "Trace whole image" : "Trace this crop"}
        </button>
      </>}
    >
      <div className="precrop-body">
        <div className="crop-stage" style={{ width: dw, height: dh }}
          onPointerMove={onPointerMove} onPointerUp={endDrag} onPointerCancel={endDrag}>
          <img src={img.src} width={dw} height={dh} alt="" draggable={false} />
          <div className="crop-box" style={{ left: crop.x * scale, top: crop.y * scale, width: crop.w * scale, height: crop.h * scale }}
            onPointerDown={onPointerDown("move")}>
            {(["nw", "ne", "sw", "se"] as const).map(g => (
              <span key={g} className={"grip " + g} onPointerDown={onPointerDown(g)} />
            ))}
          </div>
        </div>

        <aside className="crop-info">
          <p className="hint">
            {limitMP > 0
              ? `This image is larger than the detail level you picked (${limitMP} MP), so it gets scaled down before tracing. Crop to the part you care about and those pixels are kept at full size instead.`
              : "Crop to the part you want to vectorize, or trace the whole image."}
          </p>

          {limitMP > 0 && <dl className="crop-stats"><div><dt>Detail limit</dt><dd>{limitMP} MP</dd></div></dl>}

          <h3>Original image</h3>
          <dl className="crop-stats">
            <div><dt>Size</dt><dd>{img.naturalWidth} × {img.naturalHeight} px</dd></div>
            <div><dt>Aspect ratio</dt><dd>{ratio(img.naturalWidth, img.naturalHeight)}</dd></div>
            <div><dt>Megapixels</dt><dd>{fmtMP(origMP)}</dd></div>
          </dl>

          <h3>Selection</h3>
          <dl className="crop-stats">
            <div><dt>Size</dt><dd>{crop.w} × {crop.h} px</dd></div>
            <div><dt>Aspect ratio</dt><dd>{ratio(crop.w, crop.h)}</dd></div>
            <div><dt>Megapixels</dt><dd className={over ? "over" : ""}>{fmtMP(cropMP)}</dd></div>
          </dl>

          {over && <p className="warn">Still over the limit: the crop will be scaled down to {limitMP} MP when traced.</p>}

          <button type="button" className="sample-link"
            onClick={() => setCrop({ x: 0, y: 0, w: img.naturalWidth, h: img.naturalHeight })}>
            Select the whole image
          </button>
        </aside>
      </div>
    </Modal>
  );
}
