// DEV ONLY (plan unit D): deleted when the image tools land.
import { toHex, type Oklch } from '../../../shared/color/index.ts';

export async function fetchBlob(url: string): Promise<Blob> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Couldn't read the image (${res.status}).`);
  return res.blob();
}

/** The bitmap's pixels, shrunk to fit `maxEdge` (never enlarged). Closes the bitmap. */
export function pixels(bmp: ImageBitmap, maxEdge = Infinity): ImageData {
  const k = Math.min(1, maxEdge / Math.max(bmp.width, bmp.height));
  const w = Math.max(1, Math.round(bmp.width * k));
  const h = Math.max(1, Math.round(bmp.height * k));
  const ctx = new OffscreenCanvas(w, h).getContext('2d')!;
  ctx.drawImage(bmp, 0, 0, w, h);
  bmp.close();
  return ctx.getImageData(0, 0, w, h);
}

/** In place: a gradient map through the tints (dark to light), mixed over the original by `strength` 0–100. */
export function tint(px: Uint8ClampedArray, tints: Oklch[], strength: number): void {
  if (!tints.length || strength <= 0) return;
  const lut = ramp(tints);
  const k = strength / 100;
  for (let o = 0; o < px.length; o += 4) {
    const y = Math.round(0.2126 * px[o] + 0.7152 * px[o + 1] + 0.0722 * px[o + 2]) * 3;
    for (let c = 0; c < 3; c++) px[o + c] += (lut[y + c] - px[o + c]) * k;
  }
}

/** 256 RGB steps running through the tints sorted by lightness */
function ramp(tints: Oklch[]): Uint8Array {
  const rgb = [...tints].sort((a, b) => a[0] - b[0]).map((t) => [1, 3, 5].map((i) => parseInt(toHex(t).slice(i, i + 2), 16)));
  const lut = new Uint8Array(256 * 3);
  for (let y = 0; y < 256; y++) {
    const f = (y / 255) * (rgb.length - 1);
    const a = rgb[Math.floor(f)];
    const b = rgb[Math.ceil(f)];
    for (let c = 0; c < 3; c++) lut[y * 3 + c] = Math.round(a[c] + (b[c] - a[c]) * (f - Math.floor(f)));
  }
  return lut;
}

export async function toPng(img: ImageData): Promise<Blob> {
  const canvas = new OffscreenCanvas(img.width, img.height);
  canvas.getContext('2d')!.putImageData(img, 0, 0);
  return canvas.convertToBlob({ type: 'image/png' });
}
