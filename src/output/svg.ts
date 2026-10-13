/* Tracing produces shapes once; every output option below only rebuilds the file from them,
   so switching draw style, gap filler, grouping, size or format is instant. */
import { hexOf } from "../engine/color";
import { ellipseCubics } from "../engine/curve";
import { splitShapes } from "../engine/shapes";
import type { Layer, Loop } from "../engine/types";
import type { Settings } from "../settings";
import { aspectAttr, outSize } from "./size";

/** One traced result: fitted shapes (the smooth engines) or raw SVG markup (VTracer). */
export interface Doc {
  shapes: Layer[] | null;
  body: string | null;
  /** Trace resolution and how far the image was upscaled to reach it. */
  tw: number;
  th: number;
  scale: number;
}

/** Source image size in its own pixels. */
export interface SrcSize { w: number; h: number }

const sv = (v: number | string): string => { let t = String(v); if (t.startsWith("0.")) t = t.slice(1); else if (t.startsWith("-0.")) t = "-" + t.slice(2); return t; };

export function svgD(loops: Loop[], prec: number, arcs: boolean): string {
  const f = 10 ** prec, n = (v: number) => Math.round(v * f) / f, pt = (x: number, y: number) => n(x) + " " + n(y);
  let d = "";
  for (const lp of loops) {
    if (lp.e && arcs) {
      // four quarter arcs: exact ellipse, no large-arc ambiguity
      const [cx, cy, a, b, th] = lp.e, c = Math.cos(th), s = Math.sin(th), deg = n(th * 180 / Math.PI);
      const P = (u: number, v: number) => pt(cx + u * c - v * s, cy + u * s + v * c);
      const quads: [number, number][] = [[0, b], [-a, 0], [0, -b], [a, 0]];
      d += "M" + P(a, 0) + quads.map(q => "A" + n(a) + " " + n(b) + " " + deg + " 0 1 " + P(q[0], q[1])).join("") + "Z";
      continue;
    }
    // compact relative commands: rounded absolute positions are differenced, so nothing drifts
    const L = lp.e ? ellipseCubics(lp.e) : lp;
    let cx = n(L.s![0]), cy = n(L.s![1]);
    d += "M" + pt(cx, cy) + "c";
    let first = true;
    for (const z of L.c!) {
      const ax = n(z[4]), ay = n(z[5]);
      const vals = [n(z[0]) - cx, n(z[1]) - cy, n(z[2]) - cx, n(z[3]) - cy, ax - cx, ay - cy];
      for (const v of vals) { const t = sv(Math.round(v * f) / f); d += (first || t[0] === "-") ? t : " " + t; first = false; }
      cx = ax; cy = ay;
    }
    d += "z";
  }
  return d;
}

export function buildSVG(doc: Doc, s: Settings, src: SrcSize, forRaster = false): string {
  const { tw, th } = doc, sz = outSize(s, src.w, src.h);
  const u = sz.unit === "none" ? "" : sz.unit, num = (v: number) => +v.toFixed(4);
  const adobe = s.adobe;
  const verAttr = s.svgVer === "svg_tiny_1_2" ? ' version="1.2" baseProfile="tiny"' : s.svgVer === "svg_1_0" ? ' version="1.0"' : ' version="1.1"';
  const head = `<svg xmlns="http://www.w3.org/2000/svg"${verAttr} width="${num(sz.w)}${u}" height="${num(sz.h)}${u}" viewBox="0 0 ${tw} ${th}" preserveAspectRatio="${aspectAttr(s)}"${forRaster && s.aa === "aliased" ? ' shape-rendering="crispEdges"' : ""}>`;
  if (!doc.shapes) return head + (doc.body ?? "") + "</svg>";
  const prec = doc.scale > 1.5 ? 1 : 2, arcs = s.allowArcs && !s.flatten;
  const style = s.drawStyle, byColor = s.groupBy === "color";
  // screen px -> user units (for strokes that should scale with the drawing)
  const perPx = tw / sz.wPx;
  const items: { color: string; d: string }[] = [];
  for (const Lr of doc.shapes) {
    const groups = byColor ? [Lr.loops] : splitShapes(Lr.loops);
    for (const g of groups) items.push({ color: hexOf(Lr.c), d: svgD(g, prec, arcs) });
  }
  let body = "";
  const nonScale = (on: boolean) => on && !adobe;
  if (style === "fill_shapes") {
    const gap = s.gapOn && s.gapWidth > 0;
    const gw = s.gapWidth, gNS = nonScale(s.gapNonScaling);
    const sw = gNS ? gw : gw * perPx;
    const ve = gap && gNS && !adobe ? ' vector-effect="non-scaling-stroke"' : "";
    // gap filler: the same shapes stroked in their own color, drawn underneath every fill,
    // so it only shows through hairline seams between neighbouring shapes
    if (gap && !adobe) {
      body += `<g fill="none" stroke-linejoin="round">` + items.map((it, i) => `<use href="#p${i}" xlink:href="#p${i}" stroke="${it.color}" stroke-width="${num(sw)}"/>`).join("") + `</g>`;
    } else if (gap) {
      body += `<g fill="none" stroke-linejoin="round" stroke-width="${num(sw)}">` + items.map(it => `<path stroke="${it.color}" d="${it.d}"/>`).join("") + `</g>`;
    }
    const idAttr = (i: number) => gap && !adobe ? ` id="p${i}"` : "";
    if (byColor) {
      const byC = new Map<string, [{ color: string; d: string }, number][]>();
      items.forEach((it, k) => { if (!byC.has(it.color)) byC.set(it.color, []); byC.get(it.color)!.push([it, k]); });
      for (const [c, list] of byC) body += `<g fill="${c}" fill-rule="evenodd">` + list.map(([it, k]) => `<path${idAttr(k)}${ve} d="${it.d}"/>`).join("") + `</g>`;
    } else body += items.map((it, k) => `<path${idAttr(k)} fill="${it.color}" fill-rule="evenodd"${ve} d="${it.d}"/>`).join("");
  } else {
    const ns = nonScale(s.strokeNonScaling), w = s.strokeWidth;
    const sw = ns ? w : w * perPx, ve = ns ? ' vector-effect="non-scaling-stroke"' : "";
    const over = style === "stroke_edges" || s.strokeOverride ? s.strokeColor : null;
    body += `<g fill="none" stroke-width="${num(sw)}" stroke-linejoin="round"${over ? ` stroke="${over}"` : ""}>`;
    if (byColor && !over) {
      const byC = new Map<string, { color: string; d: string }[]>();
      items.forEach(it => { if (!byC.has(it.color)) byC.set(it.color, []); byC.get(it.color)!.push(it); });
      for (const [c, list] of byC) body += `<g stroke="${c}">` + list.map(it => `<path${ve} d="${it.d}"/>`).join("") + `</g>`;
    } else body += items.map(it => `<path${over ? "" : ` stroke="${it.color}"`}${ve} d="${it.d}"/>`).join("");
    body += `</g>`;
  }
  const xl = body.includes("xlink:href") ? ' xmlns:xlink="http://www.w3.org/1999/xlink"' : "";
  return head.replace("<svg ", "<svg" + xl + " ") + body + "</svg>";
}
