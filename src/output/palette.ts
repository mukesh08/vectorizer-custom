/* processing.palette: "#RRGGBB[AA] [-> #RRGGBB[AA]] [~ tolerance];" — snap, remap or remove. */
import { parseHex } from "../engine/color";
import type { RGB } from "../engine/types";

export interface PaletteRule {
  from: number[];
  to: number[];
  /** Fractional ARGB reach, 0–2. */
  tol: number;
}

export interface ParsedPalette {
  rules: PaletteRule[];
  /** Entries that couldn't be read, verbatim. */
  bad: string[];
}

export function parsePalette(text: string): ParsedPalette {
  const rules: PaletteRule[] = [], bad: string[] = [];
  for (const raw of (text || "").split(/[;\n]/)) {
    const t = raw.trim(); if (!t) continue;
    const m = /^(#?[0-9a-f]{6}(?:[0-9a-f]{2})?)\s*(?:->\s*(#?[0-9a-f]{6}(?:[0-9a-f]{2})?))?\s*(?:~\s*([\d.]+))?$/i.exec(t);
    const from = m && parseHex(m[1]), to = m && m[2] ? parseHex(m[2]) : from;
    if (!m || !from || !to) { bad.push(t); continue; }
    rules.push({ from, to, tol: m[3] !== undefined ? Math.min(2, Math.max(0, +m[3])) : 2 });
  }
  return { rules, bad };
}

/** The message shown under the custom-palette box. */
export function paletteNote(p: ParsedPalette): string {
  if (p.bad.length) return "Couldn't read: " + p.bad.join("; ");
  if (!p.rules.length) return "";
  return p.rules.length + " palette " + (p.rules.length === 1 ? "entry" : "entries") + " applied";
}

/** Nearest entry within its tolerance; null means "remove this color". */
export function applyPaletteRule(rules: PaletteRule[], c: RGB): RGB | null {
  let best: PaletteRule | null = null, bd = Infinity;
  for (const r of rules) {
    const d = Math.sqrt(((255 - r.from[3]) / 255) ** 2 + ((c[0] - r.from[0]) / 255) ** 2 + ((c[1] - r.from[1]) / 255) ** 2 + ((c[2] - r.from[2]) / 255) ** 2);
    if (d <= r.tol && d < bd) { bd = d; best = r; }
  }
  if (!best) return c;
  if (best.to[3] < 128) return null;
  return best.to.slice(0, 3);
}
