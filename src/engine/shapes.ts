/* Loop geometry shared by the tracers and the output writers: polygon sampling, point-in-
   polygon and the nesting test that turns a color's outlines into shapes with holes. */
import { ellipseCubics } from "./curve";
import type { Loop, Pt } from "./types";

/** A loop as a polygon. Each curve is sampled, not just its end points: a thin lens made of two
    curves between the same two points would otherwise look like zero area and be dropped,
    leaving a see-through gap. */
export function polyOf(lp: Loop): Pt[] {
  if (lp.e) { const E = ellipseCubics(lp.e); return [E.s!].concat(E.c!.map(z => [z[4], z[5]])); }
  const out: Pt[] = [lp.s!]; let p0 = lp.s!;
  for (const z of lp.c!) {
    for (const t of [0.25, 0.5, 0.75]) { const m = 1 - t; out.push([m * m * m * p0[0] + 3 * m * m * t * z[0] + 3 * m * t * t * z[2] + t * t * t * z[4], m * m * m * p0[1] + 3 * m * m * t * z[1] + 3 * m * t * t * z[3] + t * t * t * z[5]]); }
    out.push([z[4], z[5]]); p0 = [z[4], z[5]];
  }
  return out;
}

export function inPoly(pt: Pt, poly: Pt[]): boolean {
  let inside = false; const [x, y] = pt;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i], [xj, yj] = poly[j];
    if ((yi > y) !== (yj > y) && x < (xj - xi) * (y - yi) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

/** Enclosed area of one loop. */
export function loopArea(lp: Loop): number {
  const poly = polyOf(lp); let a = 0;
  for (let i = 0; i < poly.length; i++) { const p = poly[i], q = poly[(i + 1) % poly.length]; a += p[0] * q[1] - q[0] * p[1]; }
  return Math.abs(a) / 2;
}

/* group_by none: split each color into separate shapes, each outer outline carrying the holes
   directly inside it (found by nesting depth: even = outline, odd = hole). */
export function splitShapes(loops: Loop[]): Loop[][] {
  const L = loops.map(lp => {
    const poly = polyOf(lp);
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const [x, y] of poly) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
    return { lp, poly, bb: [x0, y0, x1, y1], depth: 0, parent: -1 };
  });
  const order = L.map((_, i) => i).sort((a, b) => (L[b].lp.area ?? 0) - (L[a].lp.area ?? 0));
  for (let oi = 0; oi < order.length; oi++) {
    const i = order[oi], A = L[i], probe = A.poly[0];
    for (let oj = oi - 1; oj >= 0; oj--) {           // smallest container first
      const B = L[order[oj]];
      if (B.bb[0] > A.bb[0] || B.bb[1] > A.bb[1] || B.bb[2] < A.bb[2] || B.bb[3] < A.bb[3]) continue;
      if (inPoly(probe, B.poly)) { A.parent = order[oj]; A.depth = B.depth + 1; break; }
    }
  }
  const shapes = new Map<number, Loop[]>();
  for (const i of order) {
    const A = L[i];
    if (A.depth % 2 === 0) shapes.set(i, [A.lp]);
    else if (shapes.has(A.parent)) shapes.get(A.parent)!.push(A.lp);
  }
  return [...shapes.values()];
}
