import type { RGB } from "./types";

/** Perceptual ("redmean") squared RGB distance. */
export const cdist = (r1: number, g1: number, b1: number, r2: number, g2: number, b2: number): number => {
  const rm = (r1 + r2) / 2, dr = r1 - r2, dg = g1 - g2, db = b1 - b2;
  return (2 + rm / 256) * dr * dr + 4 * dg * dg + (2 + (255 - rm) / 256) * db * db;
};

export const lum = (c: RGB): number => 0.299 * c[0] + 0.587 * c[1] + 0.114 * c[2];

export const hexOf = (c: RGB): string => "#" + ((1 << 24) | (c[0] << 16) | (c[1] << 8) | c[2]).toString(16).slice(1);

/** "#RRGGBB[AA]" -> [r, g, b, a] */
export function parseHex(h: string): number[] | null {
  const m = /^#?([0-9a-f]{6})([0-9a-f]{2})?$/i.exec(h.trim()); if (!m) return null;
  const v = parseInt(m[1], 16);
  return [v >> 16, v >> 8 & 255, v & 255, m[2] ? parseInt(m[2], 16) : 255];
}

/** Let the browser paint between heavy steps. */
export const yieldUI = (): Promise<void> => new Promise(r => setTimeout(r, 0));
