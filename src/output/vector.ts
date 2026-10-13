/* EPS / PDF share one path writer: y flips, units are points, arcs become cubics. */
import { parseHex } from "../engine/color";
import { ellipseCubics } from "../engine/curve";
import type { Loop } from "../engine/types";
import type { Settings } from "../settings";
import { outSize, type OutSize } from "./size";
import type { Doc, SrcSize } from "./svg";

function vectorOps(kind: "eps" | "pdf", doc: Doc, s: Settings, src: SrcSize): { ops: string; sz: OutSize } {
  const { tw, th } = doc, sz = outSize(s, src.w, src.h);
  const sx = sz.wPt / tw, sy = sz.hPt / th, f = (v: number) => +v.toFixed(3);
  const X = (x: number) => f(x * sx), Y = (y: number) => f((th - y) * sy);
  const ps = kind === "eps";
  const M = ps ? "moveto" : "m", C = ps ? "curveto" : "c", Z = ps ? "closepath" : "h";
  const style = s.drawStyle, over = style === "stroke_edges" || s.strokeOverride ? parseHex(s.strokeColor) : null;
  const col = (c: number[], stroke = false) => { const [r, g, b] = c.map(v => f(v / 255)); return ps ? `${r} ${g} ${b} setrgbcolor` : `${r} ${g} ${b} ${stroke ? "RG" : "rg"}`; };
  const pathOps = (loops: Loop[]) => loops.map(lp => { const L = lp.e ? ellipseCubics(lp.e) : lp; return `${X(L.s![0])} ${Y(L.s![1])} ${M}\n` + L.c!.map(z => `${X(z[0])} ${Y(z[1])} ${X(z[2])} ${Y(z[3])} ${X(z[4])} ${Y(z[5])} ${C}`).join("\n") + `\n${Z}`; }).join("\n");
  const ptPerPx = sz.wPt / sz.wPx;
  const shapes = doc.shapes ?? [];
  let out = ps ? "1 setlinejoin\n" : "1 j\n";
  if (style === "fill_shapes") {
    if (s.gapOn && s.gapWidth > 0) {
      out += (ps ? `${f(s.gapWidth * ptPerPx)} setlinewidth\n` : `${f(s.gapWidth * ptPerPx)} w\n`);
      for (const Lr of shapes) out += (ps ? "newpath\n" : "") + col(Lr.c, true) + "\n" + pathOps(Lr.loops) + (ps ? "\nstroke\n" : "\nS\n");
    }
    for (const Lr of shapes) out += (ps ? "newpath\n" : "") + col(Lr.c) + "\n" + pathOps(Lr.loops) + (ps ? "\neofill\n" : "\nf*\n");
  } else {
    out += (ps ? `${f(s.strokeWidth * ptPerPx)} setlinewidth\n` : `${f(s.strokeWidth * ptPerPx)} w\n`);
    for (const Lr of shapes) out += (ps ? "newpath\n" : "") + col(over ? over.slice(0, 3) : Lr.c, true) + "\n" + pathOps(Lr.loops) + (ps ? "\nstroke\n" : "\nS\n");
  }
  return { ops: out, sz };
}

export function buildEPS(doc: Doc, s: Settings, src: SrcSize): Blob {
  const { ops, sz } = vectorOps("eps", doc, s, src);
  const W = Math.ceil(sz.wPt), H = Math.ceil(sz.hPt);
  return new Blob([`%!PS-Adobe-3.0 EPSF-3.0\n%%Creator: Vectorizer Custom\n%%BoundingBox: 0 0 ${W} ${H}\n%%HiResBoundingBox: 0 0 ${sz.wPt.toFixed(3)} ${sz.hPt.toFixed(3)}\n%%EndComments\ngsave\n${ops}grestore\nshowpage\n%%EOF\n`], { type: "application/postscript" });
}

export async function buildPDF(doc: Doc, s: Settings, src: SrcSize): Promise<Blob> {
  const { ops, sz } = vectorOps("pdf", doc, s, src);
  const enc = new TextEncoder();
  let stream = enc.encode(ops), filter = "";
  if (typeof CompressionStream !== "undefined" && s.pdfComp === "compressed") {
    try {
      const cs = new Blob([stream]).stream().pipeThrough(new CompressionStream("deflate"));
      stream = new Uint8Array(await new Response(cs).arrayBuffer()); filter = " /Filter /FlateDecode";
    } catch { /* uncompressed is still a valid PDF */ }
  }
  const W = sz.wPt.toFixed(3), H = sz.hPt.toFixed(3);
  const parts: (Uint8Array | string)[] = [], offs: number[] = []; let len = 0;
  const push = (p: Uint8Array | string): void => { const b = typeof p === "string" ? enc.encode(p) : p; parts.push(b); len += b.length; };
  push("%PDF-1.4\n%\xE2\xE3\xCF\xD3\n");
  const obj = (n: number, body: string): void => { offs[n] = len; push(`${n} 0 obj\n${body}\nendobj\n`); };
  obj(1, "<< /Type /Catalog /Pages 2 0 R >>");
  obj(2, "<< /Type /Pages /Kids [3 0 R] /Count 1 >>");
  obj(3, `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${W} ${H}] /Contents 4 0 R /Resources << >> >>`);
  offs[4] = len; push(`4 0 obj\n<< /Length ${stream.length}${filter} >>\nstream\n`); push(stream); push("\nendstream\nendobj\n");
  const xref = len;
  push(`xref\n0 5\n0000000000 65535 f \n` + [1, 2, 3, 4].map(n => String(offs[n]).padStart(10, "0") + " 00000 n \n").join("") + `trailer\n<< /Size 5 /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`);
  return new Blob(parts as BlobPart[], { type: "application/pdf" });
}
