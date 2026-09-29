// Where an SVG's artwork really is, in its own user units: drawn and scanned for alpha, so strokes,
// markers and filters count and clip paths and masks are respected, which getBBox gets wrong. Drawn
// through <img> from a Blob URL (spec §10.3). A first pass finds the art to a pixel at EDGE on the
// long side, over the viewBox and as far again round it, which also tells whether the drawing runs
// past the viewBox (`bleeds`: shown on its own the file is cut there, placed in a pattern it isn't).
// A second pass draws just the part inside the viewBox (plus a pixel) at EDGE × EDGE for sub-pixel
// accuracy. Give it namespace()d markup: a <foreignObject> left in taints the canvas and the scan fails.
import { framed, parseSize, type ViewBox } from '../../shared/svg/index.ts';

export type Bounds = { x: number; y: number; w: number; h: number };

const EDGE = 1024;

export async function measureArtwork(svg: string): Promise<Bounds & { bleeds: boolean }> {
  const view = parseSize(svg).viewBox;
  const round: ViewBox = [view[0] - view[2], view[1] - view[3], 3 * view[2], 3 * view[3]];
  const k = EDGE / Math.max(round[2], round[3]);
  const w = Math.max(1, Math.round(round[2] * k));
  const h = Math.max(1, Math.round(round[3] * k));
  const all = await drawnBounds(svg, round, w, h);
  const px = round[2] / w;
  const py = round[3] / h;
  // a pixel of antialiasing past an edge the art only meets isn't a bleed
  const bleeds = !!all && (all.x < view[0] - px || all.y < view[1] - py || all.x + all.w > view[0] + view[2] + px || all.y + all.h > view[1] + view[3] + py);
  const rough = all && clip(all, view);
  if (!rough) throw new Error('The SVG draws nothing visible.');
  const x0 = Math.max(view[0], rough.x - px);
  const y0 = Math.max(view[1], rough.y - py);
  const x1 = Math.min(view[0] + view[2], rough.x + rough.w + px);
  const y1 = Math.min(view[1] + view[3], rough.y + rough.h + py);
  return { ...((await drawnBounds(svg, [x0, y0, x1 - x0, y1 - y0], EDGE, EDGE)) ?? rough), bleeds };
}

/** the part of `b` inside `box`; null when none is */
function clip(b: Bounds, box: ViewBox): Bounds | null {
  const [x0, y0] = [Math.max(b.x, box[0]), Math.max(b.y, box[1])];
  const [x1, y1] = [Math.min(b.x + b.w, box[0] + box[2]), Math.min(b.y + b.h, box[1] + box[3])];
  return x1 > x0 && y1 > y0 ? { x: x0, y: y0, w: x1 - x0, h: y1 - y0 } : null;
}

/** the part of `box` (user units) with any alpha, drawn at w × h px; null when nothing shows */
async function drawnBounds(svg: string, box: ViewBox, w: number, h: number): Promise<Bounds | null> {
  const url = URL.createObjectURL(new Blob([framed(svg, w, h, box)], { type: 'image/svg+xml' }));
  const ctx = new OffscreenCanvas(w, h).getContext('2d', { willReadFrequently: true })!;
  try {
    const img = new Image();
    img.src = url;
    await img.decode().catch(() => {
      throw new Error("The SVG couldn't be drawn.");
    });
    ctx.drawImage(img, 0, 0, w, h);
  } finally {
    URL.revokeObjectURL(url);
  }
  const a = ctx.getImageData(0, 0, w, h).data;
  let x0 = w;
  let y0 = h;
  let x1 = -1;
  let y1 = -1;
  for (let y = 0; y < h; y++) {
    const row = y * w * 4 + 3;
    for (let x = 0; x < w; x++) {
      if (!a[row + x * 4]) continue;
      if (x < x0) x0 = x;
      if (x > x1) x1 = x;
      if (y0 === h) y0 = y;
      y1 = y;
    }
  }
  if (x1 < 0) return null;
  // an edge pixel the art only partly covers: its strongest alpha says how far into it the art reaches
  const at = (x: number, y: number) => a[(y * w + x) * 4 + 3] / 255;
  let [l, r, t, b] = [0, 0, 0, 0];
  for (let y = y0; y <= y1; y++) [l, r] = [Math.max(l, at(x0, y)), Math.max(r, at(x1, y))];
  for (let x = x0; x <= x1; x++) [t, b] = [Math.max(t, at(x, y0)), Math.max(b, at(x, y1))];
  const [left, right] = x1 > x0 ? [x0 + 1 - l, x1 + r] : [x0, x1 + 1];
  const [top, bottom] = y1 > y0 ? [y0 + 1 - t, y1 + b] : [y0, y1 + 1];
  const sx = box[2] / w;
  const sy = box[3] / h;
  return { x: box[0] + left * sx, y: box[1] + top * sy, w: (right - left) * sx, h: (bottom - top) * sy };
}
