/* Hand-written types for the generated wasm-bindgen glue in vtracer_webapp.js.
   Only the surface the app actually calls is declared. */

/** A converter driven one slice at a time so the page keeps painting. */
declare class ImageConverter {
  /** Start converting; must be called before the first tick(). */
  init(): void;
  /** Does one chunk of work. Returns true once the SVG is complete. */
  tick(): boolean;
  /** 0–100. */
  progress(): number;
  /** Releases the wasm-side object. Safe to call once. */
  free(): void;
}

/** Two colors (threshold at the midpoint). `params` is the JSON config string. */
export declare class BinaryImageConverter extends ImageConverter {
  static new_with_string(params: string): BinaryImageConverter;
}

/** Full color. `params` is the JSON config string. */
export declare class ColorImageConverter extends ImageConverter {
  static new_with_string(params: string): ColorImageConverter;
}

export declare function main(): void;

/** Instantiates the wasm module once; later calls share the first promise. */
export declare function initVT(): Promise<void>;
