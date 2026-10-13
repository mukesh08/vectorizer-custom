/* Curve fitting: Schneider least-squares cubics, Taubin contour smoothing and the exact
   ellipse test. A contour is split at real corners and fitted with as few cubic Béziers as
   the error tolerance allows, with matching tangents at every joint so curves flow without
   kinks. */
import { cfg } from "./config";
import type { Ellipse, Loop, Pt } from "./types";

/** [p0, c1, c2, p3] */
export type Bez = [Pt, Pt, Pt, Pt];

export const vsub = (a: Pt, b: Pt): Pt => [a[0] - b[0], a[1] - b[1]];
export const vlen = (a: Pt): number => Math.hypot(a[0], a[1]);
export const vnorm = (a: Pt): Pt => { const l = vlen(a) || 1; return [a[0] / l, a[1] / l]; };
export const vdot = (a: Pt, b: Pt): number => a[0] * b[0] + a[1] * b[1];

export function bezAt(b: Bez, t: number): Pt {
  const mt = 1 - t, a = mt * mt * mt, c = 3 * mt * mt * t, d = 3 * mt * t * t, e = t * t * t;
  return [a * b[0][0] + c * b[1][0] + d * b[2][0] + e * b[3][0], a * b[0][1] + c * b[1][1] + d * b[2][1] + e * b[3][1]];
}

/** Least-squares cubic through P[first..last] with the given end tangents. */
export function genBez(P: Pt[], first: number, last: number, u: number[], t1: Pt, t2: Pt): Bez {
  const p0 = P[first], p3 = P[last];
  let C00 = 0, C01 = 0, C11 = 0, X0 = 0, X1 = 0;
  for (let i = 0; i < u.length; i++) {
    const t = u[i], mt = 1 - t, b0 = mt * mt * mt, b1 = 3 * t * mt * mt, b2 = 3 * t * t * mt, b3 = t * t * t;
    const a1x = t1[0] * b1, a1y = t1[1] * b1, a2x = t2[0] * b2, a2y = t2[1] * b2;
    C00 += a1x * a1x + a1y * a1y; C01 += a1x * a2x + a1y * a2y; C11 += a2x * a2x + a2y * a2y;
    const q = P[first + i];
    const tx = q[0] - (p0[0] * (b0 + b1) + p3[0] * (b2 + b3)), ty = q[1] - (p0[1] * (b0 + b1) + p3[1] * (b2 + b3));
    X0 += a1x * tx + a1y * ty; X1 += a2x * tx + a2y * ty;
  }
  const det = C00 * C11 - C01 * C01, seg = vlen(vsub(p3, p0));
  let a1 = det ? (X0 * C11 - X1 * C01) / det : 0, a2 = det ? (C00 * X1 - C01 * X0) / det : 0;
  if (a1 < 1e-6 * seg || a2 < 1e-6 * seg || a1 > seg * 1.5 || a2 > seg * 1.5) a1 = a2 = seg / 3;
  return [p0, [p0[0] + t1[0] * a1, p0[1] + t1[1] * a1], [p3[0] + t2[0] * a2, p3[1] + t2[1] * a2], p3];
}

/** Largest squared deviation of the fit from the points, and where it happens. */
export function maxErr(P: Pt[], first: number, last: number, b: Bez, u: number[]): [number, number] {
  let mx = 0, at = (first + last) >> 1;
  for (let i = 1; i < u.length - 1; i++) {
    const q = bezAt(b, u[i]), d = (q[0] - P[first + i][0]) ** 2 + (q[1] - P[first + i][1]) ** 2;
    if (d > mx) { mx = d; at = first + i; }
  }
  return [mx, at];
}

/** Newton step that moves each parameter to the closest point on the current curve. */
export function reparam(P: Pt[], first: number, u: number[], b: Bez): number[] {
  const d1 = [0, 1, 2].map(i => [3 * (b[i + 1][0] - b[i][0]), 3 * (b[i + 1][1] - b[i][1])]);
  const d2 = [0, 1].map(i => [2 * (d1[i + 1][0] - d1[i][0]), 2 * (d1[i + 1][1] - d1[i][1])]);
  return u.map((t, i) => {
    const q = bezAt(b, t), mt = 1 - t;
    const q1 = [mt * mt * d1[0][0] + 2 * mt * t * d1[1][0] + t * t * d1[2][0], mt * mt * d1[0][1] + 2 * mt * t * d1[1][1] + t * t * d1[2][1]];
    const q2 = [mt * d2[0][0] + t * d2[1][0], mt * d2[0][1] + t * d2[1][1]];
    const df = vsub(q, P[first + i]);
    const num = vdot(df, q1), den = vdot(q1, q1) + vdot(df, q2);
    const nt = den ? t - num / den : t;
    return Math.min(1, Math.max(0, nt));
  });
}

/* Fit with as few anchors as possible: Schneider's method first, then repeatedly try to replace
   two neighbouring curves with one that still stays within tolerance of the outline. */
export function fitPiece(P: Pt[], first: number, last: number, t1: Pt, t2: Pt, err: number): Bez[] {
  const out: Bez[] = []; fitCubic(P, first, last, t1, t2, err, out);
  if (out.length < 2) return out;
  const at = new Map<Pt, number>(); for (let i = first; i <= last; i++) at.set(P[i], i);
  const tryOne = (a: number, b: number, ta: Pt, tb: Pt): Bez | null => {
    if (b - a < 2) return null;
    let u = [0], tot = 0;
    for (let i = a + 1; i <= b; i++) { tot += vlen(vsub(P[i], P[i - 1])); u.push(tot); }
    u = u.map(v => v / (tot || 1));
    let bz = genBez(P, a, b, u, ta, tb), [me] = maxErr(P, a, b, bz, u);
    for (let it = 0; it < 24 && me >= err; it++) { u = reparam(P, a, u, bz); bz = genBez(P, a, b, u, ta, tb); [me] = maxErr(P, a, b, bz, u); }
    return me < err ? bz : null;
  };
  let merged = true;
  while (merged && out.length > 1) {
    merged = false;
    for (let i = 0; i + 1 < out.length; i++) {
      const A = out[i], B = out[i + 1], a = at.get(A[0]), b = at.get(B[3]);
      if (a === undefined || b === undefined) continue;
      const ta = vnorm(vsub(A[1], A[0])), tb = vnorm(vsub(B[2], B[3]));
      if (!isFinite(ta[0]) || !isFinite(tb[0])) continue;
      const bz = tryOne(a, b, ta, tb);
      if (bz) { out.splice(i, 2, bz); merged = true; }
    }
  }
  return out;
}

export function fitCubic(P: Pt[], first: number, last: number, t1: Pt, t2: Pt, err: number, out: Bez[], depth = 0): void {
  if (last - first === 1 || depth > 40) {
    const d = vlen(vsub(P[last], P[first])) / 3;
    out.push([P[first], [P[first][0] + t1[0] * d, P[first][1] + t1[1] * d], [P[last][0] + t2[0] * d, P[last][1] + t2[1] * d], P[last]]);
    return;
  }
  let u = [0], tot = 0;
  for (let i = first + 1; i <= last; i++) { tot += vlen(vsub(P[i], P[i - 1])); u.push(tot); }
  u = u.map(v => v / (tot || 1));
  let b = genBez(P, first, last, u, t1, t2);
  let [me, split] = maxErr(P, first, last, b, u);
  if (me < err) { out.push(b); return; }
  if (me < err * 16) {
    for (let it = 0; it < 20; it++) {
      u = reparam(P, first, u, b); b = genBez(P, first, last, u, t1, t2);
      [me, split] = maxErr(P, first, last, b, u);
      if (me < err) { out.push(b); return; }
    }
  }
  split = Math.min(last - 1, Math.max(first + 1, split));
  const tc = vnorm(vsub(P[Math.max(first, split - 2)], P[Math.min(last, split + 2)]));
  fitCubic(P, first, split, t1, tc, err, out, depth + 1);
  fitCubic(P, split, last, [-tc[0], -tc[1]], t2, err, out, depth + 1);
}

/* Contour smoothing (Taubin λ|μ): each point moves toward the midpoint of its neighbours, then
   back out slightly, which irons out JPEG-block ripples and pixel wobble along an edge without
   shrinking the shape. Points marked as corners stay fixed, so sharp tips remain sharp. */
export function taubin(P: Pt[], fixed: Uint8Array | null, iters: number, mu = -0.53, maxDev = 0): void {
  const n = P.length; if (n < 5 || iters <= 0) return;
  const X = new Float64Array(n), Y = new Float64Array(n), NX = new Float64Array(n), NY = new Float64Array(n);
  for (let i = 0; i < n; i++) { X[i] = P[i][0]; Y[i] = P[i][1]; }
  const OX = maxDev ? X.slice() : null, OY = maxDev ? Y.slice() : null, md2 = maxDev * maxDev;
  for (let it = 0; it < iters; it++) {
    for (const lam of mu ? [0.5, mu] : [0.5]) {
      for (let i = 0; i < n; i++) {
        if (fixed && fixed[i]) { NX[i] = X[i]; NY[i] = Y[i]; continue; }
        const a = i ? i - 1 : n - 1, b = i < n - 1 ? i + 1 : 0;
        NX[i] = X[i] + lam * ((X[a] + X[b]) / 2 - X[i]);
        NY[i] = Y[i] + lam * ((Y[a] + Y[b]) / 2 - Y[i]);
      }
      X.set(NX); Y.set(NY);
    }
    // never let a point drift more than maxDev from where the edge really is: ripples (small
    // amplitude) are ironed out, but small shapes and thin lines can't shrink away
    if (maxDev && OX && OY) for (let i = 0; i < n; i++) {
      const dx = X[i] - OX[i], dy = Y[i] - OY[i], d2 = dx * dx + dy * dy;
      if (d2 > md2) { const f = maxDev / Math.sqrt(d2); X[i] = OX[i] + dx * f; Y[i] = OY[i] + dy * f; }
    }
  }
  for (let i = 0; i < n; i++) { P[i][0] = X[i]; P[i][1] = Y[i]; }
}

/* Ellipse test ("parameterized shapes"): fit an ellipse to the outline from its area moments,
   then accept it only if every outline point lies within `etol` of that ellipse. Beads, dots,
   pupils and round badges then come out as exact circles/ellipses. */
export function fitEllipse(P: Pt[], etol: number): Ellipse | null {
  const n = P.length;
  let A = 0, cx = 0, cy = 0, ixx = 0, iyy = 0, ixy = 0;
  for (let i = 0; i < n; i++) {
    const [x0, y0] = P[i], [x1, y1] = P[(i + 1) % n], cr = x0 * y1 - x1 * y0;
    A += cr; cx += (x0 + x1) * cr; cy += (y0 + y1) * cr;
    ixx += (x0 * x0 + x0 * x1 + x1 * x1) * cr; iyy += (y0 * y0 + y0 * y1 + y1 * y1) * cr;
    ixy += (x0 * y1 + 2 * x0 * y0 + 2 * x1 * y1 + x1 * y0) * cr;
  }
  A /= 2; if (Math.abs(A) < 12) return null;
  cx /= 6 * A; cy /= 6 * A;
  const sxx = ixx / 12 / A - cx * cx, syy = iyy / 12 / A - cy * cy, sxy = ixy / 24 / A - cx * cy;
  const tr = (sxx + syy) / 2, dt = Math.sqrt(((sxx - syy) / 2) ** 2 + sxy * sxy);
  const l1 = tr + dt, l2 = tr - dt; if (!(l2 > 0)) return null;
  const a = 2 * Math.sqrt(l1), b = 2 * Math.sqrt(l2), th = 0.5 * Math.atan2(2 * sxy, sxx - syy);
  if (b < 2 || a / b > 6) return null;
  const c = Math.cos(th), s = Math.sin(th);
  for (let i = 0; i < n; i++) {
    const dx = P[i][0] - cx, dy = P[i][1] - cy, u = dx * c + dy * s, v = -dx * s + dy * c;
    const r = Math.hypot(u / a, v / b);
    if (Math.abs(r - 1) * Math.min(a, b) > etol) return null;
  }
  return [cx, cy, a, b, th];
}

export const KAPPA = 0.5522847498;

/** An ellipse as a start point plus four cubic quarter-arcs. */
export function ellipseCubics(e: Ellipse): Loop {
  const [cx, cy, a, b, th] = e, c = Math.cos(th), s = Math.sin(th);
  const T = (u: number, v: number): Pt => [cx + u * c - v * s, cy + u * s + v * c];
  // explicit control points per quadrant (counter-clockwise in the ellipse's own frame)
  const k = KAPPA;
  const ctrl: [number, number][][] = [
    [[a, k * b], [k * a, b], [0, b]],
    [[-k * a, b], [-a, k * b], [-a, 0]],
    [[-a, -k * b], [-k * a, -b], [0, -b]],
    [[k * a, -b], [a, -k * b], [a, 0]]
  ];
  return { s: T(a, 0), c: ctrl.map(seg => [...T(...seg[0]), ...T(...seg[1]), ...T(...seg[2])]) };
}

/** Resample, smooth, split at corners and fit one closed contour. */
export function fitLoop(raw: Pt[], tol: number, cosCorner: number, _prec: number, arc = 0, etol = 0): Loop | null {
  // resample to ~1 px spacing so smoothing strength doesn't depend on how marching squares spaced the points
  const P: Pt[] = [];
  for (const p of raw) {
    if (!P.length) { P.push([p[0], p[1]]); continue; }
    const q = P[P.length - 1], dd = Math.hypot(p[0] - q[0], p[1] - q[1]);
    if (dd < 0.7) continue;
    if (dd > 1.6) { const m = Math.ceil(dd); for (let t = 1; t < m; t++) P.push([q[0] + (p[0] - q[0]) * t / m, q[1] + (p[1] - q[1]) * t / m]); }
    P.push([p[0], p[1]]);
  }
  while (P.length > 3 && Math.hypot(P[0][0] - P[P.length - 1][0], P[0][1] - P[P.length - 1][1]) < 0.7) P.pop();
  const n = P.length;
  if (n < 3) return null;
  const lineLoop = (pts: Pt[]): Loop => ({ s: pts[0], c: pts.slice(1).concat([pts[0]]).map((p, i) => { const a = pts[i]; return [a[0] + (p[0] - a[0]) / 3, a[1] + (p[1] - a[1]) / 3, a[0] + 2 * (p[0] - a[0]) / 3, a[1] + 2 * (p[1] - a[1]) / 3, p[0], p[1]]; }) });
  if (n < 8) return lineLoop(P);
  // light pre-smoothing so pixel noise isn't mistaken for corners
  if (arc > 0) taubin(P, null, 8, -0.53, 0.35 * arc);
  const k = Math.max(2, Math.min(Math.max(4, Math.round(arc * 1.6)), n >> 3));
  const at = (i: number): Pt => P[((i % n) + n) % n];
  // corners: sharp turns that are the local maximum of turning
  const cs = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    const v1 = vsub(P[i], at(i - k)), v2 = vsub(at(i + k), P[i]);
    cs[i] = vdot(v1, v2) / ((vlen(v1) * vlen(v2)) || 1);
  }
  const corners: number[] = [];
  for (let i = 0; i < n; i++) {
    if (cs[i] >= cosCorner) continue;
    let isMin = true;
    for (let j = -k; j <= k && isMin; j++) { if (!j) continue; const q = ((i + j) % n + n) % n; if (cs[q] < cs[i] || (cs[q] === cs[i] && j < 0)) isMin = false; }
    if (isMin) corners.push(i);
  }
  if (arc > 0) {
    const fx = new Uint8Array(n); corners.forEach(i => fx[i] = 1);
    const dev = cfg("dev", 0.35) * arc;
    taubin(P, fx, Math.min(120, Math.round(arc * arc * 4)), 0, dev);
    taubin(P, fx, 6, -0.53, dev);
  }
  if (etol > 0 && !corners.length && n >= 16) {
    const e = fitEllipse(P, etol);
    if (e) return { e };
  }
  const isC = new Uint8Array(n); corners.forEach(i => isC[i] = 1);
  const starts = corners.length ? corners : [0, n >> 2, n >> 1, (3 * n) >> 2];
  const tanAt = (i: number): Pt => vnorm(vsub(at(i + 2), at(i - 2)));
  const loop: Loop = { s: P[starts[0]], c: [] };
  const m = starts.length;
  for (let s = 0; s < m; s++) {
    const a = starts[s]; let b = starts[(s + 1) % m]; if (b <= a) b += n;
    const seg: Pt[] = []; for (let i = a; i <= b; i++) seg.push(at(i));
    const L = seg.length; if (L < 2) continue;
    const kk = Math.min(k, L - 1);
    const t1 = isC[a] ? vnorm(vsub(seg[kk], seg[0])) : tanAt(a);
    const t2 = isC[b % n] ? vnorm(vsub(seg[L - 1 - kk], seg[L - 1])) : ((v: Pt): Pt => [-v[0], -v[1]])(tanAt(b));
    const out = fitPiece(seg, 0, L - 1, t1, t2, tol * tol);
    for (const z of out) loop.c!.push([z[1][0], z[1][1], z[2][0], z[2][1], z[3][0], z[3][1]]);
  }
  return loop;
}
