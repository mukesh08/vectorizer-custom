/* The left rail: drop zone, style presets and every tracing and output option. Tracing options
   re-trace; output options only rebuild the file from the shapes the tracer produced. */
import { useRef } from "react";
import {
  PRESET_LABELS, lineTolVal, minAreaVal, usesSmoothEngine,
  type PresetName, type Settings
} from "../../settings";
import { Check, Group, Section, Select, Slider } from "../ui/Fields";

interface Props {
  settings: Settings;
  patch: (p: Partial<Settings>) => void;
  onPreset: (p: PresetName) => void;
  onFile: (f: File | null | undefined) => void;
  /** Reopens the crop dialog for the image already loaded. */
  onCrop: () => void;
  /** "name · W×H px", or the loading line before the first image arrives. */
  fileName: string;
  /** Message under the custom-palette box. */
  palNote: string;
  palNoteErr: boolean;
  /** Opened automatically when a palette edit writes rules into the box. */
  palOpen: boolean;
}

const fmtNum = (v: number): string => String(+v.toFixed(3));
const fmtPx = (v: number): string => v.toFixed(2).replace(/0$/, "") + " px";

export default function ControlRail({ settings: s, patch, onPreset, onFile, onCrop, fileName, palNote, palNoteErr, palOpen }: Props) {
  const file = useRef<HTMLInputElement>(null);
  const bw = s.preset === "bw";
  const clean = s.palette === "clean";
  const smoothEng = usesSmoothEngine(s);
  const fillStyle = s.drawStyle === "fill_shapes";

  return (
    <aside className="rail">
      <div className="drop" id="drop" tabIndex={0} role="button" aria-label="Choose an image to vectorize"
        onClick={() => file.current?.click()}
        onKeyDown={e => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); file.current?.click(); } }}>
        <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="var(--accent)" strokeWidth="1.8" aria-hidden="true">
          <path d="M12 16V4m0 0-4 4m4-4 4 4" /><path d="M4 16v3a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-3" />
        </svg>
        <strong>Drop an image here</strong>
        <span>or click to browse · paste works too<br />JPG, PNG, WebP, GIF</span>
        <div className="file-name" id="fileName">{fileName}</div>
        <input type="file" id="file" ref={file} accept="image/*" hidden
          onChange={e => { onFile(e.target.files?.[0]); e.target.value = ""; }} />
      </div>

      <button className="btn small" type="button" id="cropBtn" onClick={onCrop}>Crop image…</button>

      <Group>
        <div className="label">Style</div>
        <div className="presets" id="presets">
          {PRESET_LABELS.map(p => (
            <button key={p.id} type="button" aria-pressed={s.preset === p.id} onClick={() => onPreset(p.id)}>
              {p.name}<small>{p.hint}</small>
            </button>
          ))}
        </div>
      </Group>

      <Select id="engineSel" label="Tracing engine" value={s.engine} onChange={v => patch({ engine: v })} options={[
        { value: "precision", label: "Precision · sharp corners, smooth curves (new)" },
        { value: "native", label: "Precision · original pixels only" },
        { value: "smooth", label: "Smooth · upscaled, extra-soft curves" },
        { value: "vtracer", label: "Classic · VTracer" }
      ]} />

      <Select id="palette" label="Color handling" value={s.palette} disabled={bw} onChange={v => patch({ palette: v })} options={[
        { value: "clean", label: "Clean palette · flat colors, crisp edges" },
        { value: "gradients", label: "Keep gradients · for photos and shading" }
      ]} />

      <Slider id="maxColors" label="Max colors" readout={String(s.maxColors)} min={2} max={96} value={s.maxColors}
        disabled={bw || !clean} hidden={!clean || bw} onChange={v => patch({ maxColors: v })} />

      <Slider id="smooth" label="Edge smoothing" readout={s.smooth ? s.smooth.toFixed(1) : "Off"} min={0} max={3} step={0.5}
        value={s.smooth} hidden={!clean && !bw} onChange={v => patch({ smooth: v })} />

      <Group hidden={clean || bw}>
        <Slider id="colors" label="Color precision" readout={s.colors + " bits"} min={1} max={8} value={s.colors}
          disabled={bw || clean} onChange={v => patch({ colors: v })} />
        <Slider id="grad" label="Gradient step" readout={String(s.grad)} min={0} max={128} value={s.grad}
          disabled={bw || clean} onChange={v => patch({ grad: v })} />
      </Group>

      <Slider id="minArea" label="Min shape area" readout={fmtNum(minAreaVal(s)) + " px²"} min={0} max={11} value={s.minArea}
        onChange={v => patch({ minArea: v })} />

      <Slider id="corner" label="Corner threshold" readout={s.corner + "°"} min={0} max={180} value={s.corner}
        onChange={v => patch({ corner: v })} />

      <Slider id="seglen" label="Curve smoothness" readout={s.seglen.toFixed(1)} min={3.5} max={10} step={0.5}
        value={s.seglen} hidden={smoothEng} onChange={v => patch({ seglen: v })} />

      <Slider id="lineTol" label="Line fit tolerance" readout={fmtNum(lineTolVal(s)) + " px"} min={0} max={9}
        value={s.lineTol} hidden={!smoothEng} onChange={v => patch({ lineTol: v })} />

      <Select id="curve" label="Curve fitting" value={s.curve} hidden={smoothEng} onChange={v => patch({ curve: v })} options={[
        { value: "spline", label: "Smooth curves (spline)" },
        { value: "polygon", label: "Straight lines (polygon)" },
        { value: "none", label: "Pixel edges" }
      ]} />

      <Select id="layering" label="Shape layering" value={s.layering} disabled={bw} hidden={smoothEng}
        onChange={v => patch({ layering: v })} options={[
          { value: "stacked", label: "Stacked · no gaps, easy to edit" },
          { value: "cutout", label: "Cutout · shapes never overlap" }
        ]} />

      <Select id="maxSize" label="Detail level" value={String(s.maxSize)} onChange={v => patch({ maxSize: +v })} options={[
        { value: "2", label: "Fast · up to 2 MP" },
        { value: "5", label: "Balanced · up to 5 MP" },
        { value: "9", label: "Fine · up to 9 MP" },
        { value: "18", label: "Max detail · up to 18 MP (slower)" },
        { value: "0", label: "Original pixels only" }
      ]} />

      <Group>
        <Check id="upscale" label="Sub-pixel upscaling (cleaner edges)" checked={s.upscale} onChange={v => patch({ upscale: v })} />
        <Check id="denoise" label="Clean JPEG noise" checked={s.denoise} onChange={v => patch({ denoise: v })} />
        <Check id="dropBg" label="Keep transparent areas empty" checked={s.dropBg} onChange={v => patch({ dropBg: v })} />
      </Group>

      <Section id="palSect" title="Custom palette" hint="snap · remap · remove" open={palOpen}>
        <p className="hint">
          One entry per color, separated by <code>;</code>. <code>#RRGGBB</code> snaps nearby colors to it,
          {" "}<code>-&gt; #RRGGBB</code> remaps them, <code>~ 0.1</code> sets how far it reaches (0–2),
          and a target ending in <code>00</code> removes them.
        </p>
        <textarea className="pal" id="customPal" spellCheck={false} value={s.customPal}
          placeholder="#ffffff ~ 0.05; #e01020 -> #c8102e; #fffffe -> #ffffff00 ~ 0.02"
          onChange={e => patch({ customPal: e.target.value })} />
        <span className={"note" + (palNoteErr ? " err" : "")} id="palNote">{palNote}</span>
      </Section>

      <Section id="shapeSect" title="Shapes" open>
        <Select id="stacking" label="Shape stacking" value={s.stacking} hidden={!smoothEng}
          onChange={v => patch({ stacking: v })} options={[
            { value: "cutouts", label: "Cutouts · shapes never overlap" },
            { value: "stacked", label: "Stacked · shapes sit on top of each other" }
          ]} />

        <Select id="drawStyle" label="Draw style" value={s.drawStyle} onChange={v => patch({ drawStyle: v })} options={[
          { value: "fill_shapes", label: "Fill shapes" },
          { value: "stroke_shapes", label: "Stroke shapes · outlines in shape color" },
          { value: "stroke_edges", label: "Stroke edges · line drawing" }
        ]} />

        <Group hidden={!fillStyle}>
          <Check id="gapOn" label="Gap filler (hides hairline seams)" checked={s.gapOn} onChange={v => patch({ gapOn: v })} />
          <label className="label" htmlFor="gapWidth">Gap filler width <output>{fmtPx(s.gapWidth)}</output></label>
          <input type="range" id="gapWidth" min={0} max={5} step={0.25} value={s.gapWidth} disabled={!s.gapOn}
            onChange={e => patch({ gapWidth: +e.target.value })} />
          <Check id="gapNonScaling" label="Same width at every zoom" checked={s.gapNonScaling} disabled={!s.gapOn}
            onChange={v => patch({ gapNonScaling: v })} />
        </Group>

        <Group hidden={fillStyle}>
          <label className="label" htmlFor="strokeWidth">Stroke width <output>{fmtPx(s.strokeWidth)}</output></label>
          <input type="range" id="strokeWidth" min={0.25} max={5} step={0.25} value={s.strokeWidth}
            onChange={e => patch({ strokeWidth: +e.target.value })} />
          <Check id="strokeNonScaling" label="Same width at every zoom" checked={s.strokeNonScaling}
            onChange={v => patch({ strokeNonScaling: v })} />
          <Check id="strokeOverride" label="One color for all lines" checked={s.strokeOverride} onChange={v => patch({ strokeOverride: v })}>
            <input type="color" id="strokeColor" value={s.strokeColor} aria-label="Line color" disabled={!s.strokeOverride}
              onChange={e => patch({ strokeColor: e.target.value })} />
          </Check>
        </Group>

        <Select id="groupBy" label="Group by" value={s.groupBy} onChange={v => patch({ groupBy: v })} options={[
          { value: "none", label: "None · every shape is its own path" },
          { value: "color", label: "Color · one group per color" }
        ]} />
      </Section>

      <Section id="curveSect" title="Curves" hidden={!smoothEng}>
        <Check id="allowArcs" label="Fit circles & ellipses as true arcs" checked={s.allowArcs} onChange={v => patch({ allowArcs: v })} />
        <Check id="flatten" label="Flatten circles & ellipses to plain curves" checked={s.flatten} disabled={!s.allowArcs}
          onChange={v => patch({ flatten: v })} />
        <p className="hint">Round shapes such as beads and dots come out as exact circles or ellipses. Flatten them if another app can't edit arcs.</p>
      </Section>

      <Section id="outSect" title="Output">
        <Select id="fmt" label="File format" value={s.fmt} onChange={v => patch({ fmt: v })} options={[
          { value: "svg", label: "SVG" },
          { value: "pdf", label: "PDF" },
          { value: "eps", label: "EPS" },
          { value: "png", label: "PNG" },
          { value: "dxf", label: "DXF · for CAD and cutting machines" }
        ]} />

        <Select id="dxfLevel" label="DXF curves" value={s.dxfLevel} hidden={s.fmt !== "dxf"} onChange={v => patch({ dxfLevel: v })} options={[
          { value: "lines_and_arcs", label: "Lines and arcs · circles stay circles" },
          { value: "lines_only", label: "Lines only · most compatible" }
        ]} />

        <Select id="pdfComp" label="PDF compression" value={s.pdfComp} hidden={s.fmt !== "pdf"} onChange={v => patch({ pdfComp: v })} options={[
          { value: "compressed", label: "Compressed · smaller file" },
          { value: "uncompressed", label: "Uncompressed · readable path data" }
        ]} />

        <Group hidden={s.fmt !== "svg"}>
          <label className="label" htmlFor="svgVer">SVG version</label>
          <select id="svgVer" value={s.svgVer} onChange={e => patch({ svgVer: e.target.value as Settings["svgVer"] })}>
            <option value="svg_1_1">SVG 1.1</option>
            <option value="svg_1_0">SVG 1.0</option>
            <option value="svg_tiny_1_2">SVG Tiny 1.2</option>
          </select>
          <Check id="adobe" label="Adobe Illustrator compatibility" checked={s.adobe} onChange={v => patch({ adobe: v })} />
        </Group>

        <Select id="aa" label="PNG edges" value={s.aa} hidden={s.fmt !== "png"} onChange={v => patch({ aa: v })} options={[
          { value: "anti_aliased", label: "Anti-aliased" },
          { value: "aliased", label: "Aliased · hard pixel edges" }
        ]} />

        <Group>
          <div className="label">Output size</div>
          <div className="row2">
            <input type="number" id="outW" min={0} step="any" placeholder="Width" aria-label="Output width"
              value={s.outW} onChange={e => patch({ outW: e.target.value })} />
            <input type="number" id="outH" min={0} step="any" placeholder="Height" aria-label="Output height"
              value={s.outH} onChange={e => patch({ outH: e.target.value })} />
          </div>
          <div className="row2">
            <select id="outUnit" aria-label="Unit" value={s.outUnit} onChange={e => patch({ outUnit: e.target.value as Settings["outUnit"] })}>
              <option value="none">No unit</option>
              <option value="px">px</option>
              <option value="pt">pt</option>
              <option value="in">in</option>
              <option value="cm">cm</option>
              <option value="mm">mm</option>
            </select>
            <input type="number" id="outScale" min={0} step="any" placeholder="Scale ×" aria-label="Scale factor"
              value={s.outScale} onChange={e => patch({ outScale: e.target.value })} />
          </div>
          <select id="aspect" aria-label="Aspect ratio" value={s.aspect} onChange={e => patch({ aspect: e.target.value as Settings["aspect"] })}>
            <option value="preserve_inset">Keep proportions · fit inside</option>
            <option value="preserve_overflow">Keep proportions · fill and crop</option>
            <option value="stretch">Stretch to fit</option>
          </select>
          <div className="row2">
            <select id="alignX" aria-label="Horizontal alignment" value={s.alignX} onChange={e => patch({ alignX: e.target.value as Settings["alignX"] })}>
              <option value="Min">Align left</option>
              <option value="Mid">Align center</option>
              <option value="Max">Align right</option>
            </select>
            <select id="alignY" aria-label="Vertical alignment" value={s.alignY} onChange={e => patch({ alignY: e.target.value as Settings["alignY"] })}>
              <option value="Min">Align top</option>
              <option value="Mid">Align middle</option>
              <option value="Max">Align bottom</option>
            </select>
          </div>
          <div className="row2">
            <input type="number" id="inDpi" min={1} step="any" placeholder="Input DPI (72)" aria-label="Input DPI"
              value={s.inDpi} onChange={e => patch({ inDpi: e.target.value })} />
            <input type="number" id="outDpi" min={1} step="any" placeholder="PNG DPI (72)" aria-label="Output DPI for PNG"
              value={s.outDpi} onChange={e => patch({ outDpi: e.target.value })} />
          </div>
          <p className="hint">Leave empty to keep the image's own size. Scale overrides width and height. With a physical unit and no size, the input DPI sets how big each pixel is; the PNG DPI sets pixels per inch for PNG output.</p>
        </Group>
      </Section>
    </aside>
  );
}
