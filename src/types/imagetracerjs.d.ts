/* Minimal types for the public-domain imagetracer.js fallback engine (no types published). */
declare module "imagetracerjs" {
  interface TraceData {
    palette: { r: number; g: number; b: number; a: number }[];
    [key: string]: unknown;
  }
  interface ImageTracer {
    imagedataToTracedata(imgd: ImageData, options?: Record<string, unknown>): TraceData;
    getsvgstring(td: TraceData, options?: Record<string, unknown>): string;
  }
  const ImageTracer: ImageTracer;
  export default ImageTracer;
}
