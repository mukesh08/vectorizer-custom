/* The right-hand side of the workbench: compare toolbar, canvas, trace numbers, palette and
   export. Everything here reads a traced result; the rail is what changes one. */
import { useRef, useState } from "react";
import type { SourceImage, TracedResult } from "../../engine/pipeline";
import type { OutputStats } from "../../hooks/useOutputFile";
import type { Settings } from "../../settings";
import PaletteEditor from "../palette/PaletteEditor";
import ExportBar from "./ExportBar";
import Stats from "./Stats";
import Toolbar from "./Toolbar";
import Viewport, { type ViewMode, type ViewportHandle } from "./Viewport";

interface Props {
  source: SourceImage;
  settings: Settings;
  result: TracedResult | null;
  svgText: string;
  stats: OutputStats | null;
  /** Progress text while tracing; null when idle. */
  busy: string | null;
  note: string;
  noteErr: boolean;
  refText: string | null;
  refStats: string;
  leftSide: "original" | "ref";
  setLeftSide: (v: "original" | "ref") => void;
  onReference: (f: File | null | undefined) => void;
  onPaletteRules: (text: string) => void;
  setNote: (text: string, err?: boolean) => void;
  onDownload: () => void;
  onCopy: () => void;
}

export default function Stage({
  source, settings, result, svgText, stats, busy, note, noteErr,
  refText, refStats, leftSide, setLeftSide, onReference, onPaletteRules, setNote, onDownload, onCopy
}: Props) {
  const [mode, setMode] = useState<ViewMode>("lens");
  const [lensSize, setLensSize] = useState(90);
  const [zoomPct, setZoomPct] = useState(100);
  const viewport = useRef<ViewportHandle | null>(null);

  return (
    <section className="stage">
      <Toolbar
        mode={mode} setMode={setMode}
        lensSize={lensSize} setLensSize={setLensSize}
        leftSide={leftSide} setLeftSide={setLeftSide}
        hasRef={!!refText} onReference={onReference}
        zoomPct={zoomPct}
        onZoomBy={f => viewport.current?.zoomBy(f)}
        onZoomTo={s => viewport.current?.zoomTo(s)}
        onFit={() => viewport.current?.fit()}
      />

      <div className="canvas">
        <Viewport
          source={source}
          svgText={svgText}
          meta={result ? { tw: result.tw, th: result.th } : null}
          mode={mode}
          lensSize={lensSize}
          refText={refText}
          showRef={leftSide === "ref" && !!refText}
          onZoom={setZoomPct}
          handle={viewport}
        />
        <div className="busy" id="busy" hidden={!busy}>
          <span><i /><b id="busyText" style={{ fontWeight: 500 }}>{busy ?? "Tracing paths…"}</b></span>
        </div>
      </div>

      <p className="refstats" id="refStats" hidden={!refStats}>{refStats}</p>

      <Stats stats={stats} />

      <PaletteEditor
        base={result?.palBase ?? null}
        customPal={settings.customPal}
        onRules={onPaletteRules}
        setNote={setNote}
      />

      <ExportBar
        fmt={settings.fmt}
        ready={!!svgText}
        note={note}
        noteErr={noteErr}
        svgText={svgText}
        onDownload={onDownload}
        onCopy={onCopy}
      />
    </section>
  );
}
