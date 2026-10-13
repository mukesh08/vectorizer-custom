/* The output file and its numbers. Tracing produces shapes once; every output option only
   rebuilds the file from them, so switching draw style, gap filler, grouping, size or format is
   instant. A short debounce keeps slider drags smooth. */
import { useEffect, useMemo, useState } from "react";
import type { SourceImage, TracedResult } from "../engine/pipeline";
import { outSize } from "../output/size";
import { buildSVG, type Doc } from "../output/svg";
import type { Settings } from "../settings";

export interface OutputStats {
  paths: number;
  colors: number;
  /** Human-readable file size, plus the raw byte count the size warning reads. */
  size: string;
  bytes: number;
  dims: string;
  tracedAt: string;
  time: string;
  engine: string;
}

export const fmtBytes = (b: number): string =>
  b < 1024 ? b + " B" : b < 1048576 ? (b / 1024).toFixed(1) + " KB" : (b / 1048576).toFixed(2) + " MB";

const REBUILD_DELAY = 120;

export function useOutputFile(result: TracedResult | null, settings: Settings, source: SourceImage | null, ms: number | undefined) {
  const [svgText, setSvgText] = useState("");

  const doc: Doc | null = useMemo(() => result
    ? { shapes: result.shapes, body: result.body, tw: result.tw, th: result.th, scale: result.scale }
    : null, [result]);

  useEffect(() => {
    const t = setTimeout(() => setSvgText(doc && source ? buildSVG(doc, settings, source) : ""), REBUILD_DELAY);
    return () => clearTimeout(t);
  }, [doc, source, settings]);

  const stats: OutputStats | null = useMemo(() => {
    if (!svgText || !source || !result) return null;
    const bytes = new Blob([svgText]).size;
    const sz = outSize(settings, source.w, source.h);
    return {
      paths: (svgText.match(/<path/g) || []).length,
      colors: result.colors,
      size: fmtBytes(bytes),
      bytes,
      dims: sz.unit === "none" || sz.unit === "px"
        ? Math.round(sz.w) + "×" + Math.round(sz.h)
        : +sz.w.toFixed(2) + "×" + +sz.h.toFixed(2) + " " + sz.unit,
      tracedAt: result.tw + "×" + result.th + (result.scale > 1.05 ? " (" + result.scale.toFixed(1) + "×)" : ""),
      time: ms === undefined ? "—" : ms < 1000 ? Math.round(ms) + " ms" : (ms / 1000).toFixed(1) + " s",
      engine: result.engineName
    };
  }, [svgText, source, result, settings, ms]);

  return { doc, svgText, stats };
}
