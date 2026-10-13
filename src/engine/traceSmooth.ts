/* Smooth tracer: for each palette color build its mask (plus a 2-px underlap beneath the
   shapes stacked on top, so layers never show hairline gaps), blur it slightly, and take the
   0.5 iso-contour with marching squares. That contour sits between pixels, so it has no
   staircase at all; each contour is then split at real corners and fitted with cubics. */
import { yieldUI } from "./color";
import { fitLoop } from "./curve";
import { blur1D, marchingSquares } from "./raster";
import type { AliveFn, Layer, Loop, Pt, RGB, StageFn } from "./types";

export interface SmoothOpts {
  /** Blur radius of the mask, in trace pixels. */
  sigma: number;
  /** Curve fit tolerance, in trace pixels. */
  tol: number;
  cornerDeg: number;
  prec: number;
  /** Palette entries to leave out (e.g. the background that was dropped). */
  skip?: Set<number>;
  /** How far each layer slips under the ones stacked above it. */
  dil?: number;
  stage: StageFn;
  alive: AliveFn;
  /** Contour smoothing strength; 0 keeps the raw iso-contour. */
  arc?: number;
  /** Ellipse snap tolerance; 0 disables exact circles/ellipses. */
  etol?: number;
}

export interface TraceResult {
  layers: Layer[];
  colors: number;
}

export async function traceSmooth(idx: Uint8Array, w: number, h: number, pal: RGB[], o: SmoothOpts): Promise<TraceResult | null> {
  const { sigma, tol, cornerDeg, prec, skip = new Set<number>(), dil = 2, stage, alive, arc = 0, etol = 0 } = o;
  const cnt = new Int32Array(256), minx = new Int32Array(256).fill(w), miny = new Int32Array(256).fill(h), maxx = new Int32Array(256).fill(-1), maxy = new Int32Array(256).fill(-1);
  for (let y = 0, p = 0; y < h; y++) for (let x = 0; x < w; x++, p++) {
    const k = idx[p]; if (k === 255) continue;
    cnt[k]++; if (x < minx[k]) minx[k] = x; if (x > maxx[k]) maxx[k] = x; if (y < miny[k]) miny[k] = y; if (y > maxy[k]) maxy[k] = y;
  }
  const order = pal.map((_, k) => k).filter(k => cnt[k] > 0 && !skip.has(k)).sort((a, b) => cnt[b] - cnt[a]);
  const rank = new Int16Array(256).fill(-1); order.forEach((k, i) => rank[k] = i);
  const R = Math.max(1, Math.ceil(sigma * 3)), ker: number[] = [];
  for (let i = -R; i <= R; i++) ker.push(Math.exp(-i * i / (2 * sigma * sigma)));
  const ks = ker.reduce((a, b) => a + b, 0), K = Float32Array.from(ker.map(v => v / ks));
  const PAD = dil + R + 2, cosCorner = Math.cos(cornerDeg / 180 * Math.PI);
  const layers: Layer[] = [];
  for (let li = 0; li < order.length; li++) {
    const L = order[li];
    stage("Fitting smooth curves… " + (li + 1) + "/" + order.length); await yieldUI(); if (!alive()) return null;
    const x0 = minx[L] - PAD, y0 = miny[L] - PAD, x1 = maxx[L] + PAD, y1 = maxy[L] + PAD;
    const GW = x1 - x0 + 3, GH = y1 - y0 + 3, G = GW * GH;
    const M = new Uint8Array(G);
    const colX = new Int32Array(GW);
    for (let i = 0; i < GW; i++) colX[i] = Math.min(w - 1, Math.max(0, x0 + i - 1));
    for (let j = 1; j < GH - 1; j++) {
      const yy = Math.min(h - 1, Math.max(0, y0 + j - 1)), row = yy * w;
      for (let i = 1; i < GW - 1; i++) {
        const k = idx[row + colX[i]];
        M[j * GW + i] = k === L ? 1 : (k !== 255 && rank[k] > li ? 2 : 0);
      }
    }
    for (let it = 0; it < dil; it++) {
      for (let j = 1; j < GH - 1; j++) for (let i = 1; i < GW - 1; i++) {
        const p = j * GW + i; if (M[p] !== 2) continue;
        if (M[p - 1] === 1 || M[p + 1] === 1 || M[p - GW] === 1 || M[p + GW] === 1 || M[p - GW - 1] === 1 || M[p - GW + 1] === 1 || M[p + GW - 1] === 1 || M[p + GW + 1] === 1) M[p] = 3;
      }
      for (let p = 0; p < G; p++) if (M[p] === 3) M[p] = 1;
    }
    const F = new Float32Array(G), T = new Float32Array(G);
    for (let p = 0; p < G; p++) F[p] = M[p] === 1 ? 1 : 0;
    blur1D(F, T, GW, GH, 1, GW, K, R);      // rows
    blur1D(T, F, GH, GW, GW, 1, K, R);      // columns
    for (let i = 0; i < GW; i++) { F[i] = 0; F[(GH - 1) * GW + i] = 0; }
    for (let j = 0; j < GH; j++) { F[j * GW] = 0; F[j * GW + GW - 1] = 0; }
    const loops = marchingSquares(F, GW, GH);
    const ls: Loop[] = [];
    for (const lp of loops) {
      let area = 0;
      for (let i = 0, n = lp.length; i < n; i++) { const a = lp[i], b = lp[(i + 1) % n]; area += a[0] * b[1] - b[0] * a[1]; }
      if (Math.abs(area) < 3) continue;
      const pts: Pt[] = lp.map(p => [p[0] + x0 - 1 + 0.5, p[1] + y0 - 1 + 0.5]);
      const f = fitLoop(pts, tol, cosCorner, prec, arc, etol);
      if (f) { f.area = Math.abs(area) / 2; ls.push(f); }
    }
    if (ls.length) layers.push({ k: L, c: pal[L], loops: ls });
  }
  return { layers, colors: order.length };
}
