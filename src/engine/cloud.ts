/* Cloud engine: hands the image to Vectorizer.AI through this project's own /api/vectorize proxy.
 *
 * Unlike every other engine here, this one leaves the browser. The image is uploaded to a third
 * party, and outside test mode it spends credits on the operator's account. It is opt-in for
 * exactly those reasons, and the rail says so where the user chooses it.
 *
 * The mapping below is almost mechanical, because this app's settings model and the upstream API
 * describe the same surface — `output.draw_style`, `output.shape_stacking`, `output.gap_filler.*`,
 * `processing.max_colors` and friends line up one-to-one with controls that already exist. Where
 * they differ, the comment says why.
 *
 * Returns the SVG body (not a shape list), so PDF/EPS/DXF export stays unavailable here, the same
 * way it is for VTracer and imagetracer.
 */
import { lineTolVal, minAreaVal, type Settings } from "../settings";
import type { Prepared, TracedResult } from "./pipeline";
import type { AliveFn, StageFn } from "./types";

export type CloudMode = "test" | "preview" | "production";

export const CLOUD_ENDPOINT = "/api/vectorize";

export interface CloudError extends Error {
  status?: number;
  /** Upstream's own error code, where it gave one. */
  upstreamCode?: number;
}

const fail = (message: string, status?: number, upstreamCode?: number): CloudError => {
  const e = new Error(message) as CloudError;
  e.status = status;
  e.upstreamCode = upstreamCode;
  return e;
};

/** The app's settings, expressed as upstream form fields. */
export function cloudParams(s: Settings): Record<string, string> {
  const p: Record<string, string> = {
    // always ask for SVG: the other formats are rebuilt locally from this result
    "output.file_format": "svg",
    "output.svg.version": s.svgVer,
    "output.svg.adobe_compatibility_mode": String(s.adobe),
    "output.draw_style": s.drawStyle,
    "output.shape_stacking": s.stacking === "cutouts" ? "cutouts" : "stacked",
    "output.group_by": s.groupBy,
    "output.gap_filler.enabled": String(s.gapOn),
    "output.gap_filler.stroke_width": String(s.gapWidth),
    "output.gap_filler.non_scaling_stroke": String(s.gapNonScaling),
    "output.strokes.stroke_width": String(s.strokeWidth),
    "output.strokes.non_scaling_stroke": String(s.strokeNonScaling),
    "output.strokes.use_override_color": String(s.strokeOverride),
    "output.strokes.override_color": s.strokeColor,
    "output.curves.line_fit_tolerance": String(Math.min(1, Math.max(0.001, lineTolVal(s)))),
    // the local "Fit circles & ellipses as true arcs" switch covers both arc families upstream
    "output.curves.allowed.circular_arc": String(s.allowArcs),
    "output.curves.allowed.elliptical_arc": String(s.allowArcs),
    "output.parameterized_shapes.flatten": String(s.flatten),
    // upstream takes min area in px² directly, where the rail stores a slider index
    "processing.shapes.min_area_px": String(Math.min(100, minAreaVal(s))),
    "output.bitmap.anti_aliasing_mode": s.aa
  };

  // 0 means "unlimited" upstream, which is what the gradient palette wants
  p["processing.max_colors"] = s.palette === "gradients" ? "0" : String(Math.min(256, s.maxColors));
  if (s.customPal.trim()) p["processing.palette"] = s.customPal.trim();

  // Detail level is a megapixel cap locally; upstream takes a pixel count, clamped to its range.
  if (s.maxSize > 0) {
    p["input.max_pixels"] = String(Math.min(3_145_828, Math.max(100, Math.round(s.maxSize * 1e6))));
  }

  // output size: send only the fields the user actually filled in
  if (s.outW) p["output.size.width"] = s.outW;
  if (s.outH) p["output.size.height"] = s.outH;
  if (s.outScale) p["output.size.scale"] = s.outScale;
  if (s.outUnit !== "none") p["output.size.unit"] = s.outUnit;
  if (s.inDpi) p["output.size.input_dpi"] = s.inDpi;
  if (s.outDpi) p["output.size.output_dpi"] = s.outDpi;
  p["output.size.aspect_ratio"] = s.aspect;
  // upstream alignment is 0..1 on each axis, where the rail offers Min/Mid/Max
  const align = (v: "Min" | "Mid" | "Max"): string => (v === "Min" ? "0" : v === "Max" ? "1" : "0.5");
  p["output.size.align_x"] = align(s.alignX);
  p["output.size.align_y"] = align(s.alignY);

  return p;
}

/** Pulls the canvas the pipeline already prepared into a PNG blob. */
function canvasBlob(prep: Prepared): Promise<Blob> {
  return new Promise<Blob>((resolve, reject) => {
    prep.g.canvas.toBlob(
      b => (b ? resolve(b) : reject(fail("Could not read the prepared image."))),
      "image/png"
    );
  });
}

export async function traceCloud(
  prep: Prepared, s: Settings, mode: CloudMode, stage: StageFn, alive: AliveFn
): Promise<TracedResult | null> {
  const { tw, th, scale } = prep;

  stage("Preparing upload…");
  const blob = await canvasBlob(prep);
  if (!alive()) return null;

  // the proxy takes the image as the raw body and the options as query parameters, so that it
  // never parses multipart and rebuilds the upstream form itself
  const query = new URLSearchParams({ mode, ...cloudParams(s) });

  stage(mode === "test" ? "Tracing on Vectorizer.AI (free test mode)…" : "Tracing on Vectorizer.AI…");
  const res = await fetch(`${CLOUD_ENDPOINT}?${query}`, {
    method: "POST",
    headers: { "content-type": "image/png" },
    body: blob
  });
  if (!alive()) return null;

  if (!res.ok) {
    let detail = "";
    let code: number | undefined;
    try {
      const j = await res.json() as { error?: string; message?: string; code?: number };
      detail = [j.error, j.message].filter(Boolean).join(" ");
      code = j.code;
    } catch { detail = `Request failed (${res.status}).`; }
    throw fail(detail || `Request failed (${res.status}).`, res.status, code);
  }

  const text = await res.text();
  if (!/<svg[\s>]/i.test(text)) throw fail("Vectorizer.AI returned something that is not an SVG.");

  // the pipeline wants the inner markup plus the traced pixel size, so read them off the result
  const open = text.match(/<svg[^>]*>/i)?.[0] ?? "";
  const vb = open.match(/viewBox="\s*[\d.+-]+\s+[\d.+-]+\s+([\d.+-]+)\s+([\d.+-]+)/i);
  const wAttr = open.match(/\bwidth="([\d.]+)/i);
  const hAttr = open.match(/\bheight="([\d.]+)/i);
  const outW = vb ? +vb[1] : wAttr ? +wAttr[1] : tw;
  const outH = vb ? +vb[2] : hAttr ? +hAttr[2] : th;

  const inner = text.replace(/^[\s\S]*?<svg[^>]*>/i, "").replace(/<\/svg>\s*$/i, "");
  const fills = new Set<string>();
  inner.replace(/fill="([^"]+)"/gi, (m, c: string) => { if (c !== "none") fills.add(c.trim()); return m; });
  inner.replace(/fill:\s*([^;"]+)/gi, (m, c: string) => { if (c !== "none") fills.add(c.trim()); return m; });

  const charged = res.headers.get("x-credits-charged");
  const served = res.headers.get("x-vectorizer-mode") ?? mode;
  const label = served === "production" ? "Vectorizer.AI" : `Vectorizer.AI (${served})`;

  return {
    shapes: null,
    body: inner,
    tw: Math.max(1, Math.round(outW)),
    th: Math.max(1, Math.round(outH)),
    scale,
    colors: fills.size,
    engineName: charged && charged !== "0" ? `${label} · ${charged} cr` : label,
    palBase: null
  };
}
