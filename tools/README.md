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

## Cloud engine (Vectorizer.AI)

The **Cloud · Vectorizer.AI** engine is the one path in this app that leaves the device. It posts
the prepared image to `api/vectorize.ts`, which adds HTTP Basic credentials and forwards it to
`https://api.vectorizer.ai/api/v1/vectorize`.

### Setup

Set these in the Vercel project (Settings → Environment Variables), then redeploy:

| Variable | Required | Meaning |
|---|---|---|
| `VECTORIZER_API_ID` | yes | API Id — the Basic auth username |
| `VECTORIZER_API_SECRET` | yes | API Secret — the Basic auth password |
| `VECTORIZER_ALLOW_PAID` | no | `1` permits the credit-spending modes; anything else refuses them |

Without the first two, the engine reports that the deployment is not configured and nothing is
uploaded. With them, **test mode works and costs nothing.**

### Modes and cost

| Mode | Credits | Result |
|---|---|---|
| `test` (default) | 0 | heavily watermarked |
| `preview` | 0.2 | PNG at 4× input, light watermark |
| `production` | 1.0 | clean SVG |

### Why the secret cannot live in the browser

Upstream authenticates with HTTP Basic where the password *is* the API Secret. Anything in the
client bundle is readable by any visitor, and whoever reads it can spend the account's credits —
so the proxy exists purely to keep the key server-side.

**The proxy is itself public and unauthenticated.** Two guards follow from that, and both matter:

1. **The server picks the mode**, not the caller. It defaults to `test`, and refuses paid modes
   until `VECTORIZER_ALLOW_PAID=1` is set deliberately.
2. **Only fields on `FORWARDABLE` are relayed.** Unknown fields are dropped rather than passed on.
   This is not tidiness: `image.url` would make the function fetch arbitrary URLs on request
   (SSRF), and `policy.retention_days` would leave users' images on a third-party disk.

If you enable paid modes on a public deployment, put auth or rate limiting in front of the
endpoint first. Otherwise any visitor can spend your credits.

### Notes

- Vercel caps a serverless request body near 4.5MB, well under the API's own 30MiB limit, so the
  proxy rejects images above 4MB with a clear message. Lower the detail level or crop first.
- **The proxy uses the Node `(req, res)` signature, not the Web `Request`/`Response` one.**
  Returning a `Response` from a Vercel Node function does nothing: the adapter ignores it,
  `res.end()` is never called, and the request hangs until the platform kills it — which looks
  like a dead endpoint, not an error. This was found by calling the deployed URL and getting zero
  bytes after 120s.
- **The image is the raw request body; options are query parameters.** The proxy therefore never
  parses multipart and rebuilds the upstream form from an allowlist, so the request it receives
  and the request it sends share no serialisation and nothing can be smuggled through.
- Vectorizing is slow, so the function sets `maxDuration: 60` and gives up on upstream at 50s with
  a message. On a plan with a lower ceiling a large image may still be cut off by the platform
  before the function can answer.
- The engine always requests SVG; other formats are rebuilt locally from that result. Like
  VTracer and imagetracer it returns markup rather than fitted shapes, so PDF/EPS/DXF export
  stays unavailable on this engine.
- Parameter names, enums and the base URL come from the first-party spec at
  `https://vectorizer.ai/api/openapi.json`. Prefer it over the HTML docs, which quote an older
  host (`vectorizer.ai/api/v1`) that contradicts the spec's `api.vectorizer.ai/api/v1`.
