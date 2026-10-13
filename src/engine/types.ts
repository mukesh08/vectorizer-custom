/** [x, y] */
export type Pt = number[];
/** [r, g, b] (0–255) */
export type RGB = number[];
/** One cubic segment relative to the previous end point: [c1x, c1y, c2x, c2y, x, y] */
export type Cubic = number[];
/** [cx, cy, a, b, theta] */
export type Ellipse = number[];

/** A closed outline: either a start point plus cubics, or an exact ellipse. */
export interface Loop {
  s?: Pt;
  c?: Cubic[];
  e?: Ellipse;
  area?: number;
}

/** All outlines of one palette color. */
export interface Layer {
  k: number;
  c: RGB;
  loops: Loop[];
}

export type StageFn = (text: string) => void;
export type AliveFn = () => boolean;
