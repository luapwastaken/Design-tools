import { framed, parseSize, type ViewBox } from '../../../shared/svg/index.ts';
import type { LoadedItem } from '../../../shared/types.ts';

// "As an image" (spec §7.4): a pattern is its preview tile repeated over a maxEdge square at the
// tile's own scale; a logo is its preview lockup, trimmed and transparent; an SVG is drawn at
// maxEdge on its long side. SVG only ever goes through <img> from a Blob URL (spec §10.3), a
// separate document where nothing it holds can reach the page.

export const MAX_EDGE = 4096;

export async function rasterize(item: LoadedItem, maxEdge = MAX_EDGE): Promise<Blob> {
  switch (item.kind) {
    case 'svg': {
      const res = await fetch(item.url);
      if (!res.ok) throw new Error(`${item.ref.name} couldn't be read.`);
      return png(await drawSvg(await res.text(), (w, h) => fit(w, h, maxEdge)));
    }
    case 'pattern': {
      const { svg, tileWidth, tileHeight } = item.payload.preview;
      // a tile bigger than the square shows only its top left there, so only that much is drawn
      // (a whole 30,000 px tile is past what a canvas holds and came out blank)
      const [x, y] = parseSize(svg).viewBox;
      const box: ViewBox = [x, y, Math.min(maxEdge, tileWidth), Math.min(maxEdge, tileHeight)];
      const tile = await drawSvg(svg, () => [Math.max(1, Math.round(box[2])), Math.max(1, Math.round(box[3]))], box);
      const out = new OffscreenCanvas(maxEdge, maxEdge);
      const ctx = out.getContext('2d')!;
      ctx.fillStyle = ctx.createPattern(tile, 'repeat')!;
      ctx.fillRect(0, 0, maxEdge, maxEdge);
      return png(out);
    }
    case 'logo':
      return png(trim(await drawSvg(item.payload.preview.svg, (w, h) => fit(w, h, maxEdge))));
    default:
      throw new Error(`A ${item.kind} can't be drawn as an image.`);
  }
}

const fit = (w: number, h: number, edge: number): [number, number] => {
  const k = edge / Math.max(w, h);
  return [Math.max(1, Math.round(w * k)), Math.max(1, Math.round(h * k))];
};

/**
 * Draw SVG markup at the size `size(viewBox w, h)` returns, its viewBox (or `box`) filling it exactly. The markup
 * is given that size, so the vector renders sharp at it; parseSize reads mm and in, and framed never
 * letterboxes, so a pattern tile rounded to whole pixels still meets its neighbours with no gap.
 */
async function drawSvg(markup: string, size: (w: number, h: number) => [number, number], box?: ViewBox): Promise<OffscreenCanvas> {
  const [, , vw, vh] = parseSize(markup).viewBox;
  const [w, h] = size(vw, vh);
  const url = URL.createObjectURL(new Blob([framed(markup, w, h, box)], { type: 'image/svg+xml' }));
  try {
    const img = new Image();
    img.src = url;
    await img.decode();
    const canvas = new OffscreenCanvas(w, h);
    canvas.getContext('2d')!.drawImage(img, 0, 0, w, h);
    return canvas;
  } finally {
    URL.revokeObjectURL(url);
  }
}

/** crop to the pixels that aren't fully transparent */
function trim(canvas: OffscreenCanvas): OffscreenCanvas {
  const { width, height } = canvas;
  const ctx = canvas.getContext('2d')!;
  const a = ctx.getImageData(0, 0, width, height).data;
  let x0 = width;
  let y0 = height;
  let x1 = -1;
  let y1 = -1;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (a[(y * width + x) * 4 + 3] === 0) continue;
      if (x < x0) x0 = x;
      if (x > x1) x1 = x;
      if (y < y0) y0 = y;
      y1 = y;
    }
  }
  if (x1 < 0) return canvas; // nothing drawn: keep it as it is
  const out = new OffscreenCanvas(x1 - x0 + 1, y1 - y0 + 1);
  out.getContext('2d')!.drawImage(canvas, -x0, -y0);
  return out;
}

const png = (canvas: OffscreenCanvas): Promise<Blob> => canvas.convertToBlob({ type: 'image/png' });
