/* What the current trace produced. Dashes until the first result lands. */
import type { OutputStats } from "../../hooks/useOutputFile";

export default function Stats({ stats }: { stats: OutputStats | null }) {
  return (
    <dl className="stats">
      <div><dt>Paths</dt><dd id="sPaths">{stats ? stats.paths.toLocaleString() : "—"}</dd></div>
      <div><dt>Colors</dt><dd id="sColors">{stats ? stats.colors.toLocaleString() : "—"}</dd></div>
      <div><dt>SVG size</dt><dd id="sSize">{stats ? stats.size : "—"}</dd></div>
      <div><dt>Output</dt><dd id="sDims">{stats ? stats.dims : "—"}</dd></div>
      <div><dt>Traced at</dt><dd id="sTrace">{stats ? stats.tracedAt : "—"}</dd></div>
      <div><dt>Traced in</dt><dd id="sTime">{stats ? stats.time : "—"}</dd></div>
      <div><dt>Engine</dt><dd id="sEngine">{stats ? stats.engine : "—"}</dd></div>
    </dl>
  );
}
