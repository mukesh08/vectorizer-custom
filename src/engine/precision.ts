/* Precision engine: corner-aware fitting on original pixels.
   Works on the exact pixel staircase of each boundary (no upscaling, no blur):
   1. optimal polygon: the fewest straight segments that stay within ~0.6 px of the staircase
   2. each polygon vertex is moved to where its two neighbouring best-fit lines meet
   3. each vertex is classified: a sharp corner (kept as a point) or a rounded turn whose
      roundness comes from the geometry (potrace's alpha)
   4. everything between sharp corners is refitted as smooth Béziers with as few anchors
      as the tolerance allows */
import { cfg } from "./config";
import { fitEllipse, fitPiece, vlen, vnorm, vsub } from "./curve";
import type { Cubic, Loop, Pt } from "./types";

/** How far a straight segment may stray from the staircase, in trace pixels. */
let PREC_D = 0.6;

/** reach[i]: the furthest j such that pts[i]→pts[j] passes within PREC_D of every point between. */
function precStraight(pts: Pt[]): Int32Array {
  const n = pts.length, reach = new Int32Array(n);
  for (let i = 0; i < n - 1; i++) {
    const a = pts[i]; let lo = -Infinity, hi = Infinity, ref: number | null = null, rmax = 0, last = i + 1;
    for (let j = i + 1; j < n && j - i < 4000; j++) {
      const vx = pts[j][0] - a[0], vy = pts[j][1] - a[1], r = Math.hypot(vx, vy);
      if (r + PREC_D < rmax) break;                       // the path doubles back
      if (r <= PREC_D) { last = j; continue; }
      if (ref === null) ref = Math.atan2(vy, vx);
      let th = Math.atan2(vy, vx) - ref; if (th > Math.PI) th -= 2 * Math.PI; else if (th < -Math.PI) th += 2 * Math.PI;
      if (th < lo || th > hi) break;
      last = j;
      const dl = Math.asin(Math.min(1, PREC_D / r));
      lo = Math.max(lo, th - dl); hi = Math.min(hi, th + dl);
      if (lo > hi) break;
      if (r > rmax) rmax = r;
    }
    reach[i] = last;
  }
  reach[n - 1] = n - 1;
  return reach;
}

/** Indices of the fewest vertices whose segments still hug the staircase. */
function precPolygon(pts: Pt[]): number[] {
  const n = pts.length, reach = precStraight(pts);
  const Sx = new Float64Array(n + 1), Sy = new Float64Array(n + 1), Sxx = new Float64Array(n + 1), Syy = new Float64Array(n + 1), Sxy = new Float64Array(n + 1);
  const ox = pts[0][0], oy = pts[0][1];
  for (let i = 0; i < n; i++) {
    const x = pts[i][0] - ox, y = pts[i][1] - oy;
    Sx[i + 1] = Sx[i] + x; Sy[i + 1] = Sy[i] + y; Sxx[i + 1] = Sxx[i] + x * x; Syy[i + 1] = Syy[i] + y * y; Sxy[i + 1] = Sxy[i] + x * y;
  }
  const pen = (i: number, j: number): number => {
    const ax = pts[i][0] - ox, ay = pts[i][1] - oy, dx = pts[j][0] - pts[i][0], dy = pts[j][1] - pts[i][1], L2 = dx * dx + dy * dy;
    if (!L2) return 0;
    const c = j - i + 1, sx = Sx[j + 1] - Sx[i], sy = Sy[j + 1] - Sy[i];
    const uu = Syy[j + 1] - Syy[i] - 2 * ay * sy + c * ay * ay, ww = Sxx[j + 1] - Sxx[i] - 2 * ax * sx + c * ax * ax;
    const uw = Sxy[j + 1] - Sxy[i] - ay * sx - ax * sy + c * ax * ay;
    return (dx * dx * uu - 2 * dx * dy * uw + dy * dy * ww) / L2;
  };
  const cnt = new Int32Array(n).fill(1 << 30), cost = new Float64Array(n).fill(Infinity), prev = new Int32Array(n).fill(-1);
  cnt[0] = 0; cost[0] = 0;
  for (let i = 0; i < n - 1; i++) {
    if (cnt[i] === 1 << 30) continue;
    for (let j = i + 1; j <= reach[i]; j++) {
      const c = cnt[i] + 1, p = cost[i] + pen(i, j);
      if (c < cnt[j] || (c === cnt[j] && p < cost[j])) { cnt[j] = c; cost[j] = p; prev[j] = i; }
    }
  }
  const V: number[] = []; for (let j = n - 1; j >= 0; j = prev[j]) { V.push(j); if (j === 0) break; }
  return V.reverse();
}

/** Least-squares line through pts[a..b]: centroid + principal direction. */
function precLine(pts: Pt[], a: number, b: number): [number, number, number, number] {
  let mx = 0, my = 0; const c = b - a + 1;
  for (let i = a; i <= b; i++) { mx += pts[i][0]; my += pts[i][1]; }
  mx /= c; my /= c;
  let sxx = 0, syy = 0, sxy = 0;
  for (let i = a; i <= b; i++) { const x = pts[i][0] - mx, y = pts[i][1] - my; sxx += x * x; syy += y * y; sxy += x * y; }
  const th = 0.5 * Math.atan2(2 * sxy, sxx - syy);
  return [mx, my, Math.cos(th), Math.sin(th)];
}

function precVertex(L1: number[], L2: number[], orig: Pt): Pt {
  const [ax, ay, ux, uy] = L1, [bx, by, vx, vy] = L2, den = ux * vy - uy * vx;
  if (Math.abs(den) < 1e-6) return orig.slice();
  const t = ((bx - ax) * vy - (by - ay) * vx) / den;
  let x = ax + ux * t, y = ay + uy * t;
  // stay inside the half-pixel box around the staircase vertex
  x = Math.min(orig[0] + 0.5, Math.max(orig[0] - 0.5, x)); y = Math.min(orig[1] + 0.5, Math.max(orig[1] - 0.5, y));
  return [x, y];
}

const lerp2 = (t: number, a: Pt, b: Pt): Pt => [a[0] + t * (b[0] - a[0]), a[1] + t * (b[1] - a[1])];

/** potrace: how far the turn at b sticks out relative to a/c; >= alphaMax means a sharp corner. */
function precAlpha(a: Pt, b: Pt, c: Pt): number {
  const rx = -Math.sign(c[1] - a[1]), ry = Math.sign(c[0] - a[0]);
  const den = ry * (c[0] - a[0]) - rx * (c[1] - a[1]);
  if (!den) return 4 / 3;
  const dd = Math.abs(((b[0] - a[0]) * (c[1] - a[1]) - (c[0] - a[0]) * (b[1] - a[1])) / den);
  return (dd > 1 ? 1 - 1 / dd : 0) / 0.75;
}

/** corner = sharp break at p3 */
interface Piece { p0: Pt; c1: Pt; c2: Pt; p3: Pt; corner: boolean }

function precPieces(W: Pt[], closed: boolean, alphaMax: number): Piece[] {
  const m = W.length, out: Piece[] = [];
  const piece = (i: number, j: number, k: number): void => {
    const a = W[i], b = W[j], c = W[k], s = lerp2(0.5, a, b), e = lerp2(0.5, b, c);
    let al = precAlpha(a, b, c);
    if (al >= alphaMax) {
      out.push({ p0: s, c1: lerp2(1 / 3, s, b), c2: lerp2(2 / 3, s, b), p3: b.slice(), corner: true });
      out.push({ p0: b.slice(), c1: lerp2(1 / 3, b, e), c2: lerp2(2 / 3, b, e), p3: e, corner: false });
    } else {
      al = Math.min(1, Math.max(0.55, al));
      out.push({ p0: s, c1: lerp2(0.5 + 0.5 * al, a, b), c2: lerp2(0.5 + 0.5 * al, c, b), p3: e, corner: false });
    }
  };
  if (closed) { for (let j = 0; j < m; j++) piece((j - 1 + m) % m, j, (j + 1) % m); }
  else {
    if (m === 2) return [{ p0: W[0], c1: lerp2(1 / 3, W[0], W[1]), c2: lerp2(2 / 3, W[0], W[1]), p3: W[1], corner: true }];
    const s = lerp2(0.5, W[0], W[1]);
    out.push({ p0: W[0], c1: lerp2(1 / 3, W[0], s), c2: lerp2(2 / 3, W[0], s), p3: s, corner: false });
    for (let j = 1; j < m - 1; j++) piece(j - 1, j, j + 1);
    const e = lerp2(0.5, W[m - 2], W[m - 1]);
    out.push({ p0: e, c1: lerp2(1 / 3, e, W[m - 1]), c2: lerp2(2 / 3, e, W[m - 1]), p3: W[m - 1], corner: true });
  }
  return out;
}

/** Splits at sharp corners and refits each smooth run with as few cubics as `tol` allows. */
function precRefit(pieces: Piece[], closed: boolean, tol: number): Cubic[] {
  // closed loops with < 2 corners also split at two smooth points
  let starts: number[] = [];
  pieces.forEach((pc, i) => { if (pc.corner) starts.push((i + 1) % pieces.length); });
  if (!closed) starts = [0].concat(starts.filter(i => i > 0 && i < pieces.length));
  else if (starts.length < 2) { const add = [0, pieces.length >> 1]; starts = [...new Set(starts.concat(add))].sort((a, b) => a - b); }
  const bez = (pc: Piece, t: number): Pt => { const m = 1 - t; return [m * m * m * pc.p0[0] + 3 * m * m * t * pc.c1[0] + 3 * m * t * t * pc.c2[0] + t * t * t * pc.p3[0], m * m * m * pc.p0[1] + 3 * m * m * t * pc.c1[1] + 3 * m * t * t * pc.c2[1] + t * t * t * pc.p3[1]]; };
  const tanStart = (pc: Piece): Pt => { const d = vsub(pc.c1, pc.p0); return vlen(d) > 1e-6 ? vnorm(d) : vnorm(vsub(pc.p3, pc.p0)); };
  const tanEnd = (pc: Piece): Pt => { const d = vsub(pc.c2, pc.p3); return vlen(d) > 1e-6 ? vnorm(d) : vnorm(vsub(pc.p0, pc.p3)); };
  const out: Cubic[] = [], R = starts.length, n = pieces.length;
  for (let r = 0; r < R; r++) {
    const a = starts[r], b = r + 1 < R ? starts[r + 1] : (closed ? starts[0] + n : n);
    const run: Piece[] = []; for (let i = a; i < b; i++) run.push(pieces[i % n]);
    if (!run.length) continue;
    if (run.length === 1) { const pc = run[0]; out.push([pc.c1[0], pc.c1[1], pc.c2[0], pc.c2[1], pc.p3[0], pc.p3[1]]); continue; }
    const P: Pt[] = [run[0].p0];
    for (const pc of run) {
      const len = vlen(vsub(pc.p3, pc.p0)) + 1e-9, k = Math.max(2, Math.min(12, Math.ceil(len)));
      for (let s = 1; s <= k; s++) P.push(bez(pc, s / k));
    }
    const fit = fitPiece(P, 0, P.length - 1, tanStart(run[0]), tanEnd(run[run.length - 1]), tol * tol);
    for (const z of fit) out.push([z[1][0], z[1][1], z[2][0], z[2][1], z[3][0], z[3][1]]);
  }
  return out;
}

/** Fits one open chain (a boundary shared by two colors). */
export function precisionOpen(pts: Pt[], tol: number, alphaMax: number, sc = 1): Cubic[] {
  PREC_D = cfg("precD", 0.85) * sc;
  const n = pts.length;
  if (n < 3) return [[...lerp2(1 / 3, pts[0], pts[n - 1]), ...lerp2(2 / 3, pts[0], pts[n - 1]), pts[n - 1][0], pts[n - 1][1]]];
  const V = precPolygon(pts), m = V.length;
  const lines: number[][] = []; for (let k = 0; k + 1 < m; k++) lines.push(precLine(pts, V[k], V[k + 1]));
  const W = V.map((v, k) => (k === 0 || k === m - 1) ? pts[v].slice() : precVertex(lines[k - 1], lines[k], pts[v]));
  return precRefit(precPieces(W, false, alphaMax), false, tol);
}

/** Fits one closed outline; returns an exact ellipse when the shape is round enough. */
export function precisionLoop(pts: Pt[], tol: number, alphaMax: number, etol: number, sc = 1): Loop | null {
  PREC_D = cfg("precD", 0.85) * sc;
  let P = pts.slice(0, -1);                     // last point repeats the first
  const n = P.length; if (n < 4) return null;
  if (etol > 0 && n >= 16) {
    const mid = P.map((p, i) => lerp2(0.5, p, P[(i + 1) % n]));
    const e = fitEllipse(mid, etol); if (e) return { e };
  }
  // start at the point farthest from the centre: an extreme point is a natural vertex
  let cx = 0, cy = 0; for (const p of P) { cx += p[0]; cy += p[1]; } cx /= n; cy /= n;
  let s0 = 0, bd = -1; P.forEach((p, i) => { const d = (p[0] - cx) ** 2 + (p[1] - cy) ** 2; if (d > bd) { bd = d; s0 = i; } });
  P = P.slice(s0).concat(P.slice(0, s0)); P.push(P[0]);
  const V = precPolygon(P); V.pop();             // last vertex == first
  const m = V.length; if (m < 3) return null;
  const seg = (k: number) => precLine(P, V[k], k + 1 < m ? V[k + 1] : P.length - 1);
  const lines: number[][] = []; for (let k = 0; k < m; k++) lines.push(seg(k));
  const W = V.map((v, k) => precVertex(lines[(k - 1 + m) % m], lines[k], P[v]));
  const c = precRefit(precPieces(W, true, alphaMax), true, tol);
  if (!c.length) return null;
  return { s: [c[c.length - 1][4], c[c.length - 1][5]], c };
}
