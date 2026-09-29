// PNG resolution (Pattern plan unit W): canvas.toBlob writes no pHYs chunk, so every PNG would open
// at the viewer's default 72 or 96 ppi instead of the size it was made for.

const SIGNATURE = [137, 80, 78, 71, 13, 10, 26, 10];
const INCH = 0.0254;

const CRC = Uint32Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});

export function crc32(bytes: Uint8Array): number {
  let c = ~0;
  for (const b of bytes) c = CRC[(c ^ b) & 0xff] ^ (c >>> 8);
  return ~c >>> 0;
}

/** pHYs: pixels per metre on both axes, unit 1 (metre) */
function phys(dpi: number): Uint8Array {
  const out = new Uint8Array(21);
  const v = new DataView(out.buffer);
  const ppm = Math.round(dpi / INCH);
  v.setUint32(0, 9);
  out.set([112, 72, 89, 115], 4); // "pHYs"
  v.setUint32(8, ppm);
  v.setUint32(12, ppm);
  out[16] = 1;
  v.setUint32(17, crc32(out.subarray(4, 17)));
  return out;
}

/** The same PNG with its resolution set to `dpi`: any pHYs it had is replaced by one right after IHDR. */
export async function withDpi(png: Blob, dpi: number): Promise<Blob> {
  if (!(dpi > 0) || !Number.isFinite(dpi)) throw new Error(`A PNG's resolution must be above 0 ppi, not ${dpi}.`);
  const src = new Uint8Array(await png.arrayBuffer());
  const v = new DataView(src.buffer, src.byteOffset, src.byteLength);
  const type = (at: number) => String.fromCharCode(...src.subarray(at + 4, at + 8));
  if (src.length < 33 || SIGNATURE.some((b, i) => src[i] !== b) || type(8) !== 'IHDR' || v.getUint32(8) !== 13) throw new Error('This file is not a PNG.');
  const parts: Uint8Array[] = [src.subarray(0, 33), phys(dpi)];
  for (let at = 33; at < src.length; ) {
    const end = at + 12 <= src.length ? at + 12 + v.getUint32(at) : Infinity;
    if (end > src.length) throw new Error('This PNG is cut short.');
    if (type(at) !== 'pHYs') parts.push(src.subarray(at, end));
    at = end;
  }
  return new Blob(parts as BlobPart[], { type: 'image/png' });
}
