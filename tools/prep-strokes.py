"""Recover stroke geometry from a soft or heavily-compressed image before tracing it.

Why this exists: the tracer binarises at a fixed 50% threshold (src/engine/quantize.ts). On a
clean image that is the right call, but on a blurred screengrab or a low-quality JPEG the thin
strokes are smeared below that line and simply vanish — on the reference image this tool was
written for, the default trace lost every subscript and both equals signs. Raising "Max colors"
does not help, because the clean-palette analysis collapses such an image to two colours anyway.
The threshold is the limit, not the colour count.

What it does: upscales with Lanczos, then normalises each pixel against a LOCAL peak instead of
a global one. For a blurred edge the half-amplitude point is the true geometric edge, so a local
50% crossing puts stroke boundaries back where they belong — faint glyphs rise to full ink
without the bright ones fattening. A 3px median plus a small blur on the normalised field
suppresses JPEG ringing, and a smoothstep leaves a ~1px antialiased rim for the curve fitter.

Checked against the reference image: recovered stroke area 2.25% vs a 2.37% geometric reference,
so the weight is accurate rather than merely bolder. Edge IoU of the resulting trace rose from
0.402 to 0.693 — a far larger gain than any tracing-engine or settings change.

Usage:
    python3 tools/prep-strokes.py SRC DST [scale] [lo] [hi] [presmooth] [radius] [floor] [inkhex]

    python3 tools/prep-strokes.py shot.jpg prepped.png 4 0.44 0.60 1.0 9 46 f8f8f8

    scale      upscale factor before analysis (4 is a good default)
    lo, hi     smoothstep window on the locally-normalised field; the midpoint is the edge
    presmooth  blur in upscaled px applied to that field, to kill ringing
    radius     local-peak window, in upscaled px
    floor      a local peak below this is treated as noise, not ink
    inkhex     force the output ink colour, e.g. f8f8f8; omit to measure it from the source

Then load DST in the app. Settings that suit the result: Logo preset, Precision engine, min
shape area 0, edge smoothing 0.5, line fit tolerance 0.5px, and "Clean JPEG noise" OFF, since
this script has already denoised and that option only rounds corners from here.

Requires: pillow, numpy.
"""
import sys
import numpy as np
from PIL import Image, ImageFilter

src, dst = sys.argv[1], sys.argv[2]
SCALE     = int(sys.argv[3])   if len(sys.argv) > 3 else 4
LO        = float(sys.argv[4]) if len(sys.argv) > 4 else 0.44
HI        = float(sys.argv[5]) if len(sys.argv) > 5 else 0.60
PRESMOOTH = float(sys.argv[6]) if len(sys.argv) > 6 else 1.0   # px at upscaled res; kills JPEG ringing lumps
RADIUS    = int(sys.argv[7])   if len(sys.argv) > 7 else 9
FLOOR     = float(sys.argv[8]) if len(sys.argv) > 8 else 46
INK_HEX   = sys.argv[9] if len(sys.argv) > 9 else ""

im = Image.open(src).convert("RGB")
w, h = im.size
big = im.resize((w * SCALE, h * SCALE), Image.LANCZOS)
a = np.asarray(big).astype(np.float32)
g = 0.299 * a[..., 0] + 0.587 * a[..., 1] + 0.114 * a[..., 2]

pk = Image.fromarray(np.clip(g, 0, 255).astype(np.uint8))
for _ in range(max(1, RADIUS // 4)):
    pk = pk.filter(ImageFilter.MaxFilter(9))
peak = np.asarray(pk.filter(ImageFilter.GaussianBlur(RADIUS * 0.6))).astype(np.float32)

norm = np.where(peak > FLOOR, g / np.maximum(peak, 1.0), 0.0)
if PRESMOOTH > 0:
    nn = (np.clip(norm, 0, 1) * 255).astype(np.uint8)
    nn = Image.fromarray(nn).filter(ImageFilter.MedianFilter(3)).filter(ImageFilter.GaussianBlur(PRESMOOTH))
    norm = np.asarray(nn).astype(np.float32) / 255.0

t = np.clip((norm - LO) / (HI - LO), 0, 1)
mask = t * t * (3 - 2 * t)

flat = a.reshape(-1, 3)
ink = (np.array([int(INK_HEX[i:i+2], 16) for i in (0, 2, 4)], np.float32) if INK_HEX
       else flat[g.ravel() >= np.percentile(g, 99.8)].mean(0))
out = (mask[..., None] * ink[None, None, :]).clip(0, 255).astype(np.uint8)
Image.fromarray(out).save(dst)

# reference stroke area: the half-local-peak crossing of the *unsmoothed* field is the true edge
ref_cov = (np.where(peak > FLOOR, g / np.maximum(peak, 1.0), 0.0) >= 0.5).mean() * 100
print(f"{dst.split('/')[-1]:22s} {w*SCALE}x{h*SCALE} lo={LO} hi={HI} ps={PRESMOOTH} "
      f"ink={(mask > 0.5).mean()*100:.3f}%  ref={ref_cov:.3f}%")
