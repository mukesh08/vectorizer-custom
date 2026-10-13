/* Drives the tracer: debounces setting changes, keeps one run alive at a time, reuses the last
   color analysis when only tracing options changed, and reports progress for the overlay. */
import { useCallback, useEffect, useRef, useState } from "react";
import {
  prepKey, prepare, traceIT, traceShapes, traceVT, tracesShapes,
  type Prepared, type Runner, type SourceImage, type TracedResult
} from "../engine/pipeline";
import { initVT } from "../engine/vtracer/vtracer_webapp.js";
import { TRACE_KEYS, type Settings } from "../settings";

export type Note = { text: string; err: boolean };

/** Which engine the browser could actually start. */
type EngineState = "loading" | "vtracer" | "imagetracer" | "none";

export interface VectorizerState {
  result: TracedResult | null;
  /** Progress text while tracing, null when idle. */
  busy: string | null;
  note: Note;
  /** How long the last trace took, in ms. */
  ms: number | undefined;
  setNote: (text: string, err?: boolean) => void;
  /** Makes the next tracing-option change skip the debounce (used by palette edits). */
  traceNow: () => void;
}

const traceSignature = (s: Settings): string => JSON.stringify(TRACE_KEYS.map(k => s[k]));

/** Copies the cached analysis, because tracing relabels and despeckles it in place. */
const cloneForTrace = (p: Prepared): Prepared => ({
  ...p,
  idx: p.idx ? p.idx.slice() : null,
  pal: p.pal ? p.pal.map(c => c.slice()) : null
});

export function useVectorizer(source: SourceImage | null, settings: Settings): VectorizerState {
  const [result, setResult] = useState<TracedResult | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [note, setNoteState] = useState<Note>({ text: "", err: false });
  const [ms, setMs] = useState<number | undefined>(undefined);

  const job = useRef(0);
  const runner = useRef<Runner | null>(null);
  const cache = useRef<{ key: string; src: SourceImage; prep: Prepared } | null>(null);
  const engine = useRef<EngineState>("loading");
  const engineReady = useRef<Promise<void> | null>(null);
  // the settings a trace last ran with, so the debounce can tell what the user just touched
  const lastTrace = useRef<Settings | null>(null);
  const lastSource = useRef<SourceImage | null>(null);

  const setNote = useCallback((text: string, err = false) => setNoteState({ text, err }), []);

  if (!engineReady.current) {
    engineReady.current = initVT().then(() => { engine.current = "vtracer"; }).catch((err: unknown) => {
      console.warn("VTracer unavailable, falling back to imagetracer.js", err);
      engine.current = "imagetracer";
    });
  }

  const run = useCallback(async (src: SourceImage, s: Settings) => {
    const id = ++job.current;
    const alive = () => id === job.current;
    if (runner.current) { runner.current.stop(); runner.current = null; }
    setBusy("Preparing image…"); setNote("");
    await engineReady.current;
    if (!alive()) return;
    await new Promise(r => setTimeout(r, 20));      // let the overlay paint
    const t0 = performance.now();
    const stage = (t: string) => { if (alive()) setBusy(t); };

    // palette edits and tracing options reuse the last color analysis instead of redoing it
    const key = prepKey(src, s);
    let prep: Prepared | null;
    if (cache.current && cache.current.key === key && cache.current.src === src) {
      prep = cache.current.prep;
    } else {
      try { prep = await prepare(src, s, stage, alive); }
      catch (err) {
        console.error(err);
        if (alive()) { setBusy(null); setNote("This image is too large for the chosen detail level. Pick a lower one.", true); }
        return;
      }
      if (!prep || !alive()) { if (alive()) setBusy(null); return; }
      cache.current = { key, src, prep };
    }

    try {
      let res: TracedResult | null;
      if (tracesShapes(s, prep)) {
        res = await traceShapes(cloneForTrace(prep), s, stage, alive);
      } else if (engine.current === "vtracer") {
        res = await traceVT(prep, s, r => { runner.current = r; }, stage, alive);
      } else if (engine.current === "imagetracer") {
        res = await traceIT(prep, s, alive);
      } else {
        setBusy(null);
        setNote("The tracing engine couldn't start in this browser. Try a current version of Chrome, Edge, Firefox or Safari.", true);
        return;
      }
      if (!res || !alive()) { if (alive()) setBusy(null); return; }
      setResult(res);
      setMs(performance.now() - t0);
      setBusy(null);
    } catch (err) {
      console.error(err);
      if (alive()) { setBusy(null); setNote("Tracing failed on this image. Try a lower detail level.", true); }
    }
  }, [setNote]);

  // set by the palette editor: its next change traces at once instead of waiting out the debounce
  const jumpQueue = useRef(false);
  const traceNow = useCallback(() => { jumpQueue.current = true; }, []);

  const signature = traceSignature(settings);
  useEffect(() => {
    if (!source) return;
    const prev = lastTrace.current, prevSrc = lastSource.current;
    // a new image or a new preset re-traces at once; typing in the palette box waits longest
    let delay = 400;
    if (!prev || prevSrc !== source || prev.preset !== settings.preset || jumpQueue.current) delay = 0;
    else if (prev.customPal !== settings.customPal) delay = 700;
    jumpQueue.current = false;
    lastTrace.current = settings; lastSource.current = source;
    const t = setTimeout(() => void run(source, settings), delay);
    return () => clearTimeout(t);
    // settings is covered by `signature`: only tracing options may restart a trace
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [source, signature, run]);

  useEffect(() => () => { job.current++; runner.current?.stop(); }, []);

  return { result, busy, note, ms, setNote, traceNow };
}
