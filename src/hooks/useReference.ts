/* Reference compare: load an SVG from another vectorizer and put it on the left of the slider,
   so both vectors can be checked against each other at any zoom. */
import { useCallback, useState } from "react";
import { fmtBytes } from "./useOutputFile";

type Notify = (text: string, err?: boolean) => void;

export function useReference(notify: Notify) {
  const [refText, setRefText] = useState<string | null>(null);
  const [refStats, setRefStats] = useState("");
  const [leftSide, setLeftSide] = useState<"original" | "ref">("original");

  const loadReference = useCallback(async (f: File | null | undefined) => {
    if (!f) return;
    const text = await f.text();
    if (!/<svg[\s>]/i.test(text)) { notify("That file isn't an SVG.", true); return; }
    const fills = new Set<string>();
    text.replace(/fill(?:=|:\s*)"?\s*(#[0-9a-f]{3,8}|rgb\([^)]*\))/gi, (m, c: string) => { fills.add(c.toLowerCase()); return m; });
    setRefStats("Reference · " + f.name + " · " + (text.match(/<path/g) || []).length.toLocaleString()
      + " paths · " + fills.size + " colors · " + fmtBytes(new Blob([text]).size));
    setRefText(text);
    setLeftSide("ref");
  }, [notify]);

  return { refText, refStats, leftSide, setLeftSide, loadReference };
}
