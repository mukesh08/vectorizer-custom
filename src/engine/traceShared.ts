/* Shared-boundary tracer (cutouts): every boundary between two colors is traced ONCE, smoothed
   once and fitted once, then used by the shapes on both sides of it. Neighbouring shapes
   therefore meet exactly, with no overlap and no hairline gap, and junctions where three colors
   meet are pinned so they stay sharp. */
import { yieldUI } from "./color";
import { cfg, flag } from "./config";
import { fitLoop, fitPiece, taubin, vdot, vlen, vnorm, vsub } from "./curve";
import { precisionLoop, precisionOpen } from "./precision";
import { loopArea } from "./shapes";
import type { AliveFn, Cubic, Layer, Loop, Pt, RGB, StageFn } from "./types";

export interface SharedOpts {
  tol: number;
  cornerDeg: number;
  skip?: Set<number>;
  stage: StageFn;
  alive: AliveFn;
  arc?: number;
  etol?: number;
  scale?: number;
  /** Fit on the exact pixel staircase instead of the smoothed midpoint chain. */
  precision?: boolean;
  /** Turn sharpness above which a polygon vertex counts as a corner. */
  alphaMax?: number;
}

/** pixel-corner staircase -> edge midpoints (ends kept on their junction corners) */
function chainPoints(pts: Pt[]): Pt[] {
  const n0 = pts.length, P: Pt[] = [[pts[0][0], pts[0][1]]];
  for (let i = 1; i < n0; i++) P.push([(pts[i - 1][0] + pts[i][0]) / 2, (pts[i - 1][1] + pts[i][1]) / 2]);
  P.push([pts[n0 - 1][0], pts[n0 - 1][1]]);
  return P;
}

/** Fits one open chain. The two ends are junctions shared with other chains and never move. */
function fitChain(P: Pt[], tol: number, cosCorner: number, arc: number): Cubic[] {
  const n = P.length;
  const line = (a: Pt, b: Pt): Cubic => [a[0] + (b[0] - a[0]) / 3, a[1] + (b[1] - a[1]) / 3, a[0] + 2 * (b[0] - a[0]) / 3, a[1] + 2 * (b[1] - a[1]) / 3, b[0], b[1]];
  if (n < 7) return [line(P[0], P[n - 1])];
  const fx = new Uint8Array(n); fx[0] = fx[n - 1] = 1;
  if (arc > 0) taubin(P, fx, 6, -0.53, Math.min(1, 0.3 * arc));
  const k = Math.max(2, Math.min(Math.max(3, Math.round(arc * 1.4)), (n - 1) >> 2));
  const cs = new Float64Array(n).fill(1);
  for (let i = k; i < n - k; i++) {
    const v1 = vsub(P[i], P[i - k]), v2 = vsub(P[i + k], P[i]);
    cs[i] = vdot(v1, v2) / ((vlen(v1) * vlen(v2)) || 1);
  }
  const cut = [0];
  for (let i = k; i < n - k; i++) {
    if (cs[i] >= cosCorner) continue;
    let isMin = true;
    for (let j = -k; j <= k && isMin; j++) if (j && (cs[i + j] < cs[i] || (cs[i + j] === cs[i] && j < 0))) isMin = false;
    if (isMin) { cut.push(i); fx[i] = 1; }
  }
  cut.push(n - 1);
  if (arc > 0) {
    const dev = Math.min(1.1, cfg("dev", 0.35) * arc);
    taubin(P, fx, Math.min(120, Math.round(arc * arc * 4)), 0, dev);
    taubin(P, fx, 6, -0.53, dev);
  }
  const out: Cubic[] = [];
  for (let s = 0; s + 1 < cut.length; s++) {
    const a = cut[s], b = cut[s + 1], seg = P.slice(a, b + 1), L = seg.length;
    if (L < 3) { out.push(line(seg[0], seg[L - 1])); continue; }
    const kk = Math.min(k, L - 1);
    const t1 = vnorm(vsub(seg[kk], seg[0])), t2 = vnorm(vsub(seg[L - 1 - kk], seg[L - 1]));
    const o = fitPiece(seg, 0, L - 1, t1, t2, tol * tol);
    for (const z of o) out.push([z[1][0], z[1][1], z[2][0], z[2][1], z[3][0], z[3][1]]);
  }
  return out;
}

/** Cubics running from the original end back to `start`. */
function reverseCubics(start: Pt, cs: Cubic[]): Cubic[] {
  const out: Cubic[] = [];
  for (let i = cs.length - 1; i >= 0; i--) {
    const z = cs[i], p0 = i ? [cs[i - 1][4], cs[i - 1][5]] : start;
    out.push([z[2], z[3], z[0], z[1], p0[0], p0[1]]);
  }
  return out;
}

interface Chain {
  pts: Pt[];
  /** Label on the right / left of the walking direction. */
  R: number;
  L: number;
  /** Junction ids (corner index) at each end. */
  j0: number;
  j1: number;
  closed: boolean;
  /** Midpoint chain, open chains only. */
  P?: Pt[];
  /** Fitted cubics (open) or the fitted outline (closed). */
  c?: Cubic[];
  loop?: Loop | null;
  short?: boolean;
  skip?: boolean;
}

interface Ref { i: number; fwd: boolean; start?: number; end?: number; vOut?: Pt; vIn?: Pt; used?: boolean }

export async function traceShared(idx: Uint8Array, w: number, h: number, pal: RGB[], o: SharedOpts): Promise<{ layers: Layer[]; colors: number } | null> {
  const { tol, cornerDeg, skip = new Set<number>(), stage, alive, arc = 0, etol = 0, scale = 1, precision = false, alphaMax = 1 } = o;
  const OUT = 256, W1 = w + 1;
  const lab = (x: number, y: number): number => (x < 0 || y < 0 || x >= w || y >= h) ? OUT : idx[y * w + x];
  const NH = w * (h + 1);
  const visited = new Uint8Array(NH + W1 * h);
  // step from corner (x,y) in direction d (0 +x, 1 +y, 2 -x, 3 -y): edge id, right & left labels
  let E = 0, RL = 0, LL = 0;
  const step = (x: number, y: number, d: number): boolean => {
    switch (d) {
      case 0: if (x >= w) return false; E = y * w + x; RL = lab(x, y); LL = lab(x, y - 1); return true;
      case 2: if (x <= 0) return false; E = y * w + x - 1; RL = lab(x - 1, y - 1); LL = lab(x - 1, y); return true;
      case 1: if (y >= h) return false; E = NH + y * W1 + x; RL = lab(x - 1, y); LL = lab(x, y); return true;
      default: if (y <= 0) return false; E = NH + (y - 1) * W1 + x; RL = lab(x, y - 1); LL = lab(x - 1, y - 1); return true;
    }
  };
  const DX = [1, 0, -1, 0], DY = [0, 1, 0, -1];
  const isJ = (x: number, y: number): boolean => {
    if ((x === 0 || x === w) && (y === 0 || y === h)) return true;
    let c = 0;
    for (let d = 0; d < 4; d++) if (step(x, y, d) && RL !== LL) c++;
    return c >= 3;
  };
  const chains: Chain[] = [];
  const walk = (x0: number, y0: number, d0: number, closed: boolean): void => {
    step(x0, y0, d0);
    const R = RL, L = LL, pts: Pt[] = [[x0, y0]];
    let x = x0, y = y0, d = d0;
    for (;;) {
      step(x, y, d); visited[E] = 1;
      x += DX[d]; y += DY[d]; pts.push([x, y]);
      if (closed ? (x === x0 && y === y0) : isJ(x, y)) break;
      // the one other boundary edge at this corner, keeping R on the right
      let nd = -1;
      for (const t of [(d + 1) & 3, d, (d + 3) & 3]) if (step(x, y, t) && RL === R && LL === L) { nd = t; break; }
      if (nd < 0) break;
      d = nd;
    }
    chains.push({ pts, R, L, j0: y0 * W1 + x0, j1: y * W1 + x, closed });
  };
  stage("Tracing shared edges…"); await yieldUI(); if (!alive()) return null;
  // 1. open chains between junctions
  for (let y = 0; y <= h; y++) {
    for (let x = 0; x <= w; x++) {
      if (!isJ(x, y)) continue;
      for (let d = 0; d < 4; d++) if (step(x, y, d) && RL !== LL && !visited[E]) walk(x, y, d, false);
    }
    if ((y & 255) === 0) { await yieldUI(); if (!alive()) return null; }
  }
  // 2. closed chains: islands bordered by one other color only
  for (let y = 0; y <= h; y++) for (let x = 0; x < w; x++) {
    const e = y * w + x; if (visited[e]) continue;
    if (step(x, y, 0) && RL !== LL) walk(x, y, 0, true);
  }
  for (let y = 0; y < h; y++) for (let x = 0; x <= w; x++) {
    const e = NH + y * W1 + x; if (visited[e]) continue;
    if (step(x, y, 1) && RL !== LL) walk(x, y, 1, true);
  }
  // 3. junctions sit on pixel corners; move each to the average of the nearby points of the
  //    chains meeting there, so outlines pass through it without a stair-step kink
  const wanted = (k: number): boolean => k !== OUT && k !== 255 && !skip.has(k);
  const jacc = new Map<number, number[]>();
  for (const ch of chains) {
    if (ch.closed) continue;
    ch.P = chainPoints(ch.pts);
    const P = ch.P, n = P.length, m = Math.min(n - 1, 3);
    for (const [j, q] of [[ch.j0, P[m]], [ch.j1, P[n - 1 - m]]] as [number, Pt][]) {
      const a = jacc.get(j) || [0, 0, 0]; a[0] += q[0]; a[1] += q[1]; a[2]++; jacc.set(j, a);
    }
  }
  for (const ch of chains) {
    if (ch.closed) continue;
    const P = ch.P!, n = P.length;
    for (const [j, i] of [[ch.j0, 0], [ch.j1, n - 1]]) {
      const x = j % W1, y = (j / W1) | 0;
      if ((x === 0 || x === w) || (y === 0 || y === h)) continue;      // keep the image frame exact
      const a = jacc.get(j); if (!a || a[2] < 3) continue;
      // blend toward the local centroid, but never more than ~1 px from the corner
      let nx = a[0] / a[2], ny = a[1] / a[2]; const dx = nx - x, dy = ny - y, dl = Math.hypot(dx, dy);
      if (dl > 1) { nx = x + dx / dl; ny = y + dy / dl; }
      P[i] = [nx, ny];
    }
  }
  // 3b. contract very short boundary pieces: where a tiny sliver of color touches an outline it
  //     creates two junctions a pixel apart, i.e. two extra anchors and a little notch. Merging the
  //     two junctions into one point removes both.
  const minLen = cfg("contract", 1.6) * Math.max(1, scale);
  const parent = new Map<number, number>();
  const find = (j: number): number => { let r = j; while (parent.has(r) && parent.get(r) !== r) r = parent.get(r)!; while (parent.has(j) && parent.get(j) !== r) { const n = parent.get(j)!; parent.set(j, r); j = n; } return r; };
  const arcLen = (P: Pt[]): number => { let L = 0; for (let i = 1; i < P.length; i++) L += Math.hypot(P[i][0] - P[i - 1][0], P[i][1] - P[i - 1][1]); return L; };
  for (const ch of chains) {
    if (ch.closed || ch.j0 === ch.j1) continue;
    if (arcLen(ch.P!) < minLen) { const a = find(ch.j0), b = find(ch.j1); if (a !== b) { parent.set(a, a); parent.set(b, a); ch.short = true; } else ch.short = true; }
  }
  if (parent.size) {
    const pos = new Map<number, number[]>();
    for (const ch of chains) {
      if (ch.closed) continue;
      for (const [j, p] of [[ch.j0, ch.P![0]], [ch.j1, ch.P![ch.P!.length - 1]]] as [number, Pt][]) {
        const r = find(j); if (!parent.has(r)) continue;
        const a = pos.get(r) || [0, 0, 0]; a[0] += p[0]; a[1] += p[1]; a[2]++; pos.set(r, a);
      }
    }
    for (const ch of chains) {
      if (ch.closed) continue;
      ch.j0 = find(ch.j0); ch.j1 = find(ch.j1);
      if (ch.short && ch.j0 === ch.j1) { ch.skip = true; continue; }
      for (const [j, i] of [[ch.j0, 0], [ch.j1, ch.P!.length - 1]]) {
        const a = pos.get(j); if (!a) continue;
        const x = j % W1, y = (j / W1) | 0;
        if (x === 0 || x === w || y === 0 || y === h) continue;
        ch.P![i] = [a[0] / a[2], a[1] / a[2]];
      }
    }
  }
  for (const ch of chains) if (!ch.closed) { ch.pts = [ch.P![0]].concat(ch.pts.slice(1, -1), [ch.P![ch.P!.length - 1]]); }
  const cosCorner = Math.cos(cornerDeg / 180 * Math.PI);
  for (let i = 0; i < chains.length; i++) {
    const ch = chains[i];
    if (ch.skip || (!wanted(ch.R) && !wanted(ch.L))) continue;
    if (precision) {
      const sc = Math.max(1, Math.sqrt(scale));
      if (ch.closed) ch.loop = precisionLoop(ch.pts, tol, alphaMax, etol, sc);
      else ch.c = precisionOpen(ch.pts, tol, alphaMax, sc);
    } else if (ch.closed) {
      const poly: Pt[] = []; const p = ch.pts;
      for (let j = 1; j < p.length; j++) poly.push([(p[j - 1][0] + p[j][0]) / 2, (p[j - 1][1] + p[j][1]) / 2]);
      ch.loop = fitLoop(poly, tol, cosCorner, 1, arc, etol);
    } else ch.c = fitChain(ch.P!, tol, cosCorner, arc);
    if ((i & 2047) === 0) { stage("Fitting shared curves… " + Math.round(i / chains.length * 100) + "%"); await yieldUI(); if (!alive()) return null; }
  }
  // 3c. junction continuity: where an outline merely passes a junction (two of the edges meeting
  //     there are nearly collinear), give both edges one shared tangent so the outline flows
  //     straight through instead of kinking. Real corners (no collinear pair) stay sharp.
  if (!flag("noJT")) {
    type End = { ch: Chain; e: 0 | 1 };
    const J = new Map<number, End[]>(), cosT = -Math.cos(cfg("jtDeg", 40) / 180 * Math.PI);
    const at = (j: number): End[] => { let l = J.get(j); if (!l) { l = []; J.set(j, l); } return l; };
    for (const ch of chains) {
      if (ch.closed || ch.skip || !ch.c || !ch.c.length) continue;
      at(ch.j0).push({ ch, e: 0 });
      at(ch.j1).push({ ch, e: 1 });
    }
    const handle = (it: End) => {
      const c = it.ch.c!, n = c.length;
      if (it.e === 0) { const p = it.ch.pts[0]; return { ox: p[0], oy: p[1], hx: c[0][0] - p[0], hy: c[0][1] - p[1], nx: c[0][4] - p[0], ny: c[0][5] - p[1] }; }
      const z = c[n - 1], q = n > 1 ? c[n - 2] : null, px = q ? q[4] : it.ch.pts[0][0], py = q ? q[5] : it.ch.pts[0][1];
      return { ox: z[4], oy: z[5], hx: z[2] - z[4], hy: z[3] - z[5], nx: px - z[4], ny: py - z[5] };
    };
    const setH = (it: End, ux: number, uy: number, L: number): void => {
      const c = it.ch.c!, n = c.length;
      if (it.e === 0) { const p = it.ch.pts[0]; c[0][0] = p[0] + ux * L; c[0][1] = p[1] + uy * L; }
      else { const z = c[n - 1]; z[2] = z[4] + ux * L; z[3] = z[5] + uy * L; }
    };
    for (const list of J.values()) {
      if (list.length < 2) continue;
      const H = list.map(it => { const hd = handle(it); let L = Math.hypot(hd.hx, hd.hy), ux = hd.hx, uy = hd.hy; if (L < 1e-6) { ux = hd.nx; uy = hd.ny; L = Math.hypot(ux, uy) / 3; } const l = Math.hypot(ux, uy) || 1; return { ux: ux / l, uy: uy / l, L }; });
      let bi = -1, bk = -1, bc = cosT;
      for (let i = 0; i < H.length; i++) for (let k = i + 1; k < H.length; k++) { const c = H[i].ux * H[k].ux + H[i].uy * H[k].uy; if (c < bc) { bc = c; bi = i; bk = k; } }
      if (bi < 0) continue;
      let tx = H[bi].ux - H[bk].ux, ty = H[bi].uy - H[bk].uy; const tl = Math.hypot(tx, ty) || 1; tx /= tl; ty /= tl;
      setH(list[bi], tx, ty, H[bi].L); setH(list[bk], -tx, -ty, H[bk].L);
    }
  }
  // 4. assemble each color's outlines from its chains (color kept on the right-hand side)
  const per = new Map<number, Ref[]>();
  const add = (k: number, ref: Ref): void => { if (!wanted(k)) return; if (!per.has(k)) per.set(k, []); per.get(k)!.push(ref); };
  chains.forEach((ch, i) => { if (ch.skip) return; add(ch.R, { i, fwd: true }); if (ch.L !== ch.R) add(ch.L, { i, fwd: false }); });
  const layers: Layer[] = [];
  for (const [k, refs] of per) {
    const loops: Loop[] = [], starts = new Map<number, Ref[]>();
    for (const r of refs) {
      const ch = chains[r.i];
      if (ch.closed) {
        if (!ch.loop) continue;
        const lp: Loop = ch.loop.e ? { e: ch.loop.e } : { s: ch.loop.s, c: ch.loop.c };
        lp.area = loopArea(lp); if (lp.area >= 1.5) loops.push(lp);
        continue;
      }
      r.start = r.fwd ? ch.j0 : ch.j1; r.end = r.fwd ? ch.j1 : ch.j0;
      // headings leaving the start junction and arriving at the end junction (geometric, so they
      // still work where short pieces were merged away)
      const P = ch.P!, n = P.length, m = Math.min(3, n - 1);
      const hd = (a: Pt, b: Pt): Pt => { const dx = b[0] - a[0], dy = b[1] - a[1], l = Math.hypot(dx, dy) || 1; return [dx / l, dy / l]; };
      r.vOut = r.fwd ? hd(P[0], P[m]) : hd(P[n - 1], P[n - 1 - m]);
      r.vIn = r.fwd ? hd(P[n - 1 - m], P[n - 1]) : hd(P[m], P[0]);
      if (!starts.has(r.start)) starts.set(r.start, []);
      starts.get(r.start)!.push(r);
    }
    for (const list of starts.values()) for (const r0 of list) {
      if (r0.used) continue;
      const lp: Loop = { s: undefined, c: [] };
      let r: Ref | null = r0, guard = 0;
      while (r && !r.used && guard++ < 1e6) {
        r.used = true;
        const ch = chains[r.i], p = ch.pts;
        if (!lp.s) lp.s = r.fwd ? p[0] : p[p.length - 1];
        const cs = r.fwd ? ch.c! : reverseCubics(p[0], ch.c!);
        for (const z of cs) lp.c!.push(z);
        const cand: Ref[] = (starts.get(r.end!) || []).filter((q: Ref) => !q.used);
        // keep the color on the right: take the sharpest right turn available
        let nxt: Ref | null = null, ba = -Infinity;
        for (const q of cand) {
          const a = Math.atan2(r.vIn![0] * q.vOut![1] - r.vIn![1] * q.vOut![0], r.vIn![0] * q.vOut![0] + r.vIn![1] * q.vOut![1]);
          if (a > ba) { ba = a; nxt = q; }
        }
        r = nxt;
      }
      if (lp.c!.length) { lp.area = loopArea(lp); if (lp.area >= 1.5) loops.push(lp); }
    }
    if (loops.length) layers.push({ k, c: pal[k], loops });
  }
  // biggest colors first, so editors list the background before the details
  const cnt = new Map<number, number>(); for (const L of layers) cnt.set(L.k, L.loops.reduce((a, l) => a + (l.area ?? 0), 0));
  layers.sort((a, b) => cnt.get(b.k)! - cnt.get(a.k)!);
  return { layers, colors: layers.length };
}
