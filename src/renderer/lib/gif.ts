// GIF (spec §10.4): the one animated encoder, fed a frame at a time so an export never holds all its
// frames, and a reader for the timing a GIF's blocks hold. Pure, so it runs in the encoder worker and
// under node --test.
import { GIFEncoder, applyPalette, quantize } from 'gifenc/dist/gifenc.esm.js';
import { outOfPalette, type Rgba8 } from './png-indexed.ts';

/** a frame as palette indices, one byte a pixel; an entry with alpha under 128 is clear */
export type Indexed = { indices: Uint8Array; w: number; h: number; palette: readonly Rgba8[] };
/** ImageData's shape, so node tests can pass plain objects */
export type Rgba = { data: Uint8ClampedArray<ArrayBuffer>; width: number; height: number };
export type FrameImage = Indexed | Rgba;

const MAX_SIDE = 65535;

/**
 * Each frame's delay in hundredths of a second (a GIF's unit). Every frame ends at its own time,
 * rounded, so the rounding never builds up: 30 fps gives 3, 4, 3, 3, 4, 3… and the loop is as long as
 * `count` frames at that rate, to the hundredth. `timing` is frames a second, or each frame in ms.
 */
export function gifDelays(count: number, timing: number | readonly number[]): number[] {
  if (typeof timing === 'number' && !(timing > 0 && Number.isFinite(timing))) throw new Error(`The frame rate has to be above 0, not ${timing}.`);
  const out: number[] = [];
  let t = 0;
  let prev = 0;
  for (let i = 0; i < count; i++) {
    t = typeof timing === 'number' ? ((i + 1) * 100) / timing : t + timing[i] / 10;
    const end = Math.round(t);
    out.push(end - prev);
    prev = end;
  }
  // browsers play a delay of 0 or 1 hundredth as 100 ms, so 2 is the shortest that plays as written
  if (out.some((d) => !(d >= 2))) throw new Error('A GIF shows each frame for at least 20 ms, so it plays at most 50 frames a second. Lower the frame rate.');
  if (out.some((d) => d > 0xffff)) throw new Error('A GIF frame can last at most 655 seconds.');
  return out;
}

const bitsFor = (colours: number) => Math.max(1, Math.ceil(Math.log2(colours)));
const rgbOf = (p: readonly Rgba8[]) => p.map((c) => [c[0], c[1], c[2]]);
const samePalette = (a: number[][], b: number[][]) => a.length === b.length && a.every((c, i) => c[0] === b[i][0] && c[1] === b[i][1] && c[2] === b[i][2]);

/** each pixel repeated into an `s` × `s` block: the same values, one per pixel (an index, or an RGBA as a Uint32) */
export function scaleUp<T extends Uint8Array | Uint32Array>(src: T, w: number, h: number, s: number): T {
  if (s === 1) return src;
  const W = w * s;
  const out = (src instanceof Uint8Array ? new Uint8Array(W * h * s) : new Uint32Array(W * h * s)) as T;
  const from = Uint32Array.from({ length: W }, (_, X) => (X / s) | 0); // the source column of each column
  for (let y = 0; y < h; y++) {
    const [top, row] = [y * s * W, y * w];
    for (let X = 0; X < W; X++) out[top + X] = src[row + from[X]];
    for (let k = 1; k < s; k++) out.copyWithin(top + k * W, top, top + W);
  }
  return out;
}

/** An RGBA frame's own 256 colours. GIF has one clear index, so alpha becomes clear or solid. */
function quantized({ data, width, height }: Rgba): Indexed {
  // gifenc reads the pixels through their whole buffer
  const px = data.byteOffset === 0 && data.byteLength === data.buffer.byteLength ? data : data.slice();
  let clear = false;
  for (let i = 3; i < px.length && !clear; i += 4) clear = px[i] < 255;
  // rgb444 bins find the palette 10× faster than rgb565 (0.1 s against 1 s at 1080p); the finer
  // rgb565 keys then pick each pixel's colour
  const palette = quantize(px, 256, clear ? { format: 'rgba4444', oneBitAlpha: true } : { format: 'rgb444' });
  return { indices: applyPalette(px, palette, clear ? 'rgba4444' : 'rgb565'), w: width, h: height, palette: palette as unknown as Rgba8[] };
}

/** A looping GIF built a frame at a time. Every frame is whole and clears when it ends, so a clear pixel never shows the frame before. */
export function gifWriter() {
  const enc = GIFEncoder();
  let size: [number, number] | null = null;
  let global: number[][] | null = null;
  let n = 0;
  return {
    /** one frame shown for `cs` hundredths of a second, each pixel a `scale` × `scale` block */
    add(frame: FrameImage, cs: number, scale = 1): void {
      const f = 'indices' in frame ? frame : quantized(frame);
      const colours = f.palette.length;
      if (colours < 1 || colours > 256) throw new Error(`A GIF frame holds 1 to 256 colours, not ${colours}.`);
      const [w, h] = [f.w * scale, f.h * scale];
      if (!size) {
        if (w > MAX_SIDE || h > MAX_SIDE) throw new Error(`${w} × ${h} px is bigger than a GIF can be (65,535 px a side).`);
        size = [w, h];
      } else if (w !== size[0] || h !== size[1]) {
        throw new Error(`Frame ${n + 1} is ${w} × ${h} px, but the first frame is ${size[0]} × ${size[1]} px.`);
      }
      let indices = f.indices;
      const bad = outOfPalette(indices, colours);
      if (bad >= 0) throw new Error(`Frame ${n + 1} uses colour ${indices[bad] + 1}, but its palette has ${colours}.`);
      const clear = f.palette.flatMap((c, i) => ((c[3] ?? 255) < 128 ? [i] : []));
      if (clear.length > 1) {
        const to = Uint8Array.from({ length: 256 }, (_, i) => (clear.includes(i) ? clear[0] : i));
        indices = indices.map((v) => to[v]);
      }
      const palette = rgbOf(f.palette);
      const reuse = global !== null && samePalette(global, palette);
      enc.writeFrame(scaleUp(indices, f.w, f.h, scale), w, h, {
        palette: reuse ? undefined : palette,
        delay: cs * 10, // gifenc takes ms and rounds to hundredths
        transparent: clear.length > 0,
        transparentIndex: clear[0] ?? 0,
        dispose: 2,
        colorDepth: bitsFor(colours),
      });
      global ??= palette;
      n++;
    },
    finish(): Uint8Array {
      enc.finish();
      return enc.bytes();
    },
  };
}

export type GifFrameInfo = { delay: number; dispose: number; clear: number | null };

/**
 * What a GIF's blocks say without decoding a pixel: its size, each whole frame's delay (hundredths),
 * disposal and clear index, and the loop count (0 = forever, null = plays once). A frame cut short
 * at the end of the file isn't counted.
 */
export function readGif(b: Uint8Array): { w: number; h: number; loop: number | null; frames: GifFrameInfo[] } {
  const text = (at: number, n: number) => String.fromCharCode(...b.subarray(at, at + n));
  if (b.length < 13 || !/^GIF8[79]a$/.test(text(0, 6))) throw new Error('This file is not a GIF.');
  const u16 = (at: number) => b[at] | (b[at + 1] << 8);
  const table = (packed: number) => (packed & 0x80 ? 3 << ((packed & 7) + 1) : 0);
  let at = 13 + table(b[10]);
  const skipSubBlocks = () => {
    while (at < b.length && b[at] !== 0) at += b[at] + 1;
    at++;
  };
  let gce: GifFrameInfo = { delay: 0, dispose: 0, clear: null };
  let loop: number | null = null;
  const frames: GifFrameInfo[] = [];
  while (at < b.length) {
    const kind = b[at++];
    if (kind === 0x21) {
      const label = b[at++];
      if (label === 0xf9 && b[at] === 4) gce = { delay: u16(at + 2), dispose: (b[at + 1] >> 2) & 7, clear: b[at + 1] & 1 ? b[at + 4] : null };
      if (label === 0xff && b[at] === 11 && text(at + 1, 11) === 'NETSCAPE2.0' && b[at + 13] === 1) loop = u16(at + 14);
      skipSubBlocks();
    } else if (kind === 0x2c) {
      at += 9 + table(b[at + 8]) + 1; // descriptor, local table, LZW code size
      skipSubBlocks();
      if (at > b.length) break;
      frames.push(gce);
      gce = { delay: 0, dispose: 0, clear: null };
    } else {
      break; // the trailer, or bytes that aren't a block
    }
  }
  return { w: u16(6), h: u16(8), loop, frames };
}
