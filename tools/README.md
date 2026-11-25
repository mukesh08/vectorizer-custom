# tools

Helpers that sit beside the app rather than inside it. Nothing here is imported by the build.

## `prep-strokes.py` — stroke recovery for soft images

A pre-pass for images the tracer handles badly: blurred screengrabs, low-quality JPEGs, anything
where the strokes are thinner than the blur that smeared them.

```bash
python3 tools/prep-strokes.py shot.jpg prepped.png 4 0.44 0.60 1.0 9 46 f8f8f8
```

Needs `pillow` and `numpy`. The full argument list and the reasoning are in the script's
docstring.

**The problem it solves.** `binarize()` in `src/engine/quantize.ts` thresholds at a fixed 50%.
On a soft source, most of each thin stroke sits below that line, so it is dropped before any
engine sees it — and `minArea` despeckling then removes what survived. On the reference image
this was written for, a default trace lost every subscript and both equals signs.

**How.** Upscale, then normalise each pixel against a *local* peak rather than a global one. The
half-amplitude point of a blurred edge is its true geometric edge, so a local 50% crossing
restores stroke boundaries without fattening the glyphs that were already bright.

**Measured.** Recovered stroke area 2.25% against a 2.37% geometric reference. Edge IoU of the
resulting trace: 0.402 → 0.693. That is a bigger gain than switching engines or any settings
change, which is the point — prep matters more than engine choice on sources like this.

After prepping, trace with: Logo preset, Precision engine, min shape area `0`, edge smoothing
`0.5`, line fit tolerance `0.5 px`, **Clean JPEG noise off** (already denoised; it only rounds
corners from here).

## Outline / line-drawing export

Not a tool — a reminder that the app already does this, under **Shapes → Draw style**:

| Draw style | Output |
|---|---|
| `Fill shapes` | solid filled shapes (default) |
| `Stroke shapes · outlines in shape color` | each outline stroked in its own colour |
| `Stroke edges · line drawing` | every outline in one colour, from the Line color swatch |

These are *output* settings, so switching never re-traces. Two things to know:

- Every traced shape is stroked, **including the background**, so an image with a solid backdrop
  exports with a rectangle around it. Drop those paths afterwards if you want glyphs only.
- For outline work, prefer **Outline fitting → Fourier series** (`src/engine/fourier.ts`). It
  emits inherently smooth closed curves, so a thin stroke along them avoids the small wobbles
  the staircase-following fitter leaves. It costs file size: on the reference image, 161 KB at
  N=32 against 31 KB from the curve fitter.
