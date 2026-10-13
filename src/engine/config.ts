/* Tuning knobs for the clean-palette pipeline and the tracers.
   Tuned for detail: dense palette sampling so small features (an iris, a highlight) get their own
   color, dark shades merge so thin lines stay one continuous shape, and only true "sandwiched"
   edge bands count as halos. Any key can be overridden for experiments by defining
   `window.CFG = { ... }` before the app loads. */
export interface Cfg {
  samples?: number; minFrac?: number; seedStop?: number; merge?: number; extra?: number; dpow?: number;
  ls?: number; sig?: number; bshare?: number;
  [key: string]: number | boolean | undefined;
}

declare global {
  interface Window { CFG?: Cfg }
}

export const CFG: Record<string, number | boolean | undefined> = Object.assign(
  { samples: 600000, minFrac: 0.00001, seedStop: 80, merge: 700, extra: 6, dpow: 2, ls: 0.2, sig: 0.6, bshare: 0.3 },
  typeof window !== "undefined" ? window.CFG || {} : {}
);

/** Numeric config value with a default. */
export const cfg = (key: string, def: number): number => {
  const v = CFG[key];
  return typeof v === "number" ? v : def;
};

/** Boolean config flag. */
export const flag = (key: string): boolean => !!CFG[key];
