// The painting's PNG off the page's thread: deflating 10 MB takes longer than a frame.
import { rgbaPng } from '../../../lib/png.ts';

export type PngJob = { id: number; bytes: Uint8Array; width: number; height: number };
export type PngReply = { id: number; png: Blob } | { id: number; error: string };

self.onmessage = async ({ data }: MessageEvent<PngJob>) => {
  try {
    self.postMessage({ id: data.id, png: await rgbaPng(data.bytes, data.width, data.height) } satisfies PngReply);
  } catch (e) {
    self.postMessage({ id: data.id, error: e instanceof Error ? e.message : String(e) } satisfies PngReply);
  }
};
