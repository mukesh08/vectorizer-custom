/* Every control on the rail, in one object. Settings split in two: tracing options re-run the
   tracer, output options only rebuild the file from the shapes it produced. */

export type PresetName = "logo" | "illus" | "photo" | "bw";
export type EngineName = "precision" | "native" | "smooth" | "vtracer";
export type Unit = "none" | "px" | "pt" | "in" | "cm" | "mm";

export interface Settings {
  preset: PresetName;
  engine: EngineName;
  palette: "clean" | "gradients";
  maxColors: number;
  smooth: number;
  /** Color precision, in bits (gradient mode). */
  colors: number;
  /** Gradient step (gradient mode). */
  grad: number;
  /** Index into MIN_AREAS. */
  minArea: number;
  corner: number;
  seglen: number;
  /** Index into LINE_TOLS. */
  lineTol: number;
  curve: "spline" | "polygon" | "none";
  layering: "stacked" | "cutout";
  /** Trace resolution cap, in megapixels; 0 = original pixels only. */
  maxSize: number;
  upscale: boolean;
  denoise: boolean;
  dropBg: boolean;
  customPal: string;

  stacking: "cutouts" | "stacked";
  drawStyle: "fill_shapes" | "stroke_shapes" | "stroke_edges";
  gapOn: boolean;
  gapWidth: number;
  gapNonScaling: boolean;
  strokeWidth: number;
  strokeNonScaling: boolean;
  strokeOverride: boolean;
  strokeColor: string;
  groupBy: "none" | "color";
  allowArcs: boolean;
  flatten: boolean;

  fmt: "svg" | "pdf" | "eps" | "png" | "dxf";
  dxfLevel: "lines_and_arcs" | "lines_only";
  pdfComp: "compressed" | "uncompressed";
  svgVer: "svg_1_1" | "svg_1_0" | "svg_tiny_1_2";
  adobe: boolean;
  aa: "anti_aliased" | "aliased";
  /** Size fields stay strings: empty means "keep the image's own size". */
  outW: string;
  outH: string;
  outUnit: Unit;
  outScale: string;
  aspect: "preserve_inset" | "preserve_overflow" | "stretch";
  alignX: "Min" | "Mid" | "Max";
  alignY: "Min" | "Mid" | "Max";
  inDpi: string;
  outDpi: string;
}

/** Option scales: slider index -> value. */
export const MIN_AREAS = [0, 0.125, 0.25, 0.5, 1, 2, 4, 9, 16, 25, 49, 100];
export const LINE_TOLS = [0.01, 0.025, 0.05, 0.1, 0.15, 0.2, 0.3, 0.5, 0.75, 1];

export const minAreaVal = (s: Settings): number => MIN_AREAS[s.minArea] ?? 1;
export const lineTolVal = (s: Settings): number => LINE_TOLS[s.lineTol] ?? 0.1;

type PresetValues = Pick<Settings, "palette" | "maxColors" | "colors" | "grad" | "corner" | "seglen" | "smooth" | "curve" | "layering" | "denoise"> & { minArea: number };

/** `minArea` here is the area in px², mapped back to its slider index when applied. */
export const PRESETS: Record<PresetName, PresetValues> = {
  logo:  { palette: "clean", maxColors: 12, colors: 6, grad: 16, minArea: 4, corner: 60, seglen: 5, smooth: 2, curve: "spline", layering: "stacked", denoise: true },
  illus: { palette: "clean", maxColors: 32, colors: 7, grad: 12, minArea: 25, corner: 60, seglen: 5, smooth: 1.5, curve: "spline", layering: "stacked", denoise: false },
  photo: { palette: "gradients", maxColors: 64, colors: 7, grad: 24, minArea: 9, corner: 180, seglen: 4, smooth: 0, curve: "spline", layering: "stacked", denoise: true },
  bw:    { palette: "clean", maxColors: 2, colors: 8, grad: 16, minArea: 2, corner: 60, seglen: 5, smooth: 1.5, curve: "spline", layering: "stacked", denoise: true }
};

export const PRESET_LABELS: { id: PresetName; name: string; hint: string }[] = [
  { id: "logo", name: "Logo", hint: "flat, few colors" },
  { id: "illus", name: "Illustration", hint: "more color, detail" },
  { id: "photo", name: "Photo", hint: "many colors" },
  { id: "bw", name: "Black & white", hint: "2 colors" }
];

export function applyPreset(s: Settings, p: PresetName): Settings {
  const v = PRESETS[p];
  return {
    ...s, preset: p,
    maxColors: v.maxColors, colors: v.colors, grad: v.grad, corner: v.corner, seglen: v.seglen, smooth: v.smooth,
    minArea: Math.max(0, MIN_AREAS.indexOf(v.minArea)),
    palette: v.palette, curve: v.curve, layering: v.layering, denoise: v.denoise
  };
}

const BASE: Settings = {
  preset: "illus", engine: "precision", palette: "clean", maxColors: 64, smooth: 1.5, colors: 7, grad: 12,
  minArea: 1, corner: 60, seglen: 4, lineTol: 6, curve: "spline", layering: "stacked",
  maxSize: 18, upscale: true, denoise: false, dropBg: true, customPal: "",
  stacking: "cutouts", drawStyle: "fill_shapes", gapOn: true, gapWidth: 2, gapNonScaling: true,
  strokeWidth: 1, strokeNonScaling: true, strokeOverride: false, strokeColor: "#000000", groupBy: "none",
  allowArcs: true, flatten: false,
  fmt: "svg", dxfLevel: "lines_and_arcs", pdfComp: "compressed", svgVer: "svg_1_1", adobe: false, aa: "anti_aliased",
  outW: "", outH: "", outUnit: "none", outScale: "", aspect: "preserve_inset", alignX: "Mid", alignY: "Mid",
  inDpi: "", outDpi: ""
};

/** The tool opens on the Illustration preset. */
export const DEFAULT_SETTINGS: Settings = applyPreset(BASE, "illus");

/** Changing any of these re-traces; everything else only rebuilds the output file. */
export const TRACE_KEYS: (keyof Settings)[] = [
  "preset", "engine", "palette", "maxColors", "smooth", "colors", "grad", "minArea", "corner", "seglen",
  "lineTol", "curve", "layering", "maxSize", "upscale", "denoise", "dropBg", "customPal", "stacking", "allowArcs"
];

/** True when the chosen engine fits smooth curves itself (rather than handing off to VTracer). */
export const usesSmoothEngine = (s: Settings): boolean =>
  (s.engine === "smooth" || s.engine === "precision" || s.engine === "native") &&
  (s.preset === "bw" || s.palette === "clean");

export const isNativeEngine = (s: Settings): boolean => s.engine === "native";
