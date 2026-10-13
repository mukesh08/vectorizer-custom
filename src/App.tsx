/* Vectorizer Custom: drop in a raster image, compare the vector against it, tidy the palette,
   download SVG / PDF / EPS / PNG / DXF. Everything runs in the browser.

   This file is wiring only — state lives in hooks/, UI in components/, tracing in engine/ and
   file writing in output/. Nothing to configure until there is an image, so the landing page
   and the workbench are mutually exclusive. */
import { useCallback, useMemo, useState } from "react";
import SiteFooter from "./components/brand/SiteFooter";
import SiteHeader from "./components/brand/SiteHeader";
import PreCrop from "./components/crop/PreCrop";
import Landing from "./components/landing/Landing";
import ControlRail from "./components/rail/ControlRail";
import Stage from "./components/stage/Stage";
import { VT_CANVAS_ID, VT_SVG_ID } from "./engine/pipeline";
import { useExport } from "./hooks/useExport";
import { useImageDrop } from "./hooks/useImageDrop";
import { useImageSource } from "./hooks/useImageSource";
import { useOutputFile } from "./hooks/useOutputFile";
import { useReference } from "./hooks/useReference";
import { useVectorizer } from "./hooks/useVectorizer";
import { paletteNote, parsePalette } from "./output/palette";
import { DEFAULT_SETTINGS, applyPreset, type PresetName, type Settings } from "./settings";

/** Past this a browser starts to struggle with the file, so say so. */
const BIG_SVG = 4e6;

export default function App() {
  const [settings, setSettings] = useState<Settings>(DEFAULT_SETTINGS);
  const [palOpen, setPalOpen] = useState(false);
  // messages the page raises itself (file errors, downloads); they win over the tracer's
  const [localNote, setLocalNote] = useState<{ text: string; err: boolean } | null>(null);

  const patch = useCallback((p: Partial<Settings>) => setSettings(s => ({ ...s, ...p })), []);
  const onPreset = useCallback((p: PresetName) => setSettings(s => applyPreset(s, p)), []);
  const notify = useCallback((text: string, err = false) => setLocalNote({ text, err }), []);
  const clearNote = useCallback(() => setLocalNote(null), []);

  const { source, pending, adopt, loadFile, loadSample, recrop, cancelCrop, fileName } =
    useImageSource(settings.maxSize, notify, clearNote);
  useImageDrop(loadFile);

  const { result, busy, note, ms, setNote, traceNow } = useVectorizer(source, settings);
  const { doc, svgText, stats } = useOutputFile(result, settings, source, ms);
  const { download, copy } = useExport(doc, settings, source, svgText, notify);
  const { refText, refStats, leftSide, setLeftSide, loadReference } = useReference(notify);

  const shown = localNote ?? note;
  const vecOnly = result && !result.shapes && (settings.fmt === "pdf" || settings.fmt === "eps" || settings.fmt === "dxf")
    ? "PDF, EPS and DXF need the Smooth engine with a clean palette; this engine can save SVG or PNG."
    : "";
  const sizeWarning = stats && stats.bytes > BIG_SVG
    ? "This SVG is large. Raise the minimum shape area or lower max colors to shrink it."
    : "";
  const noteText = shown.text || vecOnly || sizeWarning;
  const noteErr = shown.text ? shown.err : false;

  const pal = useMemo(() => parsePalette(settings.customPal), [settings.customPal]);

  const onPaletteRules = useCallback((text: string) => {
    patch({ customPal: text });
    if (text) setPalOpen(true);
    // palette edits apply at once rather than waiting out the typing debounce
    traceNow();
  }, [patch, traceNow]);

  return (
    <div className="wrap">
      <SiteHeader asHeading={!!source} />

      {!source && <Landing onFile={loadFile} onSample={loadSample} />}

      {pending && (
        <PreCrop
          img={pending.img}
          name={pending.name}
          limitMP={settings.maxSize}
          onCancel={cancelCrop}
          onConfirm={adopt}
        />
      )}

      {source && (
        <div className="bench">
          <ControlRail
            settings={settings}
            patch={patch}
            onPreset={onPreset}
            onFile={loadFile}
            onCrop={recrop}
            fileName={fileName}
            palNote={paletteNote(pal)}
            palNoteErr={pal.bad.length > 0}
            palOpen={palOpen}
          />

          <Stage
            source={source}
            settings={settings}
            result={result}
            svgText={svgText}
            stats={stats}
            busy={busy}
            note={noteText}
            noteErr={noteErr}
            refText={refText}
            refStats={refStats}
            leftSide={leftSide}
            setLeftSide={setLeftSide}
            onReference={f => void loadReference(f)}
            onPaletteRules={onPaletteRules}
            setNote={setNote}
            onDownload={() => void download()}
            onCopy={copy}
          />
        </div>
      )}

      <SiteFooter />

      {/* VTracer reads this canvas and writes into this SVG, both by element id */}
      <canvas id={VT_CANVAS_ID} hidden />
      <svg id={VT_SVG_ID} xmlns="http://www.w3.org/2000/svg" style={{ display: "none" }} />
    </div>
  );
}
