/* View: compare with unlimited zoom.
   The vector is shown as live inline SVG and zooming changes its viewBox, so the browser
   redraws the real curves at every zoom level: it stays sharp at 1 000% or 20 000%.
   Scroll or pinch to zoom around the pointer, drag to pan, drag the diamond to move the split. */
import { useCallback, useEffect, useImperativeHandle, useRef, type RefObject } from "react";
import type { SourceImage } from "../../engine/pipeline";

export type ViewMode = "lens" | "split" | "vec" | "raster";

export interface ViewportHandle {
  fit(): void;
  /** Zoom around the middle of the viewport by a factor. */
  zoomBy(f: number): void;
  zoomTo(s: number): void;
}

interface Props {
  source: SourceImage | null;
  /** The traced SVG, as markup. */
  svgText: string;
  /** Trace resolution, so the vector's viewBox can follow the image's pixel grid. */
  meta: { tw: number; th: number } | null;
  mode: ViewMode;
  lensSize: number;
  /** A reference SVG from another vectorizer, shown on the left instead of the original. */
  refText: string | null;
  showRef: boolean;
  onZoom: (percent: number) => void;
  handle: RefObject<ViewportHandle | null>;
}

const MAX_ZOOM = 200;                       // 200 screen px per image pixel

/** Puts an SVG string into a host as live, zoomable inline SVG. */
function mountSvg(host: HTMLElement, text: string, fallback: { w: number; h: number }): { node: SVGSVGElement; vb: number[] } | null {
  const doc = new DOMParser().parseFromString(text, "image/svg+xml");
  const root = doc.documentElement;
  if (!root || root.nodeName.toLowerCase() !== "svg") return null;
  const vbA = (root.getAttribute("viewBox") || "").split(/[\s,]+/).map(Number);
  const vb = vbA.length === 4 && vbA.every(isFinite)
    ? vbA
    : [0, 0, parseFloat(root.getAttribute("width") || "") || fallback.w, parseFloat(root.getAttribute("height") || "") || fallback.h];
  root.setAttribute("preserveAspectRatio", "none");
  root.removeAttribute("style");
  const node = document.importNode(root, true) as unknown as SVGSVGElement;
  host.replaceChildren(node);
  return { node, vb };
}

export default function Viewport({ source, svgText, meta, mode, lensSize, refText, showRef, onZoom, handle }: Props) {
  const viewport = useRef<HTMLDivElement>(null);
  const raster = useRef<HTMLImageElement>(null);
  const vecHost = useRef<HTMLDivElement>(null);
  const refHost = useRef<HTMLDivElement>(null);
  const divider = useRef<HTMLDivElement>(null);
  const lensRing = useRef<HTMLDivElement>(null);

  const view = useRef({ s: 1, x: 0, y: 0, split: 0.5, fitted: false });
  const vecSvg = useRef<SVGSVGElement | null>(null);
  const refSvg = useRef<SVGSVGElement | null>(null);
  const refVB = useRef<number[] | null>(null);
  const raf = useRef(0);
  // read inside listeners that are attached once
  const live = useRef({ source, meta, mode });
  live.current = { source, meta, mode };

  const vpSize = (): [number, number] => {
    const el = viewport.current;
    return el ? [el.clientWidth, el.clientHeight] : [0, 0];
  };

  const applyView = useCallback(() => {
    const { source: src, meta: m, mode: md } = live.current;
    if (!src || !viewport.current || !raster.current) return;
    const [vw, vh] = vpSize(), { s, x, y } = view.current;
    // original raster: a transformed <img>, pixelated once a pixel is bigger than 2 screen px
    const img = raster.current;
    img.style.width = src.w + "px"; img.style.height = src.h + "px";
    img.style.transform = `translate(${x}px, ${y}px) scale(${s})`;
    img.style.imageRendering = s > 2 ? "pixelated" : "auto";
    const vb = (k: number, kx = k) => `${(-x / s) * kx} ${(-y / s) * k} ${(vw / s) * kx} ${(vh / s) * k}`;
    if (vecSvg.current && m) {
      vecSvg.current.setAttribute("viewBox", vb(m.th / src.h, m.tw / src.w));
      vecSvg.current.setAttribute("width", String(vw)); vecSvg.current.setAttribute("height", String(vh));
    }
    if (refSvg.current && refVB.current) {
      const R = refVB.current, kx = R[2] / src.w, ky = R[3] / src.h;
      refSvg.current.setAttribute("viewBox", `${R[0] + (-x / s) * kx} ${R[1] + (-y / s) * ky} ${(vw / s) * kx} ${(vh / s) * ky}`);
      refSvg.current.setAttribute("width", String(vw)); refSvg.current.setAttribute("height", String(vh));
    }
    const sp = Math.round(view.current.split * vw);
    if (vecHost.current) vecHost.current.style.clipPath = md === "split" ? `inset(0 0 0 ${sp}px)` : "none";
    if (divider.current) divider.current.style.left = sp + "px";
    onZoom(Math.round(s * 100));
  }, [onZoom]);

  const drawView = useCallback(() => {
    if (!raf.current) raf.current = requestAnimationFrame(() => { raf.current = 0; applyView(); });
  }, [applyView]);

  const fitView = useCallback(() => {
    const src = live.current.source; if (!src) return;
    const [vw, vh] = vpSize();
    view.current.s = Math.min(vw / src.w, vh / src.h) * 0.94;
    view.current.x = (vw - src.w * view.current.s) / 2;
    view.current.y = (vh - src.h * view.current.s) / 2;
    view.current.fitted = true; drawView();
  }, [drawView]);

  const zoomAt = useCallback((ns: number, cx: number, cy: number) => {
    const src = live.current.source; if (!src) return;
    const [vw, vh] = vpSize();
    const minS = Math.min(vw / src.w, vh / src.h) * 0.25;
    ns = Math.min(MAX_ZOOM, Math.max(minS, ns));
    const v = view.current;
    v.x = cx - (cx - v.x) * ns / v.s; v.y = cy - (cy - v.y) * ns / v.s; v.s = ns;
    v.fitted = false; drawView();
  }, [drawView]);

  useImperativeHandle(handle, () => ({
    fit: fitView,
    zoomBy: (f: number) => { const [vw, vh] = vpSize(); zoomAt(view.current.s * f, vw / 2, vh / 2); },
    zoomTo: (s: number) => { const [vw, vh] = vpSize(); zoomAt(s, vw / 2, vh / 2); }
  }), [fitView, zoomAt]);

  // a new image starts fitted in the viewport
  useEffect(() => {
    if (!source) return;
    if (raster.current) raster.current.src = source.img.src;
    refSvg.current = null; vecSvg.current = null;
    vecHost.current?.replaceChildren();
    view.current.fitted = true;
    fitView();
  }, [source, fitView]);

  // the traced SVG, mounted live so zooming redraws the real curves
  useEffect(() => {
    if (!vecHost.current || !source) return;
    if (!svgText) { vecHost.current.replaceChildren(); vecSvg.current = null; return; }
    const m = mountSvg(vecHost.current, svgText, source);
    vecSvg.current = m ? m.node : null;
    if (view.current.fitted) fitView(); else drawView();
  }, [svgText, source, fitView, drawView]);

  // reference SVG on the left of the split
  useEffect(() => {
    const host = refHost.current; if (!host || !source) return;
    if (showRef && refText) {
      const m = mountSvg(host, refText, source);
      refSvg.current = m ? m.node : null; refVB.current = m ? m.vb : null;
    } else { host.replaceChildren(); refSvg.current = null; refVB.current = null; }
    drawView();
  }, [refText, showRef, source, drawView]);

  useEffect(() => { drawView(); }, [mode, drawView]);

  useEffect(() => {
    const el = viewport.current; if (!el) return;
    const ro = new ResizeObserver(() => { if (view.current.fitted) fitView(); else drawView(); });
    ro.observe(el);
    return () => ro.disconnect();
  }, [fitView, drawView]);

  // wheel zoom has to be a non-passive listener to keep the page from scrolling
  useEffect(() => {
    const el = viewport.current; if (!el) return;
    const onWheel = (e: WheelEvent) => {
      if (!live.current.source) return;
      e.preventDefault();
      const r = el.getBoundingClientRect();
      const dy = e.deltaMode === 1 ? e.deltaY * 16 : e.deltaY;
      zoomAt(view.current.s * Math.exp(-dy * 0.0018), e.clientX - r.left, e.clientY - r.top);
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, [zoomAt]);

  /* Lens: original pixels inside a circle that follows the pointer, smooth vector everywhere else */
  const placeLens = (x: number, y: number) => {
    const el = viewport.current, ring = lensRing.current; if (!el || !ring) return;
    const R = lensSize;
    el.style.setProperty("--lx", x + "px"); el.style.setProperty("--ly", y + "px"); el.style.setProperty("--lr", R + "px");
    ring.style.left = (x - R) + "px"; ring.style.top = (y - R) + "px"; ring.style.width = ring.style.height = 2 * R + "px";
    el.classList.add("lens-on");
  };

  // keep the ring in step when the lens slider moves
  useEffect(() => {
    const el = viewport.current; if (!el) return;
    const x = parseFloat(el.style.getPropertyValue("--lx")), y = parseFloat(el.style.getPropertyValue("--ly"));
    if (isFinite(x) && isFinite(y)) placeLens(x, y);
    // placeLens reads the fresh lensSize on every call
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lensSize]);

  // pointers: one finger/mouse pans (or moves the split if it grabbed the diamond); two pinch-zoom
  const ptrs = useRef(new Map<number, [number, number]>());
  const drag = useRef<{ split?: boolean; pinch?: boolean; d?: number; s?: number; x?: number; y?: number; vx?: number; vy?: number } | null>(null);

  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    const el = viewport.current; if (!el || !source) return;
    el.setPointerCapture(e.pointerId);
    ptrs.current.set(e.pointerId, [e.clientX, e.clientY]);
    if (ptrs.current.size === 1) {
      drag.current = (e.target as Element).closest(".divider") && mode === "split"
        ? { split: true }
        : { x: e.clientX, y: e.clientY, vx: view.current.x, vy: view.current.y };
    } else {
      const P = [...ptrs.current.values()];
      drag.current = { pinch: true, d: Math.hypot(P[0][0] - P[1][0], P[0][1] - P[1][1]), s: view.current.s };
    }
    el.classList.toggle("panning", !!(drag.current && !drag.current.split));
  };

  const onPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const el = viewport.current; if (!el) return;
    const r = el.getBoundingClientRect();
    if (mode === "lens" && source) placeLens(e.clientX - r.left, e.clientY - r.top);
    if (!ptrs.current.has(e.pointerId) || !drag.current) return;
    ptrs.current.set(e.pointerId, [e.clientX, e.clientY]);
    const d = drag.current;
    if (d.split) { view.current.split = Math.min(1, Math.max(0, (e.clientX - r.left) / r.width)); drawView(); }
    else if (d.pinch && ptrs.current.size >= 2) {
      const P = [...ptrs.current.values()], dist = Math.hypot(P[0][0] - P[1][0], P[0][1] - P[1][1]);
      zoomAt(d.s! * dist / (d.d || 1), (P[0][0] + P[1][0]) / 2 - r.left, (P[0][1] + P[1][1]) / 2 - r.top);
    } else if (!d.pinch) {
      view.current.x = d.vx! + e.clientX - d.x!; view.current.y = d.vy! + e.clientY - d.y!;
      view.current.fitted = false; drawView();
    }
  };

  const endPtr = (e: React.PointerEvent<HTMLDivElement>) => {
    ptrs.current.delete(e.pointerId);
    if (!ptrs.current.size) { drag.current = null; viewport.current?.classList.remove("panning"); }
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    const [vw, vh] = vpSize(), step = 60;
    if (e.key === "+" || e.key === "=") zoomAt(view.current.s * 1.5, vw / 2, vh / 2);
    else if (e.key === "-") zoomAt(view.current.s / 1.5, vw / 2, vh / 2);
    else if (e.key === "0") fitView();
    else if (e.key.startsWith("Arrow")) {
      view.current.x += e.key === "ArrowLeft" ? step : e.key === "ArrowRight" ? -step : 0;
      view.current.y += e.key === "ArrowUp" ? step : e.key === "ArrowDown" ? -step : 0;
      drawView();
    } else return;
    e.preventDefault();
  };

  return (
    <div
      className={"viewport mode-" + mode}
      id="viewport"
      ref={viewport}
      tabIndex={0}
      aria-label="Preview. Scroll or pinch to zoom, drag to pan."
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={endPtr}
      onPointerCancel={endPtr}
      onPointerLeave={() => viewport.current?.classList.remove("lens-on")}
      onDoubleClick={e => {
        const r = viewport.current!.getBoundingClientRect();
        zoomAt(view.current.s * (e.shiftKey ? 0.5 : 2), e.clientX - r.left, e.clientY - r.top);
      }}
      onKeyDown={onKeyDown}
    >
      <div className="layer" id="leftLayer">
        <img className="raster" id="raster" ref={raster} alt="Original image" hidden={showRef} />
        <div className="svghost" id="refHost" ref={refHost} hidden={!showRef} />
      </div>
      <div className="layer svghost" id="vecHost" ref={vecHost} />
      <div className="divider" id="divider" ref={divider} aria-hidden="true" />
      <span className="side-tag l" id="leftTag">{showRef ? "Reference" : "Original"}</span>
      <span className="side-tag r">SVG</span>
      <div className="lensring" id="lensRing" ref={lensRing} aria-hidden="true" />
      <span className="zoomhint">Scroll to zoom · drag to pan · double-click to zoom in</span>
    </div>
  );
}
