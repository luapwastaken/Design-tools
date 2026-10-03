// What a pass may ask for (see index.ts), checked before any GL call. Pure, so it is unit tested
// (test/gpu.test.ts).
import { GpuError } from './errors.ts';
import type { Rect } from './tiles.ts';

/**
 * how a pass lands on what's there: replace it, paint over it (straight alpha), multiply
 * (overprint), add, keep the larger (max), or move toward it by the pass's blendConstant (constant)
 */
export type Blend = 'none' | 'over' | 'multiply' | 'add' | 'max' | 'constant';
export const BLENDS: readonly Blend[] = ['none', 'over', 'multiply', 'add', 'max', 'constant'];

type Sized = { width: number; height: number };
export type PassShape = {
  outputs: readonly Sized[];
  /** false when the output is one tile of a larger image */
  whole: boolean;
  inputs: readonly unknown[];
  blend?: Blend | readonly Blend[];
  blendConstant?: number;
  rect?: Rect;
  drawBuffers: number;
  indexedBlend: boolean;
};

export const rectInside = (r: Rect, w: number, h: number): boolean =>
  [r.x, r.y, r.w, r.h].every(Number.isInteger) && r.x >= 0 && r.y >= 0 && r.w >= 1 && r.h >= 1 && r.x + r.w <= w && r.y + r.h <= h;

export const rectText = (r: Rect, w: number, h: number): string => `${r.w} × ${r.h} px at ${r.x}, ${r.y} isn't inside the ${w} × ${h} px texture.`;

/** The blend of each output, once the pass is known to be one GL can draw; throws GpuError otherwise. */
export function checkPass(o: PassShape): Blend[] {
  const n = o.outputs.length;
  if (!n) throw new GpuError('A pass needs at least one output.');
  if (n > o.drawBuffers) throw new GpuError(`This graphics card draws into at most ${o.drawBuffers} textures at once, not ${n}.`);
  const [first] = o.outputs;
  if (o.outputs.some((t) => t.width !== first.width || t.height !== first.height)) throw new GpuError('Every output of a pass must be the same size.');
  if (new Set(o.outputs).size !== n) throw new GpuError('A pass lists the same output twice.');
  if (o.outputs.some((t) => o.inputs.includes(t))) throw new GpuError("A pass can't read the texture it draws into; use a chain.");
  const list = Array.isArray(o.blend) ? [...o.blend] : Array<Blend>(n).fill((o.blend as Blend | undefined) ?? 'none');
  if (list.length !== n) throw new GpuError(`A pass with ${n} outputs gives ${n} blends, not ${list.length}.`);
  const bad = list.find((b) => !BLENDS.includes(b));
  if (bad) throw new GpuError(`${bad} isn't a blend; use ${BLENDS.join(', ')}.`);
  if (new Set(list).size > 1 && !o.indexedBlend) throw new GpuError('Different blends per output need OES_draw_buffers_indexed, which this graphics card lacks.');
  if (list.includes('constant') && !(o.blendConstant !== undefined && o.blendConstant >= 0 && o.blendConstant <= 1)) {
    throw new GpuError('A constant blend needs a blendConstant from 0 to 1.');
  }
  if (o.rect) {
    if (!o.whole) throw new GpuError('A rect limits a pass into a whole texture, not a tile.');
    if (!rectInside(o.rect, first.width, first.height)) throw new GpuError(rectText(o.rect, first.width, first.height));
  }
  return list;
}

/** A copy between two textures, checked; throws GpuError otherwise. */
export function checkCopy(src: Sized & { format: string }, dst: Sized & { format: string }, from: Rect, to: { x: number; y: number }): void {
  if (src === dst) throw new GpuError("A copy can't read and write the same texture.");
  if (src.format !== dst.format) throw new GpuError(`A copy needs two textures of one format, not ${src.format} and ${dst.format}.`);
  if (!rectInside(from, src.width, src.height)) throw new GpuError(rectText(from, src.width, src.height));
  const at = { x: to.x, y: to.y, w: from.w, h: from.h };
  if (!rectInside(at, dst.width, dst.height)) throw new GpuError(rectText(at, dst.width, dst.height));
}
