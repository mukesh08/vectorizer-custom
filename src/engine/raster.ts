/* Label-map operations the tracers share: speck cleanup, marching-squares contours and the
   separable blur that turns a hard mask into a field with a sub-pixel 0.5 iso-contour. */
import { cdist, lum } from "./color";
import { cfg } from "./config";
import type { Pt, RGB } from "./types";

/** Merges regions smaller than `minArea` into the neighbour closest in color, in place.
    `blobArea` also absorbs compact chips up to that size; `lineSc` scales the "is it a
    stroke?" tests with the trace resolution. */
export function removeSpecks(idx: Uint8Array, w: number, h: number, minArea: number, pal: RGB[] | null, blobArea = 0, lineSc = 1): void {
  const inkK = pal ? new Uint8Array(256) : null;
  if (pal && inkK) pal.forEach((c, k) => { if (lum(c) < cfg("inkLum", 45)) inkK[k] = 1; });
  if (minArea < 2) return;
  const N = w * h, seen = new Uint8Array(N), buf = new Int32Array(N), tally = new Int32Array(256);
  for (let s0 = 0; s0 < N; s0++) {
    if (seen[s0]) continue;
    const v = idx[s0]; let n = 0; buf[n++] = s0; seen[s0] = 1;
    for (let hd = 0; hd < n; hd++) {
      const p = buf[hd], x = p % w;
      if (x > 0 && !seen[p - 1] && idx[p - 1] === v) { seen[p - 1] = 1; buf[n++] = p - 1; }
      if (x < w - 1 && !seen[p + 1] && idx[p + 1] === v) { seen[p + 1] = 1; buf[n++] = p + 1; }
      if (p >= w && !seen[p - w] && idx[p - w] === v) { seen[p - w] = 1; buf[n++] = p - w; }
      if (p < N - w && !seen[p + w] && idx[p + w] === v) { seen[p + w] = 1; buf[n++] = p + w; }
    }
    if (v === 255) continue;
    // thin pieces of dark ink (parts of lines) are never chips: keep them unless truly dust
    if (blobArea && inkK && inkK[v] && n >= 3 * lineSc * lineSc) {
      let x0 = w, x1 = 0, y0 = h, y1 = 0;
      for (let t = 0; t < n; t++) { const p = buf[t], x = p % w, y = (p / w) | 0; if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
      const L = Math.hypot(x1 - x0 + 1, y1 - y0 + 1);
      if (n / L < 3 * lineSc && L > 4 * lineSc) continue;
    }
    if (n >= minArea) {
      // compact blobs (chips of shading) up to blobArea also merge; long thin shapes (lines) stay
      if (!blobArea || n >= blobArea) continue;
      let x0 = w, x1 = 0, y0 = h, y1 = 0;
      for (let t = 0; t < n; t++) { const p = buf[t], x = p % w, y = (p / w) | 0; if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
      const L = Math.hypot(x1 - x0 + 1, y1 - y0 + 1);
      if (L * L / n > cfg("elong", 7) || n / L < 2.2 * lineSc) continue;   // a stroke, keep it
    }
    tally.fill(0); let best = -1, bc = 0;
    for (let t = 0; t < n; t++) {
      const p = buf[t], x = p % w;
      const nb = [x > 0 ? p - 1 : -1, x < w - 1 ? p + 1 : -1, p - w, p + w];
      for (const q of nb) {
        if (q < 0 || q >= N) continue;
        const u = idx[q]; if (u === v || u === 255) continue;
        if (pal) { tally[u] = 1; continue; }
        if (++tally[u] > bc) { bc = tally[u]; best = u; }
      }
    }
    // a speck joins the neighbour closest in colour (so a broken-off piece of a dark line
    // rejoins the line instead of vanishing into the background)
    if (pal) { let bd = Infinity; const c = pal[v]; for (let u = 0; u < 256; u++) if (tally[u]) { const p2 = pal[u]; const dd = cdist(c[0], c[1], c[2], p2[0], p2[1], p2[2]); if (dd < bd) { bd = dd; best = u; } } }
    if (best >= 0) for (let t = 0; t < n; t++) idx[buf[t]] = best;
  }
}

/** The 0.5 iso-contours of field `F` on a GW×GH grid, as closed point loops. */
export function marchingSquares(F: Float32Array, GW: number, GH: number): Pt[][] {
  const ids = new Map<number, number>(), X: number[] = [], Y: number[] = [], A: number[] = [], B: number[] = [];
  const node = (eid: number, x: number, y: number): number => {
    let n = ids.get(eid);
    if (n === undefined) { n = X.length; ids.set(eid, n); X.push(x); Y.push(y); A.push(-1); B.push(-1); }
    return n;
  };
  const link = (a: number, b: number): void => { if (A[a] < 0) A[a] = b; else B[a] = b; if (A[b] < 0) A[b] = a; else B[b] = a; };
  const T = 0.5;
  for (let j = 0; j < GH - 1; j++) {
    for (let i = 0; i < GW - 1; i++) {
      const p = j * GW + i, tl = F[p], tr = F[p + 1], bl = F[p + GW], br = F[p + GW + 1];
      const c = (tl >= T ? 8 : 0) | (tr >= T ? 4 : 0) | (br >= T ? 2 : 0) | (bl >= T ? 1 : 0);
      if (c === 0 || c === 15) continue;
      const eT = () => node(p * 2, i + (T - tl) / (tr - tl), j);
      const eB = () => node((p + GW) * 2, i + (T - bl) / (br - bl), j + 1);
      const eL = () => node(p * 2 + 1, i, j + (T - tl) / (bl - tl));
      const eR = () => node((p + 1) * 2 + 1, i + 1, j + (T - tr) / (br - tr));
      const ctr = (tl + tr + bl + br) / 4 >= T;
      switch (c) {
        case 1: case 14: link(eL(), eB()); break;
        case 2: case 13: link(eB(), eR()); break;
        case 3: case 12: link(eL(), eR()); break;
        case 4: case 11: link(eT(), eR()); break;
        case 6: case 9: link(eT(), eB()); break;
        case 7: case 8: link(eT(), eL()); break;
        case 5: if (ctr) { link(eT(), eL()); link(eR(), eB()); } else { link(eT(), eR()); link(eL(), eB()); } break;
        case 10: if (ctr) { link(eT(), eR()); link(eL(), eB()); } else { link(eT(), eL()); link(eR(), eB()); } break;
      }
    }
  }
  const seen = new Uint8Array(X.length), loops: Pt[][] = [];
  for (let s = 0; s < X.length; s++) {
    if (seen[s]) continue;
    const pts: Pt[] = []; let prev = -1, cur = s;
    for (;;) {
      seen[cur] = 1; pts.push([X[cur], Y[cur]]);
      const nx = A[cur] !== prev ? A[cur] : B[cur];
      if (nx < 0 || nx === s || seen[nx]) break;
      prev = cur; cur = nx;
    }
    if (pts.length >= 3) loops.push(pts);
  }
  return loops;
}

/* Separable Gaussian along one axis, computed only where the window actually spans an edge:
   away from edges the field is exactly 0 or 1 and passes through unchanged. */
export function blur1D(S: Float32Array, D: Float32Array, len: number, lines: number, step: number, lineStep: number, K: Float32Array, R: number): void {
  const nxt = new Int32Array(len + 1);
  for (let l = 0; l < lines; l++) {
    const b = l * lineStep;
    nxt[len] = 1e9;
    for (let i = len - 1; i >= 0; i--) nxt[i] = (i > 0 && S[b + i * step] !== S[b + (i - 1) * step]) ? i : nxt[i + 1];
    let lc = -1e9;
    for (let i = 0; i < len; i++) {
      if (i > 0 && S[b + i * step] !== S[b + (i - 1) * step]) lc = i;
      const p = b + i * step;
      if (lc <= i - R && nxt[Math.min(len, i + 1)] > i + R) { D[p] = S[p]; continue; }
      let s = 0;
      const lo = Math.max(-R, -i), hi = Math.min(R, len - 1 - i);
      for (let t = lo; t <= hi; t++) s += S[p + t * step] * K[t + R];
      D[p] = s;
    }
  }
}
