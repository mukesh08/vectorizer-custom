/* output.size.*: the document size in its unit, plus px/pt equivalents. */
import type { Settings, Unit } from "../settings";

export const UNIT_PT: Record<Unit, number> = { none: 0.75, px: 0.75, pt: 1, in: 72, cm: 72 / 2.54, mm: 72 / 25.4 };

export interface OutSize {
  w: number; h: number; unit: Unit;
  wPt: number; hPt: number;
  wPx: number; hPx: number;
}

export function outSize(s: Settings, W0: number, H0: number): OutSize {
  const unit = s.outUnit;
  let w = parseFloat(s.outW), h = parseFloat(s.outH);
  const sc = parseFloat(s.outScale);
  const physical = unit === "pt" || unit === "in" || unit === "cm" || unit === "mm";
  const inDpi = parseFloat(s.inDpi) > 0 ? parseFloat(s.inDpi) : 72;
  const outDpi = parseFloat(s.outDpi) > 0 ? parseFloat(s.outDpi) : 72;
  // the image's own size in the chosen unit (pixels become physical through the input DPI)
  const nat = physical ? 72 / inDpi / UNIT_PT[unit] : 1;
  if (sc > 0) { w = W0 * nat * sc; h = H0 * nat * sc; }
  else if (w > 0 && !(h > 0)) h = w * H0 / W0;
  else if (h > 0 && !(w > 0)) w = h * W0 / H0;
  else if (!(w > 0 && h > 0)) { w = W0 * nat; h = H0 * nat; }
  const k = UNIT_PT[unit];
  const toPx = physical ? k / 72 * outDpi : 1;
  return { w, h, unit, wPt: w * k, hPt: h * k, wPx: w * toPx, hPx: h * toPx };
}

export function aspectAttr(s: Settings): string {
  const al = "x" + s.alignX + "Y" + s.alignY;
  return { preserve_inset: al + " meet", preserve_overflow: al + " slice", stretch: "none" }[s.aspect];
}
