/* Pipeline: clean JPEG noise at the image's own size, upscale so every edge is several
   pixels wide, then snap to a flat palette. Snapping an upscaled edge puts the boundary on
   its true sub-pixel position, which is what makes the traced curves smooth and exact. */
import { cdist, hexOf, yieldUI } from "./color";
import { cfg, flag } from "./config";
import { denoise } from "./preprocess";
import { binarize, quantize } from "./quantize";
import { removeSpecks } from "./raster";
import { traceShared } from "./traceShared";
import { traceSmooth } from "./traceSmooth";
import { BinaryImageConverter, ColorImageConverter } from "./vtracer/vtracer_webapp.js";
import type { AliveFn, Layer, RGB, StageFn } from "./types";
import { applyPaletteRule, parsePalette } from "../output/palette";
import { isNativeEngine, lineTolVal, minAreaVal, usesSmoothEngine, type Settings } from "../settings";

export interface SourceImage {
  img: HTMLImageElement;
  w: number;
  h: number;
  name: string;
}

export interface Prepared {
  tw: number;
  th: number;
  /** The shared trace canvas, holding the prepared pixels. */
  g: CanvasRenderingContext2D;
  /** True when the pixels were snapped to a flat palette. */
  clean: boolean;
  scale: number;
  pal: RGB[] | null;
  idx: Uint8Array | null;
}

/** One swatch of the palette editor: a traced color and how much of the image it covers. */
export interface Swatch {
  hex: string;
  c: RGB;
  area: number;
}

export interface TracedResult {
  shapes: Layer[] | null;
  body: string | null;
  tw: number;
  th: number;
  scale: number;
  colors: number;
  engineName: string;
  /** Base colors for the palette editor; null when the engine can't report them. */
  palBase: Swatch[] | null;
}

/** The canvas VTracer reads from. It must live in the document under this id. */
export const VT_CANVAS_ID = "vtCanvas";
/** The SVG element VTracer writes into. */
export const VT_SVG_ID = "vtSvg";

const traceCanvas = (): HTMLCanvasElement => {
  const c = document.getElementById(VT_CANVAS_ID);
  if (!(c instanceof HTMLCanvasElement)) throw new Error("trace canvas missing");
  return c;
};

/** Everything that changes the prepared pixels; a repeat key reuses the last color analysis. */
export function prepKey(src: SourceImage, s: Settings): string {
  return JSON.stringify([src.name, src.w, src.h, s.preset, s.maxSize, s.upscale, s.denoise, s.dropBg,
    s.palette, s.maxColors, s.smooth, s.engine, s.colors, s.grad]);
}

export async function prepare(src: SourceImage, s: Settings, stage: StageFn, alive: AliveFn): Promise<Prepared | null> {
  const mp = cfg("mp", s.maxSize) * 1e6;
  const native = src.w * src.h;
  let k = mp ? Math.sqrt(mp / native) : 1;
  if (!s.upscale) k = Math.min(k, 1);
  // flat-color tracing gains the most from sub-pixel upscaling; gradient tracing only gets bigger files
  k = Math.min(k, s.preset !== "bw" && s.palette !== "clean" ? 2 : 4);
  // Precision works on the original pixels; only very small images are enlarged a little
  if (isNativeEngine(s) || flag("native")) k = native < 4e5 ? Math.min(2, Math.sqrt(4e5 / native)) : 1;
  const tw = Math.max(1, Math.round(src.w * k)), th = Math.max(1, Math.round(src.h * k));
  const scale = tw / src.w;
  // stage 1: base image at native size (or the target size, if smaller)
  const kb = Math.min(k, 1);
  const bw = Math.max(1, Math.round(src.w * kb)), bh = Math.max(1, Math.round(src.h * kb));
  const base = document.createElement("canvas"); base.width = bw; base.height = bh;
  const bg = base.getContext("2d", { willReadFrequently: true })!;
  bg.imageSmoothingEnabled = true; bg.imageSmoothingQuality = "high";
  if (!s.dropBg) { bg.fillStyle = "#fff"; bg.fillRect(0, 0, bw, bh); }
  bg.drawImage(src.img, 0, 0, bw, bh);
  if ((s.denoise && !flag("noDenoise")) || s.preset === "bw") {
    stage("Cleaning JPEG noise…"); await yieldUI(); if (!alive()) return null;
    const imgd = bg.getImageData(0, 0, bw, bh);
    denoise(imgd, 1, 44); denoise(imgd, 1, 28);
    bg.putImageData(imgd, 0, 0);
  }
  // stage 2: upscale in ≤2× steps for smooth edge ramps
  if (k > 1) { stage("Upscaling " + scale.toFixed(1) + "× for sub-pixel edges…"); await yieldUI(); if (!alive()) return null; }
  let srcCanvas: HTMLCanvasElement = base, cw = bw, ch = bh;
  while (tw / cw > 2.01) {
    const t = document.createElement("canvas"); t.width = cw * 2; t.height = ch * 2;
    const tg = t.getContext("2d")!; tg.imageSmoothingEnabled = true; tg.imageSmoothingQuality = "high";
    tg.drawImage(srcCanvas, 0, 0, t.width, t.height);
    srcCanvas = t; cw = t.width; ch = t.height;
  }
  const c = traceCanvas(); c.width = tw; c.height = th;
  const g = c.getContext("2d", { willReadFrequently: true })!;
  g.clearRect(0, 0, tw, th);
  g.imageSmoothingEnabled = true; g.imageSmoothingQuality = "high";
  g.drawImage(srcCanvas, 0, 0, tw, th);
  // stage 3: flat colors with clean edges
  let pal: RGB[] | null = null, idx: Uint8Array | null = null;
  const clean = s.preset !== "bw" && s.palette === "clean";
  if (clean || s.preset === "bw") {
    stage(s.preset === "bw" ? "Thresholding…" : "Building clean palette…"); await yieldUI(); if (!alive()) return null;
    const imgd = g.getImageData(0, 0, tw, th);
    if (s.preset === "bw") idx = binarize(imgd, scale, s.smooth);
    else {
      const q = await quantize(imgd, s.maxColors, { scale, smooth: s.smooth, native: isNativeEngine(s), stage, alive });
      if (q) { pal = q.pal; idx = q.idx; }
    }
    if (!alive()) return null;
    g.putImageData(imgd, 0, 0);
  }
  return { tw, th, g, clean, scale, pal, idx };
}

/** Traces the prepared pixels with the smooth/precision engines. */
export async function traceShapes(prep: Prepared, s: Settings, stage: StageFn, alive: AliveFn): Promise<TracedResult | null> {
  const { tw, th, scale } = prep;
  const bw = s.preset === "bw";
  const idx = prep.idx!;
  const pal: RGB[] = bw ? [[0, 0, 0], [255, 255, 255]] : prep.pal!;
  const precision = s.engine === "precision" || s.engine === "native";
  // custom palette (snap / remap / remove), applied to the palette before tracing
  const { rules } = parsePalette(s.customPal);
  const skipSet = bw ? new Set<number>([1]) : new Set<number>();
  let outPal = pal;
  if (rules.length) {
    outPal = pal.map((c, k) => { const r = applyPaletteRule(rules, c); if (!r) { skipSet.add(k); return c; } return r; });
  }
  // base palette for the palette editor: every color found, by how much of the image it covers
  let palBase: Swatch[] | null = null;
  if (!bw) {
    const area = new Float64Array(pal.length);
    for (let p = 0; p < idx.length; p++) { const v = idx[p]; if (v !== 255 && v < pal.length) area[v]++; }
    const seen = new Map<string, Swatch>();
    pal.forEach((c, k) => { const hx = hexOf(c); if (!seen.has(hx)) seen.set(hx, { hex: hx, c: c.slice(), area: 0 }); seen.get(hx)!.area += area[k]; });
    palBase = [...seen.values()].filter(b => b.area > 0).sort((a, b) => b.area - a.area);
  }
  // colors that now share one output color become one region, so they trace as single shapes
  const firstOf = new Map<string, number>(), canon = new Int16Array(256).fill(-1); let relabel = false;
  outPal.forEach((c, k) => { if (skipSet.has(k)) return; const hx = c.join(); if (!firstOf.has(hx)) firstOf.set(hx, k); canon[k] = firstOf.get(hx)!; if (canon[k] !== k) relabel = true; });
  if (relabel) for (let p = 0; p < idx.length; p++) { const v = idx[p]; if (v !== 255 && canon[v] >= 0) idx[p] = canon[v]; }
  removeSpecks(idx, tw, th, Math.round(minAreaVal(s) * Math.max(1, scale) ** 2), flag("speckMajority") ? null : pal,
    precision ? Math.round(cfg("blob", 40) * Math.max(1, scale) ** 2) : 0, Math.max(1, scale));
  const opts = {
    precision, alphaMax: cfg("alphaMax", 0.75 + 0.15 * s.smooth),
    sigma: cfg("sig", 1) * (0.5 + 0.3 * Math.min(scale, 3)) * (0.7 + 0.2 * s.smooth),
    tol: precision ? cfg("ptol", Math.max(0.2, lineTolVal(s) * 1.3)) * Math.max(1, scale) : lineTolVal(s) * Math.max(1, scale),
    etol: s.allowArcs ? Math.max(0.6, 0.6 * Math.max(1, scale)) : 0, scale,
    cornerDeg: s.corner, prec: scale > 1.5 ? 1 : 2,
    arc: cfg("arc", 2.2) * Math.max(1, scale) * (s.smooth / 1.5),
    skip: skipSet, dil: bw || s.stacking === "cutouts" ? 0 : 2,
    stage, alive
  };
  const res = precision || s.stacking === "cutouts"
    ? await traceShared(idx, tw, th, pal, opts)
    : await traceSmooth(idx, tw, th, pal, opts);
  if (!res) return null;
  res.layers.forEach(Lr => Lr.c = outPal[Lr.k]);
  return {
    shapes: res.layers, body: null, tw, th, scale,
    colors: new Set(res.layers.map(Lr => Lr.c.join())).size,
    engineName: precision ? "Precision" : "Smooth",
    palBase
  };
}

/** Handle for stopping a VTracer run that is still stepping. */
export interface Runner { stop(): void }

/** Classic engine: hands the prepared canvas to VTracer and steps it so the page keeps painting. */
export function traceVT(prep: Prepared, s: Settings, onRunner: (r: Runner | null) => void, stage: StageFn, alive: AliveFn): Promise<TracedResult | null> {
  const { tw, th, scale, clean, pal } = prep;
  const deg2rad = (d: number) => d / 180 * Math.PI;
  return new Promise<TracedResult | null>((resolve, reject) => {
    try {
      const svg = document.getElementById(VT_SVG_ID) as SVGSVGElement | null;
      if (!svg) { reject(new Error("VTracer output element missing")); return; }
      while (svg.firstChild) svg.removeChild(svg.firstChild);
      const common = {
        canvas_id: VT_CANVAS_ID, svg_id: VT_SVG_ID,
        mode: s.curve,
        corner_threshold: deg2rad(s.corner),
        length_threshold: s.seglen,
        max_iterations: 10,
        splice_threshold: deg2rad(45),
        filter_speckle: Math.max(0, Math.round(minAreaVal(s) * Math.max(1, scale) ** 2)),
        path_precision: scale > 1.5 ? 1 : 2
      };
      let conv: { init(): void; tick(): boolean; progress(): number; free(): void };
      try {
        conv = s.preset === "bw"
          ? BinaryImageConverter.new_with_string(JSON.stringify(common))
          : ColorImageConverter.new_with_string(JSON.stringify({
              ...common,
              hierarchical: s.layering,
              color_precision: clean ? 0 : 8 - s.colors,
              layer_difference: clean ? 4 : s.grad
            }));
        conv.init();
      } catch (err) { reject(err); return; }
      let stopped = false;
      onRunner({ stop() { stopped = true; try { conv.free(); } catch { /* already freed */ } } });
      const step = (): void => {
        if (stopped || !alive()) { resolve(null); return; }
        let done = false;
        const s0 = performance.now();
        try {
          while (!(done = conv.tick()) && performance.now() - s0 < 30) { /* keep slices short */ }
        } catch (err) { stopped = true; onRunner(null); reject(err); return; }
        stage("Tracing paths… " + Math.min(100, Math.round(conv.progress())) + "%");
        if (done) {
          stopped = true; try { conv.free(); } catch { /* already freed */ } onRunner(null);
          let body = [...svg.childNodes].map(n => (n as Element).outerHTML || "").join("");
          // VTracer averages the colors of clusters it merges; snap each fill back to the clean palette
          if (clean && pal && pal.length) {
            const memo = new Map<string, string>();
            body = body.replace(/fill:\s*#([0-9a-fA-F]{6})/g, (_m, hex: string) => {
              let out = memo.get(hex);
              if (!out) {
                const v = parseInt(hex, 16), r = v >> 16, g = v >> 8 & 255, b = v & 255;
                let bi = 0, bd = Infinity;
                pal.forEach((c, k) => { const dd = cdist(r, g, b, c[0], c[1], c[2]); if (dd < bd) { bd = dd; bi = k; } });
                out = "fill:" + hexOf(pal[bi]);
                memo.set(hex, out);
              }
              return out;
            });
          }
          const fills = new Set<string>(); body.replace(/fill:\s*([^;"]+)/g, (m, c: string) => { fills.add(c.trim()); return m; });
          let out = body;
          if (s.preset === "bw") out = out.replace(/<path /g, '<path fill="#000" ');
          resolve({
            shapes: null, body: out, tw, th, scale,
            colors: s.preset === "bw" ? 1 : fills.size,
            engineName: "VTracer", palBase: null
          });
        } else setTimeout(step, 0);
      };
      setTimeout(step, 0);
    } catch (err) { reject(err); }
  });
}

/** Last-resort engine when wasm is unavailable. */
export async function traceIT(prep: Prepared, s: Settings, alive: AliveFn): Promise<TracedResult | null> {
  const { tw, th, scale, g } = prep;
  const imgd = g.getImageData(0, 0, tw, th);
  const { default: ImageTracer } = await import("imagetracerjs");
  const o: Record<string, unknown> = {
    numberofcolors: s.preset === "bw" ? 2 : Math.min(64, 2 ** Math.min(6, s.colors - 1)),
    ltres: 1, qtres: 1, pathomit: Math.round(Math.sqrt(minAreaVal(s)) * 2), colorsampling: 2, colorquantcycles: 3,
    mincolorratio: 0, strokewidth: 1, roundcoords: 1, scale: 1, viewbox: false, desc: false
  };
  if (s.preset === "bw") { o.colorsampling = 0; o.pal = [{ r: 0, g: 0, b: 0, a: 255 }, { r: 255, g: 255, b: 255, a: 255 }]; }
  await yieldUI();
  if (!alive()) return null;
  const td = ImageTracer.imagedataToTracedata(imgd, o);
  let body = ImageTracer.getsvgstring(td, o).replace(/^<svg[^>]*>/, "").replace(/<\/svg>\s*$/, "");
  if (s.dropBg) body = body.replace(/<path[^>]*?opacity="([\d.e-]+)"[^>]*\/>/g, (m, a: string) => (+a < 0.25 ? "" : m));
  body = body.replace(/ opacity="1"/g, "");
  return {
    shapes: null, body, tw, th, scale,
    colors: td.palette.filter((c: { a: number }) => c.a > 0).length,
    engineName: "imagetracer.js", palBase: null
  };
}

/** True when this settings combination is traced by the in-house engines. */
export const tracesShapes = (s: Settings, prep: Prepared): boolean =>
  usesSmoothEngine(s) && !!prep.idx && (!!prep.pal || s.preset === "bw");
