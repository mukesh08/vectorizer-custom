/* Drag, drop and paste anywhere on the page. */
import { useEffect } from "react";

export function useImageDrop(loadFile: (f: File | null | undefined) => void) {
  useEffect(() => {
    // whichever drop target is on screen: the hero on the landing page, the rail's once editing
    const mark = (on: boolean) => document.querySelectorAll(".drop, .hero-drop").forEach(el => el.classList.toggle("over", on));
    const over = (e: DragEvent) => { e.preventDefault(); mark(true); };
    const leave = (e: DragEvent) => { if (!e.relatedTarget) mark(false); };
    const onDrop = (e: DragEvent) => { e.preventDefault(); mark(false); const f = e.dataTransfer?.files[0]; if (f) loadFile(f); };
    const onPaste = (e: ClipboardEvent) => {
      const item = [...(e.clipboardData?.items || [])].find(i => i.type.startsWith("image/"));
      if (item) loadFile(item.getAsFile());
    };
    document.addEventListener("dragenter", over); document.addEventListener("dragover", over);
    document.addEventListener("dragleave", leave); document.addEventListener("drop", onDrop);
    document.addEventListener("paste", onPaste);
    return () => {
      document.removeEventListener("dragenter", over); document.removeEventListener("dragover", over);
      document.removeEventListener("dragleave", leave); document.removeEventListener("drop", onDrop);
      document.removeEventListener("paste", onPaste);
    };
  }, [loadFile]);
}
