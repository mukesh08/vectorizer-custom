/* PNG: render the SVG the browser already knows how to draw, at the requested pixel size. */
import type { Settings } from "../settings";
import { outSize } from "./size";
import { buildSVG, type Doc, type SrcSize } from "./svg";

export async function buildPNG(doc: Doc, s: Settings, src: SrcSize): Promise<Blob> {
  const sz = outSize(s, src.w, src.h), W = Math.max(1, Math.round(sz.wPx)), H = Math.max(1, Math.round(sz.hPx));
  if (W * H > 64e6) throw new Error("too big");
  const url = URL.createObjectURL(new Blob([buildSVG(doc, s, src, true)], { type: "image/svg+xml" }));
  try {
    const img = new Image(); img.src = url; await img.decode();
    const c = document.createElement("canvas"); c.width = W; c.height = H;
    c.getContext("2d")!.drawImage(img, 0, 0, W, H);
    const blob = await new Promise<Blob | null>(r => c.toBlob(r, "image/png"));
    if (!blob) throw new Error("PNG encoding failed");
    return blob;
  } finally { URL.revokeObjectURL(url); }
}
