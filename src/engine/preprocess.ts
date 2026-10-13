/* Pixel-level cleanup that runs before tracing: noise removal, label smoothing, line
   consolidation and halo removal. Everything here works on the label map `idx` (one palette
   index per pixel, 255 = transparent) next to the original RGBA pixels. */
import { cdist } from "./color";
import { cfg } from "./config";
import type { RGB } from "./types";

/** Edge-preserving smoothing: averages each pixel with neighbours of similar color only,
    which flattens JPEG noise and gradient dithering without softening real edges. */
export function denoise(imgd: ImageData, radius: number, delta: number): void {
  const { width: w, height: h, data: d } = imgd;
  const out = new Uint8ClampedArray(d.length);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      const r0 = d[i], g0 = d[i + 1], b0 = d[i + 2];
      let r = 0, g = 0, b = 0, n = 0;
      for (let dy = -radius; dy <= radius; dy++) {
        const yy = y + dy; if (yy < 0 || yy >= h) continue;
        for (let dx = -radius; dx <= radius; dx++) {
          const xx = x + dx; if (xx < 0 || xx >= w) continue;
          const j = (yy * w + xx) * 4;
          if (Math.abs(d[j] - r0) + Math.abs(d[j + 1] - g0) + Math.abs(d[j + 2] - b0) <= delta) { r += d[j]; g += d[j + 1]; b += d[j + 2]; n++; }
        }
      }
      out[i] = r / n; out[i + 1] = g / n; out[i + 2] = b / n; out[i + 3] = d[i + 3];
    }
  }
  d.set(out);
}

/* Soft-boundary smoothing: boundaries between SIMILAR colors (light skin vs shadowed skin, two
   greys in a fold) are smoothed over a wide radius, so shading becomes a few large shapes with
   long sweeping edges instead of many ragged pieces. A pixel may only switch to a color close to
   its own, so high-contrast outlines and lines are never moved. */
export function smoothSoft(idx: Uint8Array, w: number, h: number, pal: RGB[], R: number, thr: number, passes = 3): void {
  if (R < 1) return;
  const K = pal.length, near = new Uint8Array(K * K);
  const lu = pal.map(c => 0.299 * c[0] + 0.587 * c[1] + 0.114 * c[2]);
  for (let a = 0; a < K; a++) for (let b = 0; b < K; b++) {
    const dd = cdist(pal[a][0], pal[a][1], pal[a][2], pal[b][0], pal[b][1], pal[b][2]);
    // dark colors look alike in RGB distance but are different inks (black outline vs dark red),
    // so between dark colors only near-identical shades count as "similar"
    near[a * K + b] = dd < (Math.min(lu[a], lu[b]) < 80 ? thr * cfg("darkNear", 0.12) : thr) ? 1 : 0;
  }
  const st = Math.max(1, Math.round(R / 4)), offs: number[] = [], wts: number[] = [];
  const sg = R / 2;
  for (let dy = -R; dy <= R; dy += st) for (let dx = -R; dx <= R; dx += st) {
    const d2 = dx * dx + dy * dy; if (d2 > R * R) continue;
    offs.push(dy * w + dx); wts.push(Math.exp(-d2 / (2 * sg * sg)));
  }
  const O = Int32Array.from(offs), Wt = Float32Array.from(wts), M = O.length;
  const acc = new Float32Array(256), seen = new Uint8Array(256), touched = new Uint8Array(256);
  for (let pass = 0; pass < passes; pass++) {
    const src = idx.slice(); let changed = 0;
    for (let y = R; y < h - R; y++) {
      let p = y * w + R;
      for (let x = R; x < w - R; x++, p++) {
        const v = src[p]; if (v === 255) continue;
        if (src[p - 1] === v && src[p + 1] === v && src[p - w] === v && src[p + w] === v) continue;
        let nt = 0, tot = 0;
        for (let m = 0; m < M; m++) {
          const u = src[p + O[m]]; if (u === 255 || (u !== v && !near[v * K + u])) continue;
          if (!seen[u]) { seen[u] = 1; touched[nt++] = u; }
          acc[u] += Wt[m]; tot += Wt[m];
        }
        let best = v, bw = acc[v];
        for (let t = 0; t < nt; t++) { const u = touched[t]; if (acc[u] > bw) { bw = acc[u]; best = u; } }
        if (best !== v && bw > acc[v] * 1.15) { idx[p] = best; changed++; }
        for (let t = 0; t < nt; t++) { const u = touched[t]; acc[u] = 0; seen[u] = 0; }
      }
    }
    if (!changed) break;
  }
}

/* Edge smoothing: every pixel on a color boundary takes a Gaussian-weighted vote of the
   labels around it. Staircase steps and 1-px wobbles flip to the surrounding shape, so the
   boundary the tracer sees is already a smooth curve. A pixel only changes when its own
   label is clearly in the minority, which keeps thin outlines and sharp corners intact. */
export function smoothLabels(idx: Uint8Array, w: number, h: number, sigma: number, passes = 2, keep: Uint8Array | null = null): void {
  if (sigma <= 0) return;
  const r = Math.max(1, Math.ceil(sigma * 2));
  const offs: number[] = [], wts: number[] = []; let tot = 0;
  for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) {
    const d2 = dx * dx + dy * dy; if (d2 > r * r) continue;
    const wt = Math.exp(-d2 / (2 * sigma * sigma));
    offs.push(dy * w + dx); wts.push(wt); tot += wt;
  }
  const O = Int32Array.from(offs), Wt = Float32Array.from(wts.map(v => v / tot)), M = O.length;
  const acc = new Float32Array(256), seen = new Uint8Array(256), touched = new Uint8Array(256);
  for (let pass = 0; pass < passes; pass++) {
    const src = idx.slice();
    let changed = 0;
    for (let y = r; y < h - r; y++) {
      let p = y * w + r;
      for (let x = r; x < w - r; x++, p++) {
        const v = src[p];
        if (src[p - 1] === v && src[p + 1] === v && src[p - w] === v && src[p + w] === v) continue;
        if (keep && keep[v]) continue;
        let nt = 0;
        for (let m = 0; m < M; m++) {
          const q = src[p + O[m]];
          if (!seen[q]) { seen[q] = 1; touched[nt++] = q; }
          acc[q] += Wt[m];
        }
        let best = v, bw = acc[v];
        for (let t = 0; t < nt; t++) { const q = touched[t]; if (acc[q] > bw) { bw = acc[q]; best = q; } }
        if (best !== v && acc[v] < 0.38 && bw > 0.45) { idx[p] = best; changed++; }
        for (let t = 0; t < nt; t++) { const q = touched[t]; acc[q] = 0; seen[q] = 0; }
      }
    }
    if (!changed) break;
  }
}

/* Line consolidation: thin dark strokes (fold lines, eyelids, hair strands) fade toward their
   tips and get split into several dark-ish shades, so they trace as dashes. Any pixel that is a
   dark ridge (clearly darker than the pixels on both sides of it, across the stroke) and sits near
   a dark line color is given that line color, which rejoins the stroke into one tapered shape. */
export function consolidateLines(idx: Uint8Array, w: number, h: number, d: Uint8ClampedArray, pal: RGB[], scale: number): number {
  const N = w * h, L = new Float32Array(N);
  for (let p = 0; p < N; p++) { const i = p * 4; L[p] = 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2]; }
  const lumP = pal.map(c => 0.299 * c[0] + 0.587 * c[1] + 0.114 * c[2]);
  const lineK = new Uint8Array(256); pal.forEach((_c, k) => { if (lumP[k] < cfg("lineLum", 70)) lineK[k] = 1; });
  const r = Math.max(2, Math.round(scale * cfg("ridgeR", 1.5))), T = cfg("ridgeT", 22), R = Math.max(2, Math.round(scale * 2.5));
  const dirs = ([[1, 0], [0, 1], [1, 1], [1, -1]] as const).map(([dx, dy]) => dy * w * r + dx * r);
  const out = idx.slice(); let n = 0;
  const nearInk = new Uint8Array(256);
  for (let y = Math.max(r, R); y < h - Math.max(r, R); y++) for (let x = Math.max(r, R); x < w - Math.max(r, R); x++) {
    const p = y * w + x, v = idx[p]; if (v === 255) continue;
    const l = L[p]; let dirO = 0;
    for (const o of dirs) { const m = Math.min(L[p - o], L[p + o]); if (l + Math.min(T, Math.max(7, m * 0.35)) < m) { dirO = o; break; } }
    if (!dirO) continue;
    // which line color is this pixel a blend of? the background is what lies on both sides of the
    // stroke; the right line color is the one the pixel sits on the straight path toward
    const i = p * 4, ia = (p - dirO) * 4, ib = (p + dirO) * 4;
    const bx = (d[ia] + d[ib]) / 2, by = (d[ia + 1] + d[ib + 1]) / 2, bz = (d[ia + 2] + d[ib + 2]) / 2;
    const ux = d[i] - bx, uy = d[i + 1] - by, uz = d[i + 2] - bz;
    // which ink colors are already present right around this pixel
    nearInk.fill(0);
    for (let dy = -R; dy <= R; dy += Math.max(1, R >> 1)) for (let dx = -R; dx <= R; dx += Math.max(1, R >> 1)) { const q = idx[p + dy * w + dx]; if (q !== 255 && lineK[q]) nearInk[q] = 1; }
    let best = -1, be = cfg("lineErr", 1800);
    for (let k = 0; k < pal.length; k++) {
      if (!lineK[k]) continue;
      const vx = pal[k][0] - bx, vy = pal[k][1] - by, vz = pal[k][2] - bz, vv = vx * vx + vy * vy + vz * vz;
      if (vv < 400) continue;
      const t = (ux * vx + uy * vy + uz * vz) / vv; if (t < cfg("lineTlo", 0.25) || t > 1.4) continue;
      if (t < cfg("lineT", 0.5) && !nearInk[k]) continue;   // faint: only extends an existing stroke
      const ex = ux - t * vx, ey = uy - t * vy, ez = uz - t * vz, e = ex * ex + ey * ey + ez * ez;
      const ee = nearInk[k] ? e : e * cfg("farPen", 4) + 600;   // an ink already next to the pixel wins
      if (ee < be) { be = ee; best = k; }
    }
    if (best >= 0 && best !== v) { out[p] = best; n++; }
  }
  idx.set(out);
  return n;
}

/* Halo removal: anti-aliasing and JPEG blur leave a thin band of an in-between color along
   every edge (tan between skin and black, dark red between red and black...). A region that is
   thin and whose color is a blend of the two colors on either side of it isn't a real shape:
   each of its pixels joins whichever side it is closer to, so the edge becomes one crisp line. */
export function dehalo(idx: Uint8Array, w: number, h: number, d: Uint8ClampedArray, pal: RGB[], scale: number): number {
  const N = w * h, comp = new Int32Array(N).fill(-1), buf = new Int32Array(N);
  const maxW = cfg("haloW", 4) * Math.max(1, scale);
  let total = 0;
  for (let round = 0; round < 4; round++) {
    comp.fill(-1);
    let nc = 0, changed = 0;
    const nbCount = new Int32Array(256);
    for (let s0 = 0; s0 < N; s0++) {
      if (comp[s0] >= 0) continue;
      const v = idx[s0];
      let n = 0; buf[n++] = s0; comp[s0] = nc;
      let edges = 0;
      const touched: number[] = [];
      for (let hd = 0; hd < n; hd++) {
        const p = buf[hd], x = p % w;
        const nb = [x > 0 ? p - 1 : -1, x < w - 1 ? p + 1 : -1, p >= w ? p - w : -1, p < N - w ? p + w : -1];
        for (const q of nb) {
          if (q < 0) continue;
          const u = idx[q];
          if (u === v) { if (comp[q] < 0) { comp[q] = nc; buf[n++] = q; } }
          else { edges++; if (u !== 255) { if (!nbCount[u]) touched.push(u); nbCount[u]++; } }
        }
      }
      nc++;
      let ok = v !== 255 && edges > 0 && (2 * n / edges) < maxW && touched.length >= 2;
      let A = -1, B = -1;
      if (ok) {
        touched.sort((a, b) => nbCount[b] - nbCount[a]);
        const C = pal[v], cand = touched.slice(0, 4);
        let best = Infinity;
        for (let i = 0; i < cand.length; i++) for (let j = i + 1; j < cand.length; j++) {
          const a = cand[i], b = cand[j];
          if (nbCount[a] + nbCount[b] < edges * 0.6 || nbCount[b] < edges * cfg("bshare", 0.12)) continue;
          const P = pal[a], Q = pal[b];
          const vx = Q[0] - P[0], vy = Q[1] - P[1], vz = Q[2] - P[2], vv = vx * vx + vy * vy + vz * vz;
          if (!vv) continue;
          const ux = C[0] - P[0], uy = C[1] - P[1], uz = C[2] - P[2];
          const t = (ux * vx + uy * vy + uz * vz) / vv;
          if (t < 0.08 || t > 0.92) continue;
          const ex = ux - t * vx, ey = uy - t * vy, ez = uz - t * vz, e2 = ex * ex + ey * ey + ez * ez;
          if (e2 > 0.06 * vv + 400) continue;
          if (e2 < best) { best = e2; A = a; B = b; }
        }
        ok = A >= 0;
      }
      for (const u of touched) nbCount[u] = 0;
      if (!ok) continue;
      const PA = pal[A], PB = pal[B];
      for (let t = 0; t < n; t++) {
        const p = buf[t], i = p * 4;
        idx[p] = cdist(d[i], d[i + 1], d[i + 2], PA[0], PA[1], PA[2]) <= cdist(d[i], d[i + 1], d[i + 2], PB[0], PB[1], PB[2]) ? A : B;
      }
      changed++;
    }
    total += changed;
    if (!changed) break;
  }
  return total;
}
