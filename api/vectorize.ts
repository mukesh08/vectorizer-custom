/* Server-side proxy to the Vectorizer.AI API.
 *
 * This exists for one reason: the upstream API authenticates with HTTP Basic, where the password
 * is the account's API Secret. A static browser app cannot hold that secret — anything shipped in
 * the bundle is readable by anyone who opens devtools, and whoever reads it can spend the
 * account's credits. So the browser talks to this function, and only this function holds the key.
 *
 * Wire format on THIS endpoint: the image is the raw request body and every option is a query
 * parameter. That is deliberate. It means the function never has to parse multipart, it rebuilds
 * the upstream form itself, and so a caller cannot smuggle a field through — the request it
 * receives and the request it sends share no serialisation.
 *
 * Two guards matter here, because the deployed URL is public and unauthenticated:
 *
 *   1. Mode is decided by the SERVER, not the caller. It defaults to `test`, which upstream bills
 *      at 0 credits. Paid modes (`preview` 0.2, `production` 1.0 per image) stay refused until the
 *      operator sets VECTORIZER_ALLOW_PAID=1 deliberately.
 *   2. Only parameters on FORWARDABLE below are passed upstream. An unknown one is dropped rather
 *      than relayed, so a caller cannot reach parameters the UI does not expose — notably
 *      `image.url`, which would make this function fetch arbitrary URLs, and
 *      `policy.retention_days`, which would leave the image on someone else's disk.
 *
 * Runtime note: this uses the Node signature, (req, res), not the Web Request/Response one.
 * Returning a Response object from a Vercel Node function does nothing — the adapter ignores it,
 * res.end() is never called, and the request hangs until the platform kills it.
 *
 * Env: VECTORIZER_API_ID, VECTORIZER_API_SECRET, optional VECTORIZER_ALLOW_PAID=1.
 * Parameter names and enums come from https://vectorizer.ai/api/openapi.json (OpenAPI 3.0.3),
 * which also declares the canonical base URL below — the HTML docs quote an older host.
 */
import type { IncomingMessage, ServerResponse } from "node:http";

/** Vercel reads this. Vectorizing is slow, so ask for more than the 10s default. */
export const config = { maxDuration: 60 };

const UPSTREAM = "https://api.vectorizer.ai/api/v1/vectorize";
/** Kept under the platform's own function timeout, so we fail with a message rather than a hang. */
const UPSTREAM_TIMEOUT_MS = 50_000;
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

function sendJSON(res: ServerResponse, status: number, body: unknown): void {
  res.statusCode = status;
  res.setHeader("content-type", "application/json");
  res.setHeader("cache-control", "no-store");
  res.end(JSON.stringify(body));
}

/* Collects the raw request body, refusing anything over the cap without buffering all of it.
   Over the limit it stops collecting but keeps DRAINING: destroying the request instead would
   close the socket before the 413 could be written, and the caller would see a dropped
   connection rather than the reason. */
function readBody(req: IncomingMessage, limit: number): Promise<Buffer | "too-large"> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let total = 0;
    let over = false;
    req.on("data", (c: Buffer) => {
      if (over) return;
      total += c.length;
      if (total > limit) { over = true; chunks.length = 0; return; }
      chunks.push(c);
    });
    req.on("end", () => resolve(over ? "too-large" : Buffer.concat(chunks)));
    req.on("error", reject);
  });
}

export default async function handler(req: IncomingMessage, res: ServerResponse): Promise<void> {
  if (req.method !== "POST") { sendJSON(res, 405, { error: "Use POST." }); return; }

  const id = process.env.VECTORIZER_API_ID;
  const secret = process.env.VECTORIZER_API_SECRET;
  if (!id || !secret) {
    sendJSON(res, 503, {
      error: "Cloud tracing is not configured on this deployment.",
      message: "Set VECTORIZER_API_ID and VECTORIZER_API_SECRET in the project's environment variables."
    });
    return;
  }

  const query = new URL(req.url ?? "/", "https://placeholder.invalid").searchParams;

  // the client asks for a mode; this server decides whether it may have it
  const asked = query.get("mode") ?? "test";
  let mode: string;
  if (FREE_MODES.has(asked)) {
    mode = asked;
  } else if (PAID_MODES.has(asked)) {
    if (process.env.VECTORIZER_ALLOW_PAID !== "1") {
      sendJSON(res, 403, {
        error: "Paid tracing modes are disabled on this deployment.",
        message: `"${asked}" spends account credits. Set VECTORIZER_ALLOW_PAID=1 to enable it, or use test mode.`
      });
      return;
    }
    mode = asked;
  } else {
    sendJSON(res, 400, { error: `Unknown mode "${asked}".` });
    return;
  }

  const tooBig = {
    error: "Image too large for the proxy.",
    message: `This endpoint accepts up to ${Math.floor(MAX_IMAGE_BYTES / 1e6)}MB. Lower the detail level, or crop first.`
  };
  // when the caller declares its size, refuse before reading anything at all
  const declared = Number(req.headers["content-length"] ?? NaN);
  if (Number.isFinite(declared) && declared > MAX_IMAGE_BYTES) { sendJSON(res, 413, tooBig); return; }

  const body = await readBody(req, MAX_IMAGE_BYTES).catch(() => null);
  if (body === null) { sendJSON(res, 400, { error: "Could not read the request body." }); return; }
  if (body === "too-large") { sendJSON(res, 413, tooBig); return; }
  if (body.length === 0) { sendJSON(res, 400, { error: "The request body is empty; send the image bytes." }); return; }

  const form = new FormData();
  form.set("image", new Blob([new Uint8Array(body)], { type: "image/png" }), "image.png");
  form.set("mode", mode);
  for (const [key, value] of query.entries()) {
    if (key === "mode") continue;
    if (!FORWARDABLE.has(key)) continue;            // drop, don't relay
    if (value !== "") form.set(key, value);
  }

  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), UPSTREAM_TIMEOUT_MS);
  let upstream: Response;
  try {
    upstream = await fetch(UPSTREAM, {
      method: "POST",
      headers: { authorization: "Basic " + Buffer.from(`${id}:${secret}`).toString("base64") },
      body: form,
      signal: ac.signal
    });
  } catch (err) {
    const aborted = err instanceof Error && err.name === "AbortError";
    sendJSON(res, aborted ? 504 : 502, {
      error: aborted ? "Vectorizer.AI did not respond in time." : "Could not reach Vectorizer.AI.",
      message: aborted
        ? `No response within ${UPSTREAM_TIMEOUT_MS / 1000}s. Try a lower detail level.`
        : "Upstream request failed."
    });
    return;
  } finally {
    clearTimeout(timer);
  }

  const buf = Buffer.from(await upstream.arrayBuffer());

  if (!upstream.ok) {
    // upstream errors are JSON {error:{status,code,message}}, but the docs warn they may not be
    const text = buf.toString("utf8");
    let message = text.slice(0, 500);
    let code: number | undefined;
    try {
      const parsed = JSON.parse(text) as { error?: { message?: string; code?: number } };
      if (parsed.error?.message) message = parsed.error.message;
      code = parsed.error?.code;
    } catch { /* not JSON; keep the raw snippet */ }
    sendJSON(res, upstream.status, {
      error: "Vectorizer.AI rejected the request.",
      status: upstream.status,
      code,
      message,
      retryAfter: upstream.headers.get("retry-after") ?? undefined
    });
    return;
  }

  // pass the result straight through, plus the headers that say what it cost
  res.statusCode = 200;
  res.setHeader("content-type", upstream.headers.get("content-type") ?? "image/svg+xml");
  res.setHeader("cache-control", "no-store");
  for (const h of ["x-credits-charged", "x-credits-calculated", "x-image-token"]) {
    const v = upstream.headers.get(h);
    if (v) res.setHeader(h, v);
  }
  res.setHeader("x-vectorizer-mode", mode);
  res.setHeader("access-control-expose-headers", "x-credits-charged, x-credits-calculated, x-vectorizer-mode");
  res.end(buf);
}
