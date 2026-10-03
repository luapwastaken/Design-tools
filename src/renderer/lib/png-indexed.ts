// Indexed PNG (Dither plan unit B): a true palette file, PLTE plus tRNS when a colour is clear, at
// the smallest bit depth the palette allows, each pixel a `scale` × `scale` block so a pixel size of
// 8 really is 8 px in the file. The browser's own deflate, no dependency.
import { crc32, withDpi } from './png.ts';

/** sRGB bytes 0–255 (`rgb255` from shared/color), with an optional alpha: the file's own terms */
export type Rgba8 = readonly [r: number, g: number, b: number, a?: number];

/** a raw image this size is 256 MB before compressing, at 8 bits a pixel */
const MAX_PX = 2 ** 28;

/** where the first index at or past `n` colours is, or -1 (a plain loop: findIndex is 10× slower here) */
export function outOfPalette(indices: Uint8Array, n: number): number {
  let max = 0;
  for (let i = 0; i < indices.length; i++) if (indices[i] > max) max = indices[i];
  return max < n ? -1 : indices.findIndex((v) => v >= n);
}

function chunk(type: string, data: Uint8Array): Uint8Array {
  const out = new Uint8Array(12 + data.length);
  const v = new DataView(out.buffer);
  v.setUint32(0, data.length);
  for (let i = 0; i < 4; i++) out[4 + i] = type.charCodeAt(i);
  out.set(data, 8);
  v.setUint32(8 + data.length, crc32(out.subarray(4, 8 + data.length)));
  return out;
}

/** `indices` is `w` × `h`, one palette index a pixel; `dpi` is written as pHYs */
export async function encodeIndexedPng(indices: Uint8Array, w: number, h: number, palette: readonly Rgba8[], { scale = 1, dpi }: { scale?: number; dpi?: number } = {}): Promise<Blob> {
  const n = palette.length;
  if (n < 1 || n > 256) throw new Error(`An indexed PNG holds 1 to 256 colours, not ${n}.`);
  if (!(w >= 1 && h >= 1) || indices.length !== w * h) throw new Error(`${indices.length} indices can't be a ${w} × ${h} px image.`);
  if (!Number.isInteger(scale) || scale < 1) throw new Error(`The scale has to be a whole number from 1 up, not ${scale}.`);
  const [W, H] = [w * scale, h * scale];
  if (W * H > MAX_PX) throw new Error(`${W.toLocaleString('en')} × ${H.toLocaleString('en')} px is more than an indexed PNG here can hold. Use a smaller scale.`);

  const depth = n <= 2 ? 1 : n <= 4 ? 2 : n <= 16 ? 4 : 8;
  const perByte = 8 / depth;
  const shift = Math.log2(perByte);
  const stride = 1 + Math.ceil(W / perByte); // filter byte 0 (none, as the spec advises for palettes), then the row
  const at = outOfPalette(indices, n);
  if (at >= 0) throw new Error(`Pixel ${at % w}, ${(at / w) | 0} uses colour ${indices[at] + 1}, but the palette has ${n}.`);
  const raw = new Uint8Array(stride * H);
  const from = Uint32Array.from({ length: W }, (_, X) => (X / scale) | 0); // the source column of each file column
  for (let y = 0; y < h; y++) {
    const [top, row] = [y * scale * stride, y * w];
    for (let X = 0; X < W; X++) raw[top + 1 + (X >> shift)] |= indices[row + from[X]] << ((perByte - 1 - (X & (perByte - 1))) * depth);
    for (let k = 1; k < scale; k++) raw.copyWithin(top + k * stride, top, top + stride);
  }

  const ihdr = new Uint8Array(13);
  const v = new DataView(ihdr.buffer);
  v.setUint32(0, W);
  v.setUint32(4, H);
  ihdr[8] = depth;
  ihdr[9] = 3; // colour type: palette
  const plte = Uint8Array.from(palette.flatMap((c) => [c[0], c[1], c[2]]));
  const alpha = palette.map((c) => c[3] ?? 255);
  const lastClear = alpha.findLastIndex((a) => a < 255); // tRNS may stop at the last entry that isn't opaque
  const idat = new Uint8Array(await new Response(new Blob([raw]).stream().pipeThrough(new CompressionStream('deflate'))).arrayBuffer());
  const parts = [
    Uint8Array.of(137, 80, 78, 71, 13, 10, 26, 10),
    chunk('IHDR', ihdr),
    chunk('PLTE', plte),
    ...(lastClear >= 0 ? [chunk('tRNS', Uint8Array.from(alpha.slice(0, lastClear + 1)))] : []),
    chunk('IDAT', idat),
    chunk('IEND', new Uint8Array()),
  ];
  const png = new Blob(parts as BlobPart[], { type: 'image/png' });
  return dpi === undefined ? png : withDpi(png, dpi);
}
