/* The image being worked on, and how one arrives: picked, dropped, pasted or the built-in sample.
   An upload larger than the detail cap waits in `pending` until the crop dialog resolves it. */
import { useCallback, useState } from "react";
import type { SourceImage } from "../engine/pipeline";
import { sampleImage } from "../sample";

type Notify = (text: string, err?: boolean) => void;

export interface PendingImage { img: HTMLImageElement; name: string }

export function useImageSource(limitMP: number, notify: Notify, clearNote: () => void) {
  const [source, setSource] = useState<SourceImage | null>(null);
  const [pending, setPending] = useState<PendingImage | null>(null);

  /** Takes an image as-is and makes it the thing being traced. */
  const adopt = useCallback((img: HTMLImageElement, name: string) => {
    setPending(null);
    setSource({ img, w: img.naturalWidth, h: img.naturalHeight, name });
    clearNote();
  }, [clearNote]);

  const loadFile = useCallback((f: File | null | undefined) => {
    if (!f || !f.type.startsWith("image/")) { notify("That file isn't an image. Choose a JPG, PNG, WebP or GIF.", true); return; }
    const img = new Image();
    img.onload = () => {
      // over the detail level the tracer would scale it down, so offer a crop that keeps full-size pixels
      if (limitMP > 0 && img.naturalWidth * img.naturalHeight / 1e6 > limitMP) { setPending({ img, name: f.name }); clearNote(); }
      else adopt(img, f.name);
    };
    img.onerror = () => notify("This image couldn't be opened. Try saving it as PNG or JPG first.", true);
    img.src = URL.createObjectURL(f);
  }, [adopt, limitMP, notify, clearNote]);

  const loadSample = useCallback(() => {
    void sampleImage().then(({ img, name }) => adopt(img, name));
  }, [adopt]);

  /** Reopens the crop dialog for the image already loaded. */
  const recrop = useCallback(() => {
    setSource(s => { if (s) setPending({ img: s.img, name: s.name }); return s; });
  }, []);

  const fileName = source ? source.name + " · " + source.w + "×" + source.h + " px" : "No image yet";

  return { source, pending, adopt, loadFile, loadSample, recrop, cancelCrop: () => setPending(null), fileName };
}
