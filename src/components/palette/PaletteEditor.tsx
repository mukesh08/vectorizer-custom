/* Palette editor.
   Presets: the traced colors numbered by how much of the image they cover; click N to keep the
   N most-used colors (every other color joins its nearest kept one).
   Edit: select output colors to merge, recolor or remove them.
   Every edit is written into the Custom palette box as snap/remap rules, so it can be read,
   tweaked or cleared, and the image is re-traced with the merged colors as single shapes. */
import { useRef, useState } from "react";
import { cdist, hexOf, lum, parseHex } from "../../engine/color";
import type { Swatch } from "../../engine/pipeline";
import type { RGB } from "../../engine/types";
import { applyPaletteRule, parsePalette } from "../../output/palette";

interface Props {
  /** Every color the tracer found, most used first; null hides the panel. */
  base: Swatch[] | null;
  customPal: string;
  /** Replaces the custom-palette rules and re-traces at once. */
  onRules: (text: string) => void;
  setNote: (text: string, err?: boolean) => void;
}

type Mode = "presets" | "edit";

interface Item {
  c: RGB;
  area: number;
  n: number;
  key: string;
  members?: Swatch[];
}

export default function PaletteEditor({ base, customPal, onRules, setNote }: Props) {
  const [mode, setMode] = useState<Mode>("presets");
  const [sel, setSel] = useState<Set<string>>(new Set());
  const color = useRef<HTMLInputElement>(null);

  if (!base) return null;

  /** base hex -> output color, or null when removed */
  const currentMap = (): Map<string, RGB | null> => {
    const { rules } = parsePalette(customPal), m = new Map<string, RGB | null>();
    for (const b of base) m.set(b.hex, rules.length ? applyPaletteRule(rules, b.c) : b.c);
    return m;
  };

  const writeMap = (m: Map<string, RGB | null>): void => {
    const lines: string[] = [];
    for (const b of base) {
      const t = m.get(b.hex);
      if (t === null) lines.push(`${b.hex} -> ${b.hex}00 ~ 0.002`);
      else if (t && hexOf(t) !== b.hex) lines.push(`${b.hex} -> ${hexOf(t)} ~ 0.002`);
    }
    setSel(new Set());
    onRules(lines.join(";\n"));
  };

  const map = currentMap();
  const total = base.reduce((a, b) => a + b.area, 0) || 1;

  let items: Item[];
  let hint: string;
  if (mode === "presets") {
    items = base.map((b, i) => ({ c: b.c, area: b.area, n: i + 1, key: b.hex }));
    hint = "Colors found in the image, most used first. Click a number to keep only that many colors.";
  } else {
    const g = new Map<string, Item>();
    for (const b of base) {
      const t = map.get(b.hex); if (t === null || !t) continue;
      const h = hexOf(t);
      if (!g.has(h)) g.set(h, { c: t, area: 0, members: [], key: h, n: 0 });
      const it = g.get(h)!; it.area += b.area; it.members!.push(b);
    }
    items = [...g.values()].sort((a, b) => b.area - a.area).map((it, i) => ({ ...it, n: i + 1 }));
    hint = "Output colors. Click to select, then merge, recolor or remove them.";
  }

  const removed = base.filter(b => map.get(b.hex) === null).length;
  const inOutput = new Set([...map.values()].filter(Boolean).map(c => hexOf(c as RGB))).size;

  const click = (it: Item): void => {
    if (mode === "presets") {
      // keep the N most-used base colors; everything else snaps to its nearest kept color
      const keep = base.slice(0, it.n), m = new Map<string, RGB | null>();
      for (const b of base) {
        if (keep.includes(b)) { m.set(b.hex, b.c); continue; }
        let best = keep[0], bd = Infinity;
        for (const k of keep) { const d = cdist(b.c[0], b.c[1], b.c[2], k.c[0], k.c[1], k.c[2]); if (d < bd) { bd = d; best = k; } }
        m.set(b.hex, best.c);
      }
      setNote("Keeping the " + it.n + " most-used colors…");
      writeMap(m);
      return;
    }
    const next = new Set(sel);
    if (next.has(it.key)) next.delete(it.key); else next.add(it.key);
    setSel(next);
  };

  const editSelected = (fn: (c: RGB) => RGB | null): void => {
    const m = currentMap();
    for (const b of base) { const t = m.get(b.hex); if (t && sel.has(hexOf(t))) m.set(b.hex, fn(t)); }
    writeMap(m);
  };

  const merge = (): void => {
    // merge into the most-used selected color
    const m = currentMap(), area = new Map<string, number>();
    for (const b of base) { const t = m.get(b.hex); if (t && sel.has(hexOf(t))) area.set(hexOf(t), (area.get(hexOf(t)) || 0) + b.area); }
    const top = [...area.entries()].sort((a, b) => b[1] - a[1])[0];
    if (!top) return;
    const target = parseHex(top[0])!.slice(0, 3);
    editSelected(() => target);
  };

  return (
    <section className="palpanel" id="palPanel" aria-labelledby="palTitle">
      <div className="palhead">
        <h2 id="palTitle">Palette <small id="palCount">
          {(mode === "presets" ? base.length + " found · " : "") + inOutput + " in output" + (removed ? " · " + removed + " removed" : "")}
        </small></h2>
        <div className="seg" id="palMode" role="group" aria-label="Palette mode">
          {(["presets", "edit"] as Mode[]).map(m => (
            <button key={m} type="button" aria-pressed={mode === m} onClick={() => { setMode(m); setSel(new Set()); }}>
              {m === "presets" ? "Presets" : "Edit"}
            </button>
          ))}
        </div>
      </div>
      <p className="hint" id="palHint">{hint}</p>
      <div className="swatches" id="swatches">
        {items.map(it => {
          const pct = it.area / total * 100;
          const merged = mode === "edit" && it.members && (it.members.length > 1 || hexOf(it.members[0].c) !== it.key);
          return (
            <button key={it.key} type="button" className="sw" onClick={() => click(it)}
              style={{ background: hexOf(it.c), color: lum(it.c) > 150 ? "#141824" : "#ffffff" }}
              title={`${hexOf(it.c)} · ${pct < 0.1 ? "<0.1" : pct.toFixed(1)}% of the image`}
              aria-label={(mode === "presets" ? "Keep " + it.n + " colors. " : "Color " + it.n + ", ") + hexOf(it.c)}
              aria-pressed={mode === "edit" ? sel.has(it.key) : undefined}
              data-merged={merged ? it.members!.length : undefined}>
              {it.n}
            </button>
          );
        })}
      </div>
      <div className="palactions">
        <span id="palActions" hidden={mode !== "edit"}>
          <button className="btn small" id="palMerge" type="button" disabled={sel.size < 2} onClick={merge}>Merge selected</button>
          <button className="btn small" id="palRecolor" type="button" disabled={!sel.size} onClick={() => color.current?.click()}>Recolor…</button>
          <input type="color" id="palColor" ref={color} defaultValue="#000000" hidden
            onChange={e => { const c = parseHex(e.target.value)!.slice(0, 3); editSelected(() => c); }} />
          <button className="btn small" id="palRemove" type="button" disabled={!sel.size} onClick={() => editSelected(() => null)}>Remove</button>
        </span>
        <button className="btn small" id="palReset" type="button" disabled={!customPal.trim()}
          onClick={() => { setSel(new Set()); onRules(""); }}>Reset palette</button>
      </div>
    </section>
  );
}
