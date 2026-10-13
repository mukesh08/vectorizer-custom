/* Save the result, copy the markup, and the one-line status under them. */
import type { Settings } from "../../settings";

interface Props {
  fmt: Settings["fmt"];
  ready: boolean;
  note: string;
  noteErr: boolean;
  svgText: string;
  onDownload: () => void;
  onCopy: () => void;
}

/** Browsers choke long before this; past it the box shows a slice and points at Download. */
const PREVIEW_LIMIT = 3e6;

export default function ExportBar({ fmt, ready, note, noteErr, svgText, onDownload, onCopy }: Props) {
  return (
    <>
      <div className="actions">
        <button className="btn primary" id="dl" type="button" disabled={!ready} onClick={onDownload}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" aria-hidden="true">
            <path d="M12 4v12m0 0-4-4m4 4 4-4M5 20h14" />
          </svg>
          <span id="dlLabel">Download {fmt.toUpperCase()}</span>
        </button>
        <button className="btn" id="copy" type="button" disabled={!ready} onClick={onCopy}>Copy SVG code</button>
        <span className={"note" + (noteErr ? " err" : "")} id="note" role="status">{note}</span>
      </div>

      <details className="code">
        <summary>SVG code</summary>
        <textarea id="code" readOnly spellCheck={false} aria-label="SVG code"
          value={svgText.length > PREVIEW_LIMIT
            ? svgText.slice(0, PREVIEW_LIMIT) + "\n<!-- … preview truncated; use Download or Copy for the full file -->"
            : svgText} />
      </details>
    </>
  );
}
