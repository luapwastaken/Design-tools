// The dither, off the window's thread (plan: the one rule): a frame at the working size in, its
// palette indices out. The preview, the playback and every export show what comes back from here.
import { linearOf, run, type Settings } from './engine.ts';

export type Job = {
  id: number;
  /** the frame's key; its pixels come only when the worker doesn't hold that frame already */
  frame: string;
  rgba?: Uint8ClampedArray;
  w: number;
  h: number;
  settings: Settings;
};
export type Done = { id: number; indices: Uint8Array; ms: number };
export type Failed = { id: number; error: string };

/** the last frame, linear, so a change of settings starts from it at once */
let held: { frame: string; img: Float32Array } | null = null;

self.onmessage = ({ data: j }: MessageEvent<Job>) => {
  const t0 = performance.now();
  try {
    if (j.rgba) held = { frame: j.frame, img: linearOf(j.rgba, j.w * j.h) };
    if (held?.frame !== j.frame) throw new Error('The frame went missing on its way to the dither. Open the image again.');
    const indices = run(held.img, j.w, j.h, j.settings);
    self.postMessage({ id: j.id, indices, ms: performance.now() - t0 } satisfies Done, { transfer: [indices.buffer] });
  } catch (e) {
    self.postMessage({ id: j.id, error: e instanceof Error ? e.message : String(e) } satisfies Failed);
  }
};
