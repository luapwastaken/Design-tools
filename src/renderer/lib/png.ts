// PNG resolution (Pattern plan unit W): canvas.toBlob writes no pHYs chunk, so every PNG would open
// at the viewer's default 72 or 96 ppi instead of the size it was made for. And straight RGBA PNGs
// (the Illustration painting): a canvas premultiplies alpha on the way out, which ruins the colour of
// anything nearly transparent.

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

/** a chunk: length, type, data, CRC */
function chunk(type: string, data: Uint8Array): Uint8Array {
  const out = new Uint8Array(12 + data.length);
  const v = new DataView(out.buffer);
  v.setUint32(0, data.length);
  for (let i = 0; i < 4; i++) out[4 + i] = type.charCodeAt(i);
  out.set(data, 8);
  v.setUint32(8 + data.length, crc32(out.subarray(4, 8 + data.length)));
  return out;
}

/**
 * RGBA pixels (straight alpha, rows from the top) as an 8-bit RGBA PNG, compressed by the
 * platform's deflate. Each row is filtered against the one above ("Up"), which suits paint.
 */
export async function rgbaPng(bytes: Uint8Array, w: number, h: number): Promise<Blob> {
  if (!(Number.isInteger(w) && Number.isInteger(h) && w > 0 && h > 0) || bytes.length !== w * h * 4) throw new Error(`${bytes.length} bytes aren't ${w} × ${h} RGBA pixels.`);
  const row = w * 4;
  const raw = new Uint8Array((row + 1) * h);
  for (let y = 0; y < h; y++) {
    const o = y * (row + 1);
    const at = y * row;
    if (!y) {
      raw.set(bytes.subarray(0, row), 1);
      continue;
    }
    raw[o] = 2;
    for (let i = 0; i < row; i++) raw[o + 1 + i] = bytes[at + i] - bytes[at - row + i];
  }
  const packed = new Uint8Array(await new Response(new Blob([raw]).stream().pipeThrough(new CompressionStream('deflate'))).arrayBuffer());
  const head = new Uint8Array(13);
  const v = new DataView(head.buffer);
  v.setUint32(0, w);
  v.setUint32(4, h);
  head.set([8, 6, 0, 0, 0], 8);
  return new Blob([new Uint8Array(SIGNATURE), chunk('IHDR', head), chunk('IDAT', packed), chunk('IEND', new Uint8Array(0))] as BlobPart[], { type: 'image/png' });
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
