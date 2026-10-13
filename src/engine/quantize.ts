/* Clean palette: build the palette only from pixels inside flat regions (not from the
   blended pixels along edges), merge near-duplicate colors, then snap every pixel to it
   and clear 1-px slivers. This removes the thin "halo" outlines that anti-aliasing and
   JPEG compression otherwise turn into extra shapes. */
import { cdist, lum, yieldUI } from "./color";
import { cfg, flag } from "./config";
import { consolidateLines, dehalo, smoothLabels, smoothSoft } from "./preprocess";
import type { AliveFn, RGB, StageFn } from "./types";

export interface QuantizeOpts {
  /** How far the image was upscaled before tracing; widens every neighbourhood test. */
  scale?: number;
  /** Edge smoothing strength (the UI slider, 0–3). */
  smooth?: number;
  /** The "original pixels only" engine keeps thin ink lines, so it smooths more gently. */
  native?: boolean;
  stage?: StageFn;
  alive?: AliveFn;
}

/** The palette plus the label map (one palette index per pixel, 255 = transparent). */
export interface Quantized {
  pal: RGB[];
  idx: Uint8Array;
}

/** Snaps `imgd` to a palette of at most `maxColors` colors, in place. Null if cancelled. */
export async function quantize(imgd: ImageData, maxColors: number, opt?: QuantizeOpts): Promise<Quantized | null> {
  const { width: w, height: h, data: d } = imgd;
  const { scale = 1, smooth = 0, native = false, stage = () => {}, alive = () => true } = opt || {};
  const N = w * h;
  // "Stable" = flat across the width of an original pixel. After upscaling, an anti-aliased
  // edge is a gentle ramp, so neighbours are compared at a distance that grows with the scale.
  const sd = Math.max(1, Math.round(scale));
  const NB = [-4 * sd, 4 * sd, -w * 4 * sd, w * 4 * sd];
  // 1. sample stable pixels
  const S: number[] = [], step = Math.max(1, Math.floor(N / cfg("samples", 80000)));
  for (let p = 0; p < N; p += step) {
    const x = p % w, y = (p / w) | 0, i = p * 4;
    if (d[i + 3] < 128 || x < sd || y < sd || x >= w - sd || y >= h - sd) continue;
    let flat = true;
    for (const o of NB) {
      if (Math.abs(d[i] - d[i + o]) + Math.abs(d[i + 1] - d[i + o + 1]) + Math.abs(d[i + 2] - d[i + o + 2]) > 30) { flat = false; break; }
    }
    if (flat) S.push(d[i], d[i + 1], d[i + 2]);
  }
  if (S.length < 30) for (let p = 0; p < N; p += step) { const i = p * 4; if (d[i + 3] >= 128) S.push(d[i], d[i + 1], d[i + 2]); }
  const n = S.length / 3;
  if (!n) return null;
  // 2. farthest-point seeding + k-means
  const K0 = Math.min(maxColors, n);
  let C: RGB[] = [[S[0], S[1], S[2]]];
  const near = new Float64Array(n).fill(Infinity);
  while (C.length < K0) {
    const c = C[C.length - 1]; let fi = 0, fd = -1;
    for (let j = 0; j < n; j++) {
      const dd = cdist(S[j * 3], S[j * 3 + 1], S[j * 3 + 2], c[0], c[1], c[2]);
      if (dd < near[j]) near[j] = dd;
      if (near[j] > fd) { fd = near[j]; fi = j; }
    }
    if (fd < cfg("seedStop", 400)) break;                       // remaining colors are near-duplicates
    C.push([S[fi * 3], S[fi * 3 + 1], S[fi * 3 + 2]]);
  }
  let count: number[] = [];
  for (let it = 0; it < 10; it++) {
    const acc = C.map(() => [0, 0, 0, 0]);
    for (let j = 0; j < n; j++) {
      const r = S[j * 3], g = S[j * 3 + 1], b = S[j * 3 + 2];
      let bi = 0, bd = Infinity;
      for (let k = 0; k < C.length; k++) { const dd = cdist(r, g, b, C[k][0], C[k][1], C[k][2]); if (dd < bd) { bd = dd; bi = k; } }
      const a = acc[bi]; a[0] += r; a[1] += g; a[2] += b; a[3]++;
    }
    C = C.map((c, k) => acc[k][3] ? [acc[k][0] / acc[k][3], acc[k][1] / acc[k][3], acc[k][2] / acc[k][3]] : c);
    count = acc.map(a => a[3]);
  }
  // 3. drop tiny clusters, merge near-duplicates
  const P = C.map((c, k) => ({ c, n: count[k] })).filter(o => o.n > n * cfg("minFrac", 0.0005)).sort((a, b) => b.n - a.n);
  const merged: { c: RGB; n: number }[] = [];
  for (const o of P) {
    // dark shades are hard to tell apart (and JPEG noise lives there), so they merge more readily
    const m = merged.find(q => cdist(q.c[0], q.c[1], q.c[2], o.c[0], o.c[1], o.c[2]) * Math.min(1, ((Math.max(lum(q.c), lum(o.c)) + 20) / 130) ** cfg("dpow", 1)) < cfg("merge", 700));
    if (m) { const t = m.n + o.n; m.c = m.c.map((v, i) => (v * m.n + o.c[i] * o.n) / t); m.n = t; } else merged.push({ c: o.c.slice(), n: o.n });
  }
  const pal: RGB[] = merged.map(o => o.c.map(Math.round));
  stage("Snapping edges to the palette…"); await yieldUI(); if (!alive()) return null;
  // 4. map pixels (cached by 5-bit key)
  const idx = new Uint8Array(N), cache = new Int16Array(32768).fill(-1);
  for (let p = 0; p < N; p++) {
    const i = p * 4;
    if (d[i + 3] < 128) { idx[p] = 255; continue; }
    const key = (d[i] >> 3) << 10 | (d[i + 1] >> 3) << 5 | (d[i + 2] >> 3);
    let bi = cache[key];
    if (bi < 0) {
      let bd = Infinity; const r = d[i], g = d[i + 1], b = d[i + 2];
      for (let k = 0; k < pal.length; k++) { const dd = cdist(r, g, b, pal[k][0], pal[k][1], pal[k][2]); if (dd < bd) { bd = dd; bi = k; } }
      cache[key] = bi;
    }
    idx[p] = bi;
  }
  // 5. edge pixels join one of the flat regions next to them (never a third, in-between color).
  //    After upscaling, an anti-aliased edge is several pixels wide, so the search radius grows
  //    with the scale. The boundary then lands on the sub-pixel midpoint of the original edge.
  const stable = new Uint8Array(N);
  for (let y = sd; y < h - sd; y++) for (let x = sd; x < w - sd; x++) {
    const p = y * w + x, i = p * 4; let mx = 0;
    for (const o of NB) { const dd = Math.abs(d[i] - d[i + o]) + Math.abs(d[i + 1] - d[i + o + 1]) + Math.abs(d[i + 2] - d[i + o + 2]); if (dd > mx) mx = dd; }
    stable[p] = mx <= 30 ? 1 : 0;
  }
  // search far enough to reach flat color on both sides of a wide (upscaled) edge ramp,
  // sampling sparsely so the cost stays flat as the scale grows
  const R = 2 * sd + 2, RS = Math.max(1, sd >> 1), snap = idx.slice();
  const SO: number[] = [];
  for (let dy = -R; dy <= R; dy += RS) for (let dx = -R; dx <= R; dx += RS) SO.push(dy * w + dx);
  for (let y = R; y < h - R; y++) for (let x = R; x < w - R; x++) {
    const p = y * w + x; if (stable[p] || idx[p] === 255) continue;
    const i = p * 4, r = d[i], g = d[i + 1], b = d[i + 2];
    let bi = -1, bd = Infinity;
    for (let m = 0; m < SO.length; m++) {
      const q = p + SO[m]; if (!stable[q]) continue;
      const k = idx[q]; if (k === 255) continue;
      const dd = cdist(r, g, b, pal[k][0], pal[k][1], pal[k][2]); if (dd < bd) { bd = dd; bi = k; }
    }
    // keep thin lines: a hairline has no flat interior, so if this pixel is far closer to some
    // palette color than to any flat neighbour, it belongs to a line, not to an edge ramp
    if (bi >= 0) {
      const k0 = idx[p];
      let line = false;
      if (k0 !== bi) {
        const B = pal[bi], L = pal[k0];
        const vx = L[0] - B[0], vy = L[1] - B[1], vz = L[2] - B[2];
        const ux = r - B[0], uy = g - B[1], uz = b - B[2];
        const vv = vx * vx + vy * vy + vz * vz;
        const t = vv ? (ux * vx + uy * vy + uz * vz) / vv : 0;
        if (t > 0.3) {
          const ex = ux - t * vx, ey = uy - t * vy, ez = uz - t * vz;
          // pixel must be a blend of background and line color, and nearer the line color than the background suggests
          line = ex * ex + ey * ey + ez * ez < 2500 && cdist(r, g, b, L[0], L[1], L[2]) * 2 < bd;
        }
      }
      if (!line) snap[p] = bi;
    }
  }
  if (!flag("noSnap")) idx.set(snap);
  // 6. clear slivers: a pixel shared by <=3 of its 3x3 neighbourhood takes the majority color
  for (let pass = 0; pass < 2; pass++) {
    const src = idx.slice();
    const tally = new Uint8Array(256);
    for (let y = 1; y < h - 1; y++) for (let x = 1; x < w - 1; x++) {
      const p = y * w + x, v = src[p];
      let same = 0;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) if (src[p + dy * w + dx] === v) same++;
      if (same > 3) continue;
      tally.fill(0); let best = v, bc = 0;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) { const q = src[p + dy * w + dx]; if (++tally[q] > bc) { bc = tally[q]; best = q; } }
      idx[p] = best;
    }
  }
  // 6b. dissolve anti-aliasing halos into the colors on either side
  stage("Removing edge halos…"); await yieldUI(); if (!alive()) return null;
  if (!flag("noDehalo")) dehalo(idx, w, h, d, pal, scale);
  if (!flag("noLines")) { stage("Rejoining thin lines…"); await yieldUI(); if (!alive()) return null; consolidateLines(idx, w, h, d, pal, scale); }
  // 7. smooth boundaries so curves come out clean instead of stair-stepped
  if (smooth > 0) {
    stage("Smoothing edges…"); await yieldUI(); if (!alive()) return null;
    if (native) {
      // native pixels: smooth ragged edges, but never erase pixels of dark ink colors (thin lines)
      const keep = new Uint8Array(256); pal.forEach((c, k) => { if (lum(c) < cfg("inkLum", 45)) keep[k] = 1; });
      if (!flag("noLabelSmooth")) smoothLabels(idx, w, h, cfg("pls", 0.6) * smooth, 3, keep);
    } else if (!flag("noLabelSmooth")) smoothLabels(idx, w, h, cfg("ls", 0.55) * smooth * Math.max(1, scale), 3);
    if (!flag("noSoft")) {
      stage("Smoothing shading edges…"); await yieldUI(); if (!alive()) return null;
      smoothSoft(idx, w, h, pal, Math.round(cfg("softR", 2.5) * (smooth / 1.5) * Math.max(1, scale)), cfg("softT", 20000), cfg("softP", 3));
      // a second, wider pass only between near-identical tones: removes blotches in flat skin/cloth
      if (cfg("soft2R", 6) !== 0) smoothSoft(idx, w, h, pal, Math.round(cfg("soft2R", 6) * (smooth / 1.5) * Math.max(1, scale)), cfg("soft2T", 6000), 2);
    }
  }
  // 8. exact colors: k-means gives the AVERAGE of everything in a cluster, which drifts toward
  //    neighbouring shades. Instead give each palette entry the color its shapes actually are:
  //    the most common color among flat pixels deep inside those shapes.
  if (!flag("noExact")) {
    stage("Picking exact colors…"); await yieldUI(); if (!alive()) return null;
    const K = pal.length, r = Math.max(2, Math.round(scale * 1.5));
    const hist = new Uint32Array(K * 32768), any = new Uint32Array(K), sum = new Float64Array(K * 3);
    const interior = (p: number): boolean => {
      const v = idx[p];
      return idx[p - r] === v && idx[p + r] === v && idx[p - r * w] === v && idx[p + r * w] === v &&
             idx[p - r - r * w] === v && idx[p + r + r * w] === v && idx[p + r - r * w] === v && idx[p - r + r * w] === v;
    };
    // solid masses count more than thin lines that share their palette entry: a pixel deep inside
    // a shape (e.g. the middle of a head of navy hair) outweighs one inside a thin black outline
    const r2 = Math.max(r + 1, Math.round(scale * cfg("deepR", 4)));
    const deep = (p: number): boolean => { const v = idx[p]; return idx[p - r2] === v && idx[p + r2] === v && idx[p - r2 * w] === v && idx[p + r2 * w] === v; };
    for (let y = r2; y < h - r2; y++) for (let x = r2; x < w - r2; x++) {
      const p = y * w + x, k = idx[p]; if (k === 255 || !stable[p] || !interior(p)) continue;
      const i = p * 4, wgt = deep(p) ? cfg("deepW", 6) : 1;
      hist[k * 32768 + ((d[i] >> 3) << 10 | (d[i + 1] >> 3) << 5 | (d[i + 2] >> 3))] += wgt; any[k]++;
    }
    const bestBin = new Int32Array(K).fill(-1);
    for (let k = 0; k < K; k++) {
      if (any[k] < 8) continue;
      let bb = 0, bc = 0; const o = k * 32768;
      for (let b = 0; b < 32768; b++) if (hist[o + b] > bc) { bc = hist[o + b]; bb = b; }
      bestBin[k] = bb;
    }
    const cntB = new Uint32Array(K);
    for (let y = r; y < h - r; y++) for (let x = r; x < w - r; x++) {
      const p = y * w + x, k = idx[p]; if (k === 255 || bestBin[k] < 0 || !stable[p]) continue;
      const i = p * 4, b = (d[i] >> 3) << 10 | (d[i + 1] >> 3) << 5 | (d[i + 2] >> 3);
      if (b !== bestBin[k] || !interior(p)) continue;
      sum[k * 3] += d[i]; sum[k * 3 + 1] += d[i + 1]; sum[k * 3 + 2] += d[i + 2]; cntB[k]++;
    }
    for (let k = 0; k < K; k++) if (cntB[k]) pal[k] = [0, 1, 2].map(c => Math.round(sum[k * 3 + c] / cntB[k]));
    // refine: weighted per-channel median of the pixels near that dominant tone, with solid
    // masses weighted up, so a big area's true color wins over a thin line sharing the entry
    {
      const ch = new Float64Array(K * 768), tw = new Float64Array(K), T2 = cfg("medT", 2500);
      for (let y = r2; y < h - r2; y++) for (let x = r2; x < w - r2; x++) {
        const p = y * w + x, k = idx[p]; if (k === 255 || !cntB[k] || !stable[p] || !interior(p)) continue;
        const i = p * 4, c = pal[k];
        if (cdist(d[i], d[i + 1], d[i + 2], c[0], c[1], c[2]) > T2) continue;
        const wgt = deep(p) ? cfg("deepW", 6) : 1, o = k * 768;
        ch[o + d[i]] += wgt; ch[o + 256 + d[i + 1]] += wgt; ch[o + 512 + d[i + 2]] += wgt; tw[k] += wgt;
      }
      for (let k = 0; k < K; k++) {
        if (tw[k] < 50) continue;
        pal[k] = [0, 1, 2].map(c => { let a = 0; const o = k * 768 + c * 256; for (let v = 0; v < 256; v++) { a += ch[o + v]; if (a >= tw[k] / 2) return v; } return 255; });
      }
    }
    // one palette entry can still cover shapes of clearly different colors (dark shades merge
    // readily so thin lines stay whole, e.g. navy-black outlines and brown-black hair lines).
    // Give each connected shape the color of its own interior, and split an entry wherever its
    // shapes disagree, so every shape keeps its true color while lines stay one piece.
    stage("Matching each shape's color…"); await yieldUI(); if (!alive()) return null;
    const comp = new Int32Array(N).fill(-1), q = new Int32Array(N);
    const cK: number[] = [], cA: number[] = [], cS: (RGB | null)[] = [], cN: number[] = [];
    let nc = 0;
    for (let s0 = 0; s0 < N; s0++) {
      if (comp[s0] >= 0 || idx[s0] === 255) continue;
      const v = idx[s0]; let n2 = 0; q[n2++] = s0; comp[s0] = nc;
      let sr = 0, sg = 0, sb = 0, si = 0;
      for (let hd = 0; hd < n2; hd++) {
        const p = q[hd], x = p % w, i = p * 4;
        const y = (p / w) | 0;
        if (stable[p] && x >= r && y >= r && x < w - r && y < h - r && interior(p)) { sr += d[i]; sg += d[i + 1]; sb += d[i + 2]; si++; }
        if (x > 0 && comp[p - 1] < 0 && idx[p - 1] === v) { comp[p - 1] = nc; q[n2++] = p - 1; }
        if (x < w - 1 && comp[p + 1] < 0 && idx[p + 1] === v) { comp[p + 1] = nc; q[n2++] = p + 1; }
        if (p >= w && comp[p - w] < 0 && idx[p - w] === v) { comp[p - w] = nc; q[n2++] = p - w; }
        if (p < N - w && comp[p + w] < 0 && idx[p + w] === v) { comp[p + w] = nc; q[n2++] = p + w; }
      }
      cK.push(v); cA.push(n2);
      cS.push(si >= 6 ? [sr / si, sg / si, sb / si] : null); cN.push(si);
      nc++;
    }
    const T = cfg("splitT", 700), maxPal = Math.min(250, Math.max(maxColors, pal.length) + cfg("extra", 32));
    type Group = { c: RGB; w: number; k: number };
    const clusters: Group[][] = pal.map(c => [{ c: c.slice(), w: 0, k: -1 }]);    // per entry; first keeps its index
    const order = [...Array(nc).keys()].filter(i => cS[i]).sort((a, b) => cN[b] - cN[a]);
    const assign = new Int32Array(nc).fill(-1);
    for (const i of order) {
      const k = cK[i], cl = clusters[k], c = cS[i]!;
      let best: Group | null = null, bd = Infinity;
      for (const g of cl) { const dd = cdist(c[0], c[1], c[2], g.c[0], g.c[1], g.c[2]); if (dd < bd) { bd = dd; best = g; } }
      if (bd > T && cN[i] >= 40 * r * r && pal.length < maxPal) {
        best = { c: c.slice(), w: 0, k: pal.length }; pal.push(c.map(Math.round)); cl.push(best);
      }
      if (!best) continue;
      if (best.k < 0) best.k = k;
      // exact color of a group = weighted mean of its shapes' interiors
      const wt = cN[i]; best.c = best.c.map((v, j) => (v * best.w + c[j] * wt) / (best.w + wt)); best.w += wt;
      assign[i] = best.k;
    }
    // the original entry keeps its exact (median) color; split-off groups get their shapes' color
    for (let k = 0; k < clusters.length; k++) for (const g of clusters[k]) if (g.w > 0 && g.k >= 0 && g.k !== k) pal[g.k] = g.c.map(Math.round);
    // shapes too small to have an interior join the closest group of their entry
    for (let i = 0; i < nc; i++) if (assign[i] < 0) {
      const k = cK[i]; let best = k, bd = Infinity;
      for (const g of clusters[k]) { const kk = g.k < 0 ? k : g.k, P2 = pal[kk]; const s2 = pal[k]; const dd = cdist(s2[0], s2[1], s2[2], P2[0], P2[1], P2[2]); if (g.w > 0 && dd < bd) { bd = dd; best = kk; } }
      assign[i] = best;
    }
    // thin shapes have no interior to measure, so measure the darkest half of their pixels
    // (the line's core) and give them the closest dark line color
    {
      const lumK = pal.map(lum);
      const lines: number[] = []; pal.forEach((_c, k) => { if (lumK[k] < cfg("inkLum", 45)) lines.push(k); });
      if (lines.length > 1) {
        const cs = new Float64Array(nc * 4), cl = new Float64Array(nc), cn = new Uint32Array(nc);
        for (let p = 0; p < N; p++) { const c = comp[p]; if (c < 0 || cS[c] || lumK[cK[c]] >= 70) continue; const i = p * 4; cl[c] += 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2]; cn[c]++; }
        for (let p = 0; p < N; p++) {
          const c = comp[p]; if (c < 0 || !cn[c]) continue;
          const i = p * 4, l = 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
          if (l > cl[c] / cn[c] * 0.8) continue;
          cs[c * 4] += d[i]; cs[c * 4 + 1] += d[i + 1]; cs[c * 4 + 2] += d[i + 2]; cs[c * 4 + 3]++;
        }
        for (let c = 0; c < nc; c++) {
          if (!cs[c * 4 + 3] || cA[c] < 6 || lumK[cK[c]] >= cfg("inkLum", 45)) continue;
          const r0 = cs[c * 4] / cs[c * 4 + 3], g0 = cs[c * 4 + 1] / cs[c * 4 + 3], b0 = cs[c * 4 + 2] / cs[c * 4 + 3];
          let best = assign[c], bd = Infinity;
          for (const k of lines) { const P2 = pal[k]; const dd = cdist(r0, g0, b0, P2[0], P2[1], P2[2]); if (dd < bd) { bd = dd; best = k; } }
          assign[c] = best;
        }
      }
    }
    for (let p = 0; p < N; p++) if (comp[p] >= 0) idx[p] = assign[comp[p]];
  }
  for (let p = 0; p < N; p++) {
    const i = p * 4, k = idx[p];
    if (k === 255) { d[i] = d[i + 1] = d[i + 2] = d[i + 3] = 0; continue; }
    d[i] = pal[k][0]; d[i + 1] = pal[k][1]; d[i + 2] = pal[k][2]; d[i + 3] = 255;
  }
  return { pal, idx };
}

/** Black & white: threshold the upscaled image at its midpoint, then smooth the boundary. */
export function binarize(imgd: ImageData, scale: number, smooth: number): Uint8Array {
  const { width: w, height: h, data: d } = imgd, N = w * h;
  const idx = new Uint8Array(N);
  for (let p = 0; p < N; p++) {
    const i = p * 4;
    idx[p] = d[i + 3] < 128 ? 1 : (0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2] < 128 ? 0 : 1);
  }
  if (smooth > 0) smoothLabels(idx, w, h, 0.35 * smooth * Math.max(1, scale));
  for (let p = 0; p < N; p++) { const i = p * 4, v = idx[p] ? 255 : 0; d[i] = d[i + 1] = d[i + 2] = v; d[i + 3] = 255; }
  return idx;
}
