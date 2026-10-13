/* The tool opens in a working state: a sample image published next to the page, or a generated
   badge when that file isn't there. */

export interface Sample { img: HTMLImageElement; name: string }

const load = (src: string): Promise<HTMLImageElement> => new Promise((res, rej) => {
  const img = new Image();
  img.onload = () => res(img);
  img.onerror = () => rej(new Error("could not load " + src));
  img.src = src;
});

function badgeDataUrl(): string {
  const c = document.createElement("canvas"); c.width = 360; c.height = 360;
  const g = c.getContext("2d")!;
  g.fillStyle = "#ffffff"; g.fillRect(0, 0, 360, 360);
  g.fillStyle = "#1f2a44"; g.beginPath(); g.arc(180, 180, 172, 0, Math.PI * 2); g.fill();
  g.fillStyle = "#f6efe2"; g.beginPath(); g.arc(180, 180, 160, 0, Math.PI * 2); g.fill();
  g.save(); g.beginPath(); g.arc(180, 180, 160, 0, Math.PI * 2); g.clip();
  const sky = g.createLinearGradient(0, 20, 0, 260); sky.addColorStop(0, "#f9d9b8"); sky.addColorStop(1, "#f6efe2");
  g.fillStyle = sky; g.fillRect(0, 0, 360, 360);
  g.fillStyle = "#f0672a"; g.beginPath(); g.arc(238, 128, 40, 0, Math.PI * 2); g.fill();
  g.fillStyle = "#3b5bdb"; g.beginPath(); g.moveTo(0, 265); g.lineTo(118, 140); g.lineTo(185, 214); g.lineTo(242, 163); g.lineTo(360, 265); g.lineTo(360, 360); g.lineTo(0, 360); g.fill();
  g.fillStyle = "#ffffff"; g.beginPath(); g.moveTo(118, 140); g.lineTo(144, 168); g.lineTo(131, 163); g.lineTo(118, 175); g.lineTo(105, 162); g.lineTo(92, 168); g.fill();
  g.fillStyle = "#1f2a44"; g.beginPath(); g.moveTo(0, 292); g.bezierCurveTo(100, 252, 236, 332, 360, 280); g.lineTo(360, 360); g.lineTo(0, 360); g.fill();
  g.restore();
  g.fillStyle = "#f6efe2"; g.font = "700 26px Georgia, serif"; g.textAlign = "center"; g.fillText("HIMAL", 180, 324);
  // simulate a small, compressed JPEG like most real inputs
  return c.toDataURL("image/jpeg", 0.72);
}

export async function sampleImage(): Promise<Sample> {
  try {
    return { img: await load("sample.jpg"), name: "akaza-reflection.jpg" };
  } catch {
    return { img: await load(badgeDataUrl()), name: "sample-badge.jpg" };
  }
}
