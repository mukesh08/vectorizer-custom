/* The empty state: one panel card holding the only decision there is yet — pick an image.
   The workbench (rail, compare canvas, palette, export) replaces it once there is one. */
import { useRef } from "react";
import { BRAND } from "../../brand";

interface Props {
  onFile: (f: File | null | undefined) => void;
  /** Loads the built-in sample, for people who just want to see what the tool does. */
  onSample: () => void;
}

const isMac = typeof navigator !== "undefined" && /mac/i.test(navigator.platform || navigator.userAgent);

export default function Landing({ onFile, onSample }: Props) {
  const file = useRef<HTMLInputElement>(null);
  const pick = () => file.current?.click();

  return (
    <section className="landing">
      <h1>{BRAND.headline}</h1>
      <p>{BRAND.subhead}</p>

      <div className="dropcard">
        <div className="hero-drop" id="heroDrop" tabIndex={0} role="button" aria-label="Choose an image to vectorize"
          onClick={pick}
          onKeyDown={e => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); pick(); } }}>
          <svg width="34" height="34" viewBox="0 0 24 24" fill="none" stroke="var(--accent)" strokeWidth="1.6" aria-hidden="true">
            <path d="M12 16V4m0 0-4 4m4-4 4 4" />
            <path d="M4 16v3a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-3" />
          </svg>
          <strong>Drop an image here</strong>
          <span>or click to browse</span>
        </div>

        <div className="hero-actions">
          <button className="btn primary" type="button" onClick={pick}>Pick an image</button>
          <span className="paste-hint">
            or paste with {isMac ? <kbd className="key">⌘ V</kbd> : <><kbd className="key">Ctrl</kbd> + <kbd className="key">V</kbd></>}
          </span>
        </div>

        <div className="formats">{BRAND.formats.map(f => <span key={f}>{f}</span>)}</div>
      </div>

      <button className="sample-link" type="button" onClick={onSample}>or start with a sample image</button>

      <input type="file" id="file" ref={file} accept="image/*" hidden
        onChange={e => { onFile(e.target.files?.[0]); e.target.value = ""; }} />

      <ul className="fit">
        <li><b>Works best for</b> logos, icons, flat illustrations, stickers and line art with clear outlines and a limited set of colors.</li>
        <li><b>Good, with some cleanup, for</b> detailed anime and comic art. Very fine eyelashes, fading line tips and soft shading can come out simplified or slightly broken.</li>
        <li><b>Not suited to</b> photos and soft gradients. They produce very large files that still look posterized.</li>
      </ul>
    </section>
  );
}
