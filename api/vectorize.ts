/* Server-side proxy to the Vectorizer.AI API.
 *
 * This exists for one reason: the upstream API authenticates with HTTP Basic, where the password
 * is the account's API Secret. A static browser app cannot hold that secret — anything shipped in
 * the bundle is readable by anyone who opens devtools, and whoever reads it can spend the
 * account's credits. So the browser talks to this function, and only this function holds the key.
 *
 * Two guards matter here, because the deployed URL is public and unauthenticated:
 *
 *   1. Mode is decided by the SERVER, not the caller. It defaults to `test`, which upstream bills
 *      at 0 credits. Paid modes (`preview` 0.2, `production` 1.0 per image) stay refused until the
 *      operator sets VECTORIZER_ALLOW_PAID=1 deliberately.
 *   2. Only parameters on FORWARDABLE below are passed upstream. An unknown field is dropped
 *      rather than relayed, so a caller cannot reach parameters the UI does not expose — notably
 *      `policy.retention_days`, which would leave the image on someone else's disk.
 *
 * Env: VECTORIZER_API_ID, VECTORIZER_API_SECRET, optional VECTORIZER_ALLOW_PAID=1.
 * Parameter names and enums come from https://vectorizer.ai/api/openapi.json (OpenAPI 3.0.3),
 * which also declares the canonical base URL below — the HTML docs quote an older host.
 */

const UPSTREAM = "https://api.vectorizer.ai/api/v1/vectorize";
/** The docs ask for an idle timeout of at least 180s; large images genuinely take that long. */
const UPSTREAM_TIMEOUT_MS = 180_000;
/** Vercel caps a serverless request body at ~4.5MB, below the API's own 30MiB ceiling. */
const MAX_IMAGE_BYTES = 4_000_000;

/** Upstream fields this proxy is willing to relay. Anything absent here is silently dropped. */
const FORWARDABLE = new Set([
  "input.max_pixels",
  "output.file_format",
  "output.svg.version",
  "output.svg.adobe_compatibility_mode",
  "output.svg.fixed_size",
  "output.dxf.compatibility_level",
  "output.pdf.compression_mode",
  "output.bitmap.anti_aliasing_mode",
  "output.draw_style",
  "output.shape_stacking",
  "output.group_by",
  "output.gap_filler.enabled",
  "output.gap_filler.stroke_width",
  "output.gap_filler.non_scaling_stroke",
  "output.strokes.stroke_width",
  "output.strokes.non_scaling_stroke",
  "output.strokes.use_override_color",
  "output.strokes.override_color",
  "output.curves.line_fit_tolerance",
  "output.curves.allowed.circular_arc",
  "output.curves.allowed.elliptical_arc",
  "output.curves.allowed.quadratic_bezier",
  "output.curves.allowed.cubic_bezier",
  "output.parameterized_shapes.flatten",
  "output.size.scale",
  "output.size.width",
  "output.size.height",
  "output.size.unit",
  "output.size.aspect_ratio",
  "output.size.align_x",
  "output.size.align_y",
  "output.size.input_dpi",
  "output.size.output_dpi",
  "processing.max_colors",
  "processing.palette",
  "processing.shapes.min_area_px"
]);

const FREE_MODES = new Set(["test", "test_preview"]);
const PAID_MODES = new Set(["preview", "production"]);

const json = (status: number, body: unknown): Response =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

/** Upstream errors are JSON `{error:{status,code,message}}`, but the docs warn they may not be. */
async function upstreamError(res: Response): Promise<Response> {
  const text = await res.text().catch(() => "");
  let message = text.slice(0, 500);
  let code: number | undefined;
  try {
    const parsed = JSON.parse(text) as { error?: { message?: string; code?: number } };
    if (parsed.error?.message) message = parsed.error.message;
    code = parsed.error?.code;
  } catch { /* not JSON; keep the raw snippet */ }
  return json(res.status, {
    error: "Vectorizer.AI rejected the request.",
    status: res.status,
    code,
    message,
    retryAfter: res.headers.get("retry-after") ?? undefined
  });
}

export default async function handler(req: Request): Promise<Response> {
  if (req.method !== "POST") return json(405, { error: "Use POST." });

  const id = process.env.VECTORIZER_API_ID;
  const secret = process.env.VECTORIZER_API_SECRET;
  if (!id || !secret) {
    return json(503, {
      error: "Cloud tracing is not configured on this deployment.",
      message: "Set VECTORIZER_API_ID and VECTORIZER_API_SECRET in the project's environment variables."
    });
  }

  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return json(400, { error: "Expected multipart/form-data with an `image` part." });
  }

  const image = form.get("image");
  if (!(image instanceof Blob)) return json(400, { error: "Missing the `image` part." });
  if (image.size === 0) return json(400, { error: "The `image` part is empty." });
  if (image.size > MAX_IMAGE_BYTES) {
    return json(413, {
      error: "Image too large for the proxy.",
      message: `This endpoint accepts up to ${Math.floor(MAX_IMAGE_BYTES / 1e6)}MB; got ${(image.size / 1e6).toFixed(1)}MB. Lower the detail level, or crop first.`
    });
  }

  // the client asks for a mode; this server decides whether it may have it
  const asked = String(form.get("mode") ?? "test");
  let mode = "test";
  if (FREE_MODES.has(asked)) {
    mode = asked;
  } else if (PAID_MODES.has(asked)) {
    if (process.env.VECTORIZER_ALLOW_PAID !== "1") {
      return json(403, {
        error: "Paid tracing modes are disabled on this deployment.",
        message: `"${asked}" spends account credits. Set VECTORIZER_ALLOW_PAID=1 to enable it, or use test mode.`
      });
    }
    mode = asked;
  } else {
    return json(400, { error: `Unknown mode "${asked}".` });
  }

  const upstreamForm = new FormData();
  upstreamForm.set("image", image, "image.png");
  upstreamForm.set("mode", mode);
  for (const [key, value] of form.entries()) {
    if (key === "image" || key === "mode") continue;
    if (!FORWARDABLE.has(key)) continue;            // drop, don't relay
    if (typeof value === "string" && value !== "") upstreamForm.set(key, value);
  }

  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), UPSTREAM_TIMEOUT_MS);
  let res: Response;
  try {
    res = await fetch(UPSTREAM, {
      method: "POST",
      headers: { authorization: "Basic " + Buffer.from(`${id}:${secret}`).toString("base64") },
      body: upstreamForm,
      signal: ac.signal
    });
  } catch (err) {
    const aborted = err instanceof Error && err.name === "AbortError";
    return json(aborted ? 504 : 502, {
      error: aborted ? "Vectorizer.AI did not respond in time." : "Could not reach Vectorizer.AI.",
      message: aborted ? `No response within ${UPSTREAM_TIMEOUT_MS / 1000}s.` : "Upstream request failed."
    });
  } finally {
    clearTimeout(timer);
  }

  if (!res.ok) return upstreamError(res);

  // pass the result straight through, plus the headers that tell the caller what it cost
  const out = new Headers({
    "content-type": res.headers.get("content-type") ?? "image/svg+xml",
    "cache-control": "no-store"
  });
  for (const h of ["x-credits-charged", "x-credits-calculated", "x-image-token"]) {
    const v = res.headers.get(h);
    if (v) out.set(h, v);
  }
  out.set("x-vectorizer-mode", mode);
  out.set("access-control-expose-headers", "x-credits-charged, x-credits-calculated, x-vectorizer-mode");
  return new Response(await res.arrayBuffer(), { status: 200, headers: out });
}
