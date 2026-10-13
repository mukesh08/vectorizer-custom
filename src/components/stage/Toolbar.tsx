/* Above the canvas: how to compare (lens / split / one side), what the left side shows, and zoom. */
import { useRef } from "react";
import type { ViewMode } from "./Viewport";

const MODES: [ViewMode, string][] = [["lens", "Lens"], ["split", "Compare"], ["vec", "Vector"], ["raster", "Original"]];

interface Props {
  mode: ViewMode;
  setMode: (m: ViewMode) => void;
  lensSize: number;
  setLensSize: (v: number) => void;
  leftSide: "original" | "ref";
  setLeftSide: (v: "original" | "ref") => void;
  hasRef: boolean;
  onReference: (f: File | null | undefined) => void;
  zoomPct: number;
  onZoomBy: (f: number) => void;
  onZoomTo: (s: number) => void;
  onFit: () => void;
}

export default function Toolbar({
  mode, setMode, lensSize, setLensSize, leftSide, setLeftSide, hasRef, onReference,
  zoomPct, onZoomBy, onZoomTo, onFit
}: Props) {
  const refFile = useRef<HTMLInputElement>(null);

  return (
    <div className="toolbar">
      <div className="seg" id="modes" role="group" aria-label="View">
        {MODES.map(([m, label]) => (
          <button key={m} type="button" aria-pressed={mode === m} onClick={() => setMode(m)}>{label}</button>
        ))}
      </div>

      <label className="lensbar" id="lensBar" hidden={mode !== "lens"}>
        Lens size <input type="range" id="lensSize" min={40} max={220} value={lensSize} aria-label="Lens size"
          onChange={e => setLensSize(+e.target.value)} />
      </label>

      {/* a vector from another tool can take the left side, to compare both at any zoom */}
      <div className="refbar">
        <select id="leftSide" aria-label="Left side of the comparison" value={leftSide}
          onChange={e => setLeftSide(e.target.value as "original" | "ref")}>
          <option value="original">Left: original image</option>
          <option value="ref" disabled={!hasRef}>Left: reference SVG</option>
        </select>
        <button className="btn small" id="refBtn" type="button" onClick={() => refFile.current?.click()}>Load reference SVG</button>
        <input type="file" id="refFile" ref={refFile} accept=".svg,image/svg+xml" hidden
          onChange={e => { onReference(e.target.files?.[0]); e.target.value = ""; }} />
      </div>

      <div className="seg" id="zooms" role="group" aria-label="Zoom">
        <button type="button" id="zoomOutBtn" aria-label="Zoom out" onClick={() => onZoomBy(0.5)}>−</button>
        <button type="button" id="zoomFit" onClick={onFit}>Fit</button>
        <button type="button" id="zoom100" onClick={() => onZoomTo(1)}>1:1</button>
        <button type="button" id="zoomIn" aria-label="Zoom in" onClick={() => onZoomBy(2)}>+</button>
        <output id="zoomOut" aria-live="polite">{zoomPct.toLocaleString()}%</output>
      </div>
    </div>
  );
}
