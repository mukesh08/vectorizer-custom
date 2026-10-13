/* DXF (AutoCAD R12, readable by nearly every CAD, laser and vinyl-cutter app): one layer per
   color, every outline as a closed polyline; with "lines and arcs", round shapes become true
   CIRCLEs. */
import { hexOf } from "../engine/color";
import { ellipseCubics } from "../engine/curve";
import type { Cubic, Pt } from "../engine/types";
import { lineTolVal, type Settings } from "../settings";
import { outSize } from "./size";
import type { Doc, SrcSize } from "./svg";

export function buildDXF(doc: Doc, s: Settings, src: SrcSize): Blob {
  const { tw, th } = doc, sz = outSize(s, src.w, src.h), f = (v: number) => +v.toFixed(4);
  const sx = sz.w / tw, sy = sz.h / th, X = (x: number) => f(x * sx), Y = (y: number) => f((th - y) * sy);
  const tolOut = Math.max(1e-4, lineTolVal(s) * Math.max(1, doc.scale) * sx * 0.5);
  const arcs = s.dxfLevel === "lines_and_arcs" && s.allowArcs;
  const flatten = (p0: Pt, z: Cubic, out: Pt[]): void => {
    // adaptive subdivision until the curve is within tolerance of a straight line
    const rec = (x0: number, y0: number, x1: number, y1: number, x2: number, y2: number, x3: number, y3: number, d: number): void => {
      const ux = x3 - x0, uy = y3 - y0, L = Math.hypot(ux, uy) || 1e-9;
      const d1 = Math.abs((x1 - x0) * uy - (y1 - y0) * ux) / L, d2 = Math.abs((x2 - x0) * uy - (y2 - y0) * ux) / L;
      if (Math.max(d1, d2) <= tolOut || d > 12) { out.push([x3, y3]); return; }
      const ax = (x0 + x1) / 2, ay = (y0 + y1) / 2, bx = (x1 + x2) / 2, by = (y1 + y2) / 2, cx = (x2 + x3) / 2, cy = (y2 + y3) / 2;
      const dx = (ax + bx) / 2, dy = (ay + by) / 2, ex = (bx + cx) / 2, ey = (by + cy) / 2, mx = (dx + ex) / 2, my = (dy + ey) / 2;
      rec(x0, y0, ax, ay, dx, dy, mx, my, d + 1); rec(mx, my, ex, ey, cx, cy, x3, y3, d + 1);
    };
    rec(p0[0], p0[1], z[0] * sx, z[1] * sx, z[2] * sx, z[3] * sx, z[4] * sx, z[5] * sx, 0);
  };
  const layers: string[] = [], ents: string[] = [];
  for (const Lr of doc.shapes ?? []) {
    const name = "C_" + hexOf(Lr.c).slice(1).toUpperCase(), tc = (Lr.c[0] << 16) | (Lr.c[1] << 8) | Lr.c[2];
    if (!layers.includes(name)) layers.push(name);
    for (const lp of Lr.loops) {
      if (lp.e && arcs && Math.abs(lp.e[2] - lp.e[3]) < 0.02 * lp.e[2] && Math.abs(sx - sy) < 1e-9) {
        ents.push(`0\nCIRCLE\n8\n${name}\n420\n${tc}\n10\n${X(lp.e[0])}\n20\n${Y(lp.e[1])}\n30\n0\n40\n${f((lp.e[2] + lp.e[3]) / 2 * sx)}`);
        continue;
      }
      const L = lp.e ? ellipseCubics(lp.e) : lp;
      const pts: Pt[] = [[L.s![0] * sx, L.s![1] * sx]];
      for (const z of L.c!) flatten(pts[pts.length - 1], z, pts);
      if (pts.length > 2 && Math.hypot(pts[0][0] - pts[pts.length - 1][0], pts[0][1] - pts[pts.length - 1][1]) < 1e-6) pts.pop();
      let e = `0\nPOLYLINE\n8\n${name}\n420\n${tc}\n66\n1\n70\n1\n10\n0\n20\n0\n30\n0`;
      for (const [x, y] of pts) e += `\n0\nVERTEX\n8\n${name}\n10\n${f(x / sx * sx)}\n20\n${f((th * sx - y) * (sy / sx))}\n30\n0`;
      ents.push(e + `\n0\nSEQEND\n8\n${name}`);
    }
  }
  const head = `0\nSECTION\n2\nHEADER\n9\n$ACADVER\n1\nAC1009\n9\n$EXTMIN\n10\n0\n20\n0\n9\n$EXTMAX\n10\n${f(sz.w)}\n20\n${f(sz.h)}\n0\nENDSEC\n`;
  const tables = `0\nSECTION\n2\nTABLES\n0\nTABLE\n2\nLAYER\n70\n${layers.length}\n` + layers.map(n => `0\nLAYER\n2\n${n}\n70\n0\n62\n7\n6\nCONTINUOUS\n`).join("") + `0\nENDTAB\n0\nENDSEC\n`;
  return new Blob([head + tables + "0\nSECTION\n2\nENTITIES\n" + ents.join("\n") + "\n0\nENDSEC\n0\nEOF\n"], { type: "application/dxf" });
}
