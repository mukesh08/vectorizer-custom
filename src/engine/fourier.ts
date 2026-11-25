/* Elliptic Fourier descriptors: fit a closed outline as a truncated Fourier series.

   A closed contour is periodic in its own arc length, so walking it once at constant speed makes
   x and y periodic functions of t ∈ [0, 2π) and each can be written as a Fourier series:

     x_N(t) = a₀ + Σ(k=1..N) ( a_k cos kt + b_k sin kt )
     y_N(t) = c₀ + Σ(k=1..N) ( c_k cos kt + d_k sin kt )

   Kuhl & Giardina (1982) introduced this as a shape descriptor; here it is the fitter itself.
   N is a low-pass filter on shape: N=1 is the best-fit ellipse, a handful of harmonics keep only
   the gross form, and raising N restores progressively finer detail until corners come back.
   That is the whole character of this mode — it trades fidelity for smoothness by a single
   number, where the Schneider fitter in curve.ts instead trades it for path count.

   Two things make it cheap. The coefficients are a DFT of the resampled contour, so a cos/sin
   table indexed by (k·i mod M) evaluates them exactly with no trig in the inner loop. And the
   series is analytic, so its derivative is known in closed form and each output segment can be a
   cubic Bézier that matches position AND tangent at both ends (Hermite interpolation) rather
   than a curve re-fitted to sampled points.

   Open chains have no period and are left to the ordinary fitter. */
import type { Loop, Pt } from "./types";

/** Samples per harmonic when resampling the contour; 4 keeps the DFT clear of aliasing. */
const OVERSAMPLE = 4;
const MIN_SAMPLES = 64;
const MAX_SAMPLES = 4096;
/** Output segments per harmonic. A cubic Hermite tracks a sinusoid to ~1e-4 at 3 per period. */
const SEG_PER_HARMONIC = 3;
const MIN_SEGMENTS = 8;
const MAX_SEGMENTS = 1024;

export interface Harmonics {
  /** Centroid: the k=0 term of each series. */
  a0: number;
  c0: number;
  a: Float64Array;
  b: Float64Array;
  c: Float64Array;
  d: Float64Array;
  n: number;
}

/** Drops a repeated closing vertex and any zero-length step. */
function clean(raw: Pt[]): Pt[] {
  const P: Pt[] = [];
  for (const p of raw) {
    const q = P[P.length - 1];
    if (q && Math.abs(p[0] - q[0]) < 1e-9 && Math.abs(p[1] - q[1]) < 1e-9) continue;
    P.push([p[0], p[1]]);
  }
  while (P.length > 2) {
    const a = P[0], b = P[P.length - 1];
    if (Math.hypot(a[0] - b[0], a[1] - b[1]) > 1e-9) break;
    P.pop();
  }
  return P;
}

/** Walks the closed polygon at constant speed, returning `m` points equally spaced by arc length. */
function resample(P: Pt[], m: number): Pt[] {
  const n = P.length;
  const seg = new Float64Array(n);
  let total = 0;
  for (let i = 0; i < n; i++) {
    const a = P[i], b = P[(i + 1) % n];
    seg[i] = Math.hypot(b[0] - a[0], b[1] - a[1]);
    total += seg[i];
  }
  if (!(total > 0)) return [];
  const step = total / m, out: Pt[] = [];
  let i = 0, walked = 0;                       // walked = arc length consumed inside segment i
  for (let j = 0; j < m; j++) {
    let want = j * step;
    // advance to the segment holding `want`
    while (i < n - 1 && walked + seg[i] <= want) { walked += seg[i]; i++; }
    const a = P[i], b = P[(i + 1) % n];
    const u = seg[i] > 0 ? Math.min(1, (want - walked) / seg[i]) : 0;
    out.push([a[0] + (b[0] - a[0]) * u, a[1] + (b[1] - a[1]) * u]);
  }
  return out;
}

/** The DFT of an equally-spaced closed contour: coefficients of the series above. */
export function harmonicsOf(points: Pt[], n: number): Harmonics | null {
  const m = points.length;
  if (m < 4 || n < 1) return null;
  const COS = new Float64Array(m), SIN = new Float64Array(m);
  for (let j = 0; j < m; j++) {
    const th = (2 * Math.PI * j) / m;
    COS[j] = Math.cos(th);
    SIN[j] = Math.sin(th);
  }
  const a = new Float64Array(n + 1), b = new Float64Array(n + 1);
  const c = new Float64Array(n + 1), d = new Float64Array(n + 1);
  let sx = 0, sy = 0;
  for (let i = 0; i < m; i++) { sx += points[i][0]; sy += points[i][1]; }
  const two = 2 / m;
  for (let k = 1; k <= n; k++) {
    let ak = 0, bk = 0, ck = 0, dk = 0;
    // cos(k·tᵢ) = COS[(k·i) mod m] — exact, and no trig inside the loop
    for (let i = 0, j = 0; i < m; i++, j += k) {
      if (j >= m) j -= m;                      // k < m always, so one subtraction is enough
      const co = COS[j], si = SIN[j], x = points[i][0], y = points[i][1];
      ak += x * co; bk += x * si; ck += y * co; dk += y * si;
    }
    a[k] = ak * two; b[k] = bk * two; c[k] = ck * two; d[k] = dk * two;
  }
  return { a0: sx / m, c0: sy / m, a, b, c, d, n };
}

/** x_N(t), y_N(t) and their derivatives — the series and its exact tangent. */
function evalAt(H: Harmonics, t: number): { x: number; y: number; dx: number; dy: number } {
  let x = H.a0, y = H.c0, dx = 0, dy = 0;
  for (let k = 1; k <= H.n; k++) {
    const kt = k * t, co = Math.cos(kt), si = Math.sin(kt);
    x += H.a[k] * co + H.b[k] * si;
    y += H.c[k] * co + H.d[k] * si;
    dx += k * (-H.a[k] * si + H.b[k] * co);
    dy += k * (-H.c[k] * si + H.d[k] * co);
  }
  return { x, y, dx, dy };
}

/** Signed area of a closed polygon, used only to rank loops downstream. */
function areaOf(P: Pt[]): number {
  let s = 0;
  for (let i = 0, n = P.length; i < n; i++) {
    const a = P[i], b = P[(i + 1) % n];
    s += a[0] * b[1] - b[0] * a[1];
  }
  return Math.abs(s) / 2;
}

/**
 * Fits one closed outline as a Fourier series of `harmonics` terms and emits it as cubics.
 *
 * @param raw        the traced contour, in trace pixels
 * @param harmonics  N in the series; 1 is an ellipse, higher restores detail
 * @param scale      trace upscale factor, so the segment budget tracks real size
 */
export function fourierLoop(raw: Pt[], harmonics: number, scale = 1): Loop | null {
  const P = clean(raw);
  if (P.length < 3) return null;

  let perim = 0;
  for (let i = 0, n = P.length; i < n; i++) {
    const a = P[i], b = P[(i + 1) % n];
    perim += Math.hypot(b[0] - a[0], b[1] - a[1]);
  }
  if (!(perim > 0)) return null;

  const n = Math.max(1, Math.round(harmonics));
  const m = Math.min(MAX_SAMPLES, Math.max(MIN_SAMPLES, n * OVERSAMPLE));
  const S = resample(P, m);
  if (S.length < 4) return null;

  const H = harmonicsOf(S, n);
  if (!H) return null;

  // one segment per ~1.5 px of outline is already past what the eye resolves, so the harmonic
  // budget and the size budget both cap the segment count
  const segs = Math.max(
    MIN_SEGMENTS,
    Math.min(MAX_SEGMENTS, Math.ceil(n * SEG_PER_HARMONIC), Math.ceil(perim / (1.5 * Math.max(1, scale))))
  );

  const dt = (2 * Math.PI) / segs;
  const knots = new Array<{ x: number; y: number; dx: number; dy: number }>(segs + 1);
  for (let j = 0; j < segs; j++) knots[j] = evalAt(H, j * dt);
  knots[segs] = knots[0];                      // closed: the last knot is the first

  const loop: Loop = { s: [knots[0].x, knots[0].y], c: [], area: areaOf(P) };
  const third = dt / 3;
  for (let j = 0; j < segs; j++) {
    const p = knots[j], q = knots[j + 1];
    loop.c!.push([
      p.x + p.dx * third, p.y + p.dy * third,   // control 1: leave along the tangent
      q.x - q.dx * third, q.y - q.dy * third,   // control 2: arrive along the tangent
      q.x, q.y
    ]);
  }
  return loop;
}
