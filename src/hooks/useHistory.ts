/* Undo/redo over the settings object.
 *
 * Every control on the rail writes into one Settings object, so history is just a stack of those.
 * Two details keep it from being annoying:
 *
 *   - Slider drags coalesce. A drag fires a change per pixel, and without this every one would be
 *     its own undo step, so an edit within COALESCE_MS that touches the SAME keys replaces the
 *     previous entry instead of appending. Changing a different control always starts a new step.
 *   - Only states that differ are pushed, so re-selecting the current preset is not a step.
 *
 * The cap exists because Settings holds the custom-palette text, which can be long.
 */
import { useCallback, useRef, useState } from "react";
import type { Settings } from "../settings";

const COALESCE_MS = 600;
const LIMIT = 100;

export interface History {
  canUndo: boolean;
  canRedo: boolean;
  undo: () => void;
  redo: () => void;
  /** Records a state the user arrived at. */
  push: (next: Settings) => void;
}

const changedKeys = (a: Settings, b: Settings): string[] =>
  (Object.keys(b) as (keyof Settings)[]).filter(k => a[k] !== b[k]).map(String);

export function useHistory(initial: Settings, apply: (s: Settings) => void): History {
  const past = useRef<Settings[]>([]);
  const future = useRef<Settings[]>([]);
  const current = useRef<Settings>(initial);
  const lastAt = useRef(0);
  const lastKeys = useRef<string>("");
  // history lives in refs so pushes don't re-render; this only mirrors the button states
  const [[canUndo, canRedo], setFlags] = useState<[boolean, boolean]>([false, false]);

  const sync = useCallback(() => {
    setFlags([past.current.length > 0, future.current.length > 0]);
  }, []);

  const push = useCallback((next: Settings) => {
    const prev = current.current;
    const keys = changedKeys(prev, next);
    if (!keys.length) return;                        // nothing actually moved
    const sig = keys.sort().join(",");
    const now = Date.now();
    const coalesce = past.current.length > 0 && sig === lastKeys.current && now - lastAt.current < COALESCE_MS;

    if (!coalesce) {
      past.current.push(prev);
      if (past.current.length > LIMIT) past.current.shift();
    }
    future.current = [];                             // a new edit abandons the redo branch
    current.current = next;
    lastKeys.current = sig;
    lastAt.current = now;
    sync();
  }, [sync]);

  const undo = useCallback(() => {
    const prev = past.current.pop();
    if (!prev) return;
    future.current.push(current.current);
    current.current = prev;
    lastKeys.current = "";                           // don't coalesce across an undo
    apply(prev);
    sync();
  }, [apply, sync]);

  const redo = useCallback(() => {
    const next = future.current.pop();
    if (!next) return;
    past.current.push(current.current);
    current.current = next;
    lastKeys.current = "";
    apply(next);
    sync();
  }, [apply, sync]);

  return { canUndo, canRedo, undo, redo, push };
}
