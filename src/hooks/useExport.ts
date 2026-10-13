/* Saving and copying. The vector formats need fitted shapes, so they're refused (with a reason)
   when the result came from VTracer or imagetracer. */
import { useCallback } from "react";
import type { SourceImage } from "../engine/pipeline";
import { buildDXF } from "../output/dxf";
import { buildPNG } from "../output/png";
import type { Doc } from "../output/svg";
import { buildEPS, buildPDF } from "../output/vector";
import type { Settings } from "../settings";

type Notify = (text: string, err?: boolean) => void;

const baseName = (src: SourceImage | null): string =>
  (src?.name || "image").replace(/\.[^.]+$/, "").slice(0, 120) || "image";

export function useExport(doc: Doc | null, settings: Settings, source: SourceImage | null, svgText: string, notify: Notify) {
  const download = useCallback(async () => {
    if (!svgText || !doc || !source) return;
    const fmt = settings.fmt;
    if ((fmt === "pdf" || fmt === "eps" || fmt === "dxf") && !doc.shapes) {
      notify("PDF, EPS and DXF need the Smooth engine with a clean palette. Switch engine, or save as SVG or PNG.", true);
      return;
    }
    let data: Blob;
    try {
      notify("Preparing " + fmt.toUpperCase() + "…");
      data = fmt === "svg" ? new Blob([svgText], { type: "image/svg+xml" })
        : fmt === "eps" ? buildEPS(doc, settings, source)
        : fmt === "dxf" ? buildDXF(doc, settings, source)
        : fmt === "pdf" ? await buildPDF(doc, settings, source)
        : await buildPNG(doc, settings, source);
    } catch (err) {
      console.error(err);
      notify("Couldn't build the " + fmt.toUpperCase() + ". For PNG, try a smaller output size.", true);
      return;
    }
    const name = baseName(source) + "." + fmt;
    const a = document.createElement("a");
    a.href = URL.createObjectURL(data); a.download = name;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 4000);
    notify("Saved " + name);
  }, [doc, settings, source, svgText, notify]);

  const copy = useCallback(() => {
    navigator.clipboard.writeText(svgText).then(
      () => notify("SVG code copied."),
      () => {
        // clipboard blocked (insecure context, or no permission): select it so Ctrl+C works
        const ta = document.getElementById("code") as HTMLTextAreaElement | null;
        ta?.closest("details")?.setAttribute("open", "");
        ta?.focus(); ta?.select();
        notify("Press Ctrl+C (or ⌘C) to copy the selected code.");
      }
    );
  }, [svgText, notify]);

  return { download, copy };
}
