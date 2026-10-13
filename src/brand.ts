/* One source of truth for the brand: anything that names, describes or colors the product
   reads from here, so the page, the logo, the favicon and the docs can't drift apart.
   The CSS custom properties in styles/tokens.css mirror `colors` — change both together. */

export const BRAND = {
  name: "Vectorizer Custom",
  /* Used where space is tight (document title prefix, file names). */
  short: "Vectorizer",
  tagline: "raster → SVG · runs in your browser",
  headline: "Turn any image into a clean, scalable vector",
  subhead: "PNG, JPG, GIF and WebP in. Smooth-curve SVG, PDF, EPS, PNG or DXF out — traced in your browser, nothing uploaded.",
  /* <meta name="description">, also the npm package description. */
  description: "Turn any JPG or PNG into a clean, scalable vector with smooth Bézier curves. Runs entirely in your browser.",

  colors: {
    accent: "#2f45d8",      // bezier blue: primary actions, curves, focus
    anchor: "#f0672a",      // anchor-point orange: selection, warnings, the split divider
    ink: "#161a2b",
    muted: "#5b6178",
    line: "#dcdfe8",
    bg: "#f3f4f7",
    panel: "#ffffff"
  },

  fonts: {
    display: "Poppins",     // headings, brand, section titles
    body: "Poppins",
    mono: "IBM Plex Mono"   // numbers, path data, file names
  },

  /* Output formats, in the order they appear in the UI. */
  formats: ["SVG", "PDF", "EPS", "PNG", "DXF"] as const,

  /* Shown in the footer; also the licence trail for the bundled engines. */
  credits: [
    { name: "VisionCortex VTracer", licence: "MIT / Apache-2.0", role: "Classic engine" },
    { name: "imagetracer.js", licence: "public domain", role: "fallback engine" }
  ]
} as const;

export type Brand = typeof BRAND;
