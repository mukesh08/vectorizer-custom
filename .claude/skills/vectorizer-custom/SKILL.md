---
name: vectorizer-custom
description: Run, drive and change Vectorizer Custom — the in-browser raster-to-vector app in this repo. Use when launching the dev server, verifying a change in a real browser, or working on the tracing engine, the output writers, the control rail, the compare viewport, the palette editor or the crop dialog.
---

# Vectorizer Custom

A React + TypeScript + Vite app that traces a raster image into vectors entirely in the
browser, then writes SVG, PDF, EPS, PNG or DXF. No server, no upload, no API key.

## Run it

Package manager is **yarn** (`yarn.lock` is the lockfile; there is no `package-lock.json`).

```bash
yarn dev          # http://localhost:5173/
yarn build        # tsc -b && vite build
yarn typecheck    # tsc -b
yarn lint         # oxlint
yarn preview      # serve dist/ — use this to check the wasm asset loads from a real file path
```

The dev server binds `[::1]:5173`. To stop it on Windows:
`netstat -ano | grep ":5173.*LISTENING"` then `taskkill //PID <pid> //F`.

## Verify it in a browser

There is no test suite. Changes are verified by driving the real app in headless Chrome.
`chromium-cli` is not installed here; use `playwright-core` against the **installed Chrome**
(`channel: "chrome"`) so no browser download is needed. Keep driver scripts in the scratchpad,
never in the repo:

```js
import { chromium } from "playwright-core";                 // yarn add --dev is NOT needed:
const browser = await chromium.launch({ channel: "chrome", headless: true });
const page = await (await browser.newContext({ viewport: { width: 1400, height: 1000 } })).newPage();
page.on("pageerror", e => console.log("PAGEERROR", e.message));
await page.goto("http://localhost:5173/");
await page.waitForSelector(".sample-link");
await page.click(".sample-link");                           // the app opens EMPTY — load something first
await page.waitForSelector("#sPaths");
await page.waitForFunction(() => document.getElementById("sPaths").textContent !== "—", null, { timeout: 180000 });
```

Install it once in a scratch dir: `npm i playwright-core`.

Things that trip up a driver script:

- **The app starts on the landing page.** `#sPaths`, `#fmt`, the rail — none of it exists until
  an image is loaded. Click `.sample-link`, or `setInputFiles("#file", …)`.
- **Rail sections are collapsed.** `#fmt`, `#dxfLevel`, `#svgVer` live inside `<details>`; open
  them first: `document.querySelectorAll("details.sect").forEach(d => d.open = true)`.
- **Waiting on a re-trace:** wait for `#busy` to become visible, then hidden. Checking `hidden`
  straight away races the 400 ms settings debounce.
- **A first trace of the sample takes ~4 s** on the Precision engine. Allow 180 s timeouts for
  larger images.

Stable hooks for assertions: `#sPaths #sColors #sSize #sDims #sTrace #sTime #sEngine`,
`#note`, `#fileName`, `#busy`, `#dlLabel`, `.bench`, `.landing`, `.modal`, `#cropBtn`.

## Layout

```
src/
  App.tsx              wiring only: composes hooks + components
  brand.ts             name, tagline, copy, colors, fonts  (mirrored by styles/tokens.css)
  settings.ts          every control in one Settings object; TRACE_KEYS marks the ones that re-trace
  sample.ts            built-in sample image (falls back to a generated badge)
  engine/              tracing. Pure TS, no React:
    pipeline.ts        prepare() → traceShapes() / traceVT() / traceIT(); the orchestration layer
    quantize.ts        clean palette + k-means; binarize() for B&W
    preprocess.ts      denoise, label smoothing, line consolidation, halo removal
    traceShared.ts     cutout tracer: each boundary traced once, shared by both sides
    traceSmooth.ts     stacked tracer: blurred mask + marching squares per color
    precision.ts       corner-aware fitting on the original pixel staircase
    curve.ts           Schneider cubic fitting, Taubin smoothing, ellipse fit
    raster.ts shapes.ts color.ts config.ts types.ts
    vtracer/           generated wasm-bindgen glue (do not hand-edit) + vtracer_bg.wasm
  output/              svg.ts vector.ts (EPS/PDF) dxf.ts png.ts size.ts palette.ts
  hooks/               useVectorizer (scheduling/cancellation), useOutputFile, useExport,
                       useImageSource, useImageDrop, useReference
  components/          brand/ landing/ rail/ stage/ palette/ crop/ ui/
  styles/              index.css imports tokens, base, rail, stage, palette, controls, landing, crop
```

## How it hangs together

1. `useImageSource` turns a picked/dropped/pasted file into `source`. Over the detail cap it
   parks the image in `pending` and `PreCrop` opens first.
2. `useVectorizer` debounces setting changes (400 ms; 0 for a new image or preset, 700 ms while
   typing in the palette box), cancels any run in flight, and caches the prepared pixels by
   `prepKey` so palette edits don't redo the color analysis.
3. `pipeline.prepare()` denoises, upscales and snaps to a flat palette; then either the in-house
   tracers (`traceShapes`) or VTracer/imagetracer produce a result.
4. `useOutputFile` rebuilds the file from the traced shapes whenever an *output* setting changes
   — no re-trace. That split is the whole reason format/size/draw-style changes feel instant.

## Gotchas

- **VTracer finds its DOM by element id.** `#vtCanvas` and `#vtSvg` must stay in `App.tsx`, and
  `prepare()` draws into `#vtCanvas`. Don't rename them.
- **The wasm is an asset,** imported as `./vtracer_bg.wasm?url`. Keep `initVT()`'s streaming →
  bytes fallback: some hosts serve `.wasm` with the wrong MIME type.
- **Tracing mutates the label map.** `traceShapes` relabels and despeckles `idx` in place, so the
  cached analysis is cloned per run (`cloneForTrace`). Keep that if you touch the cache.
- **New setting?** Add it to `Settings`, give it a default in `settings.ts`, and decide whether it
  belongs in `TRACE_KEYS`. Forgetting means it either never re-traces or re-traces on every edit.
- **Light theme only** — no dark mode by request. `color-scheme: light` is pinned in
  `styles/tokens.css`; don't reintroduce `prefers-color-scheme` blocks.
- `public/sample.jpg` is not committed, so the sample link falls back to a generated badge.

## Conventions

- Comments explain *why*, not what. The engine files carry the algorithm notes — keep them with
  the code they describe when refactoring.
- Brand strings and colors come from `src/brand.ts`; CSS reads the tokens. Don't hardcode either.
- No test framework is set up. "Verified" means: `yarn typecheck`, `yarn lint`, `yarn build`, plus
  a headless run of the paths the change touches.
