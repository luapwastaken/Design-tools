// Reading back (see index.ts): textures at full resolution, rows from the top, and images larger
// than any texture drawn tile by tile into one buffer (inventory: v1 capped exports at 1600 and 2048 px).
import { getEngine, isLost, type Engine } from './context.ts';
import type { Tile } from './draw.ts';
import { GpuError, GpuLost } from './errors.ts';
import { FORMATS, Texture, type Format, type PixelArray } from './texture.ts';
import { tiles, type Rect } from './tiles.ts';

/** quick to draw, and never more than 128 MB of graphics memory for a tile, even at rgba16f */
const TILE = 4096;
/** pixels per r16f read band: 16 MB of RGBA floats */
const BAND = 1 << 20;

/** `rect` of the texture (all of it by default). Throws GpuLost if the context is lost: an export must never get zeros. */
export function read<F extends Format>(tex: Texture<F>, rect?: Rect): PixelArray<F> {
  if (isLost()) throw new GpuLost();
  const e = getEngine();
  const r = rect ?? { x: 0, y: 0, w: tex.width, h: tex.height };
  if (![r.x, r.y, r.w, r.h].every(Number.isInteger) || r.x < 0 || r.y < 0 || r.w < 1 || r.h < 1 || r.x + r.w > tex.width || r.y + r.h > tex.height) {
    throw new GpuError(`${r.w} × ${r.h} px at ${r.x}, ${r.y} isn't inside the ${tex.width} × ${tex.height} px texture.`);
  }
  const out = alloc(tex.format, r.w, r.h);
  readInto(e, tex, r, out, r.w, 0, 0);
  if (isLost()) throw new GpuLost();
  return out;
}

/**
 * An image of any size, drawn by `draw` one tile at a time (pass each `tile` as a pass's output)
 * and read into one buffer, rows from the top. It yields to the window between tiles; its own tile
 * texture belongs to no scope, so hiding a tool doesn't stop an export in flight.
 */
export async function renderTiled<F extends Format>(
  width: number,
  height: number,
  format: F,
  draw: (tile: Tile) => void | Promise<void>,
  opts: { tile?: number } = {},
): Promise<PixelArray<F>> {
  if (isLost()) throw new GpuLost();
  const e = getEngine();
  const size = Math.min(opts.tile ?? TILE, e.maxSize);
  const rects = tiles(width, height, size);
  const out = alloc(format, width, height);
  const gen = e.gen;
  const gone = () => isLost() || e.gen !== gen;
  const texture = new Texture(null, { width: Math.min(size, width), height: Math.min(size, height) }, format);
  try {
    for (const [i, rect] of rects.entries()) {
      if (i) await new Promise((r) => setTimeout(r));
      if (gone()) throw new GpuLost();
      await draw({ texture, rect, full: { width, height } });
      if (gone()) throw new GpuLost();
      readInto(e, texture, { x: 0, y: 0, w: rect.w, h: rect.h }, out, width, rect.x, rect.y);
    }
    if (isLost()) throw new GpuLost();
  } finally {
    texture.release();
  }
  return out;
}

function alloc<F extends Format>(format: F, w: number, h: number): PixelArray<F> {
  const n = w * h * FORMATS[format].channels;
  try {
    return (format === 'rgba8' ? new Uint8Array(n) : new Float32Array(n)) as PixelArray<F>;
  } catch {
    throw new GpuError(`A ${w} × ${h} px image is too large to hold in memory.`);
  }
}

/** `r` of `tex` into `out`, whose rows are `outWidth` px long, with its top left at (x, y) */
function readInto(e: Engine, tex: Texture, r: Rect, out: Uint8Array | Float32Array, outWidth: number, x: number, y: number): void {
  const { gl } = e;
  const f = FORMATS[tex.format];
  gl.bindFramebuffer(gl.FRAMEBUFFER, tex.glFramebuffer(e));
  if (f.channels === 4) {
    gl.pixelStorei(gl.PACK_ROW_LENGTH, outWidth);
    gl.readPixels(r.x, r.y, r.w, r.h, f.format, f.float ? gl.FLOAT : gl.UNSIGNED_BYTE, out, (y * outWidth + x) * f.channels);
    gl.pixelStorei(gl.PACK_ROW_LENGTH, 0);
    return;
  }
  // R16F reads back for certain only as RGBA floats (ANGLE offers RED only as half floats): keep
  // the reds, a band of rows at a time so a big tile doesn't need four times its size in memory
  const rows = Math.max(1, Math.min(r.h, Math.floor(BAND / r.w)));
  const rgba = new Float32Array(r.w * rows * 4);
  for (let top = 0; top < r.h; top += rows) {
    const n = Math.min(rows, r.h - top);
    gl.readPixels(r.x, r.y + top, r.w, n, gl.RGBA, gl.FLOAT, rgba);
    for (let row = 0; row < n; row++) {
      const to = (y + top + row) * outWidth + x;
      for (let i = 0; i < r.w; i++) out[to + i] = rgba[(row * r.w + i) * 4];
    }
  }
}
