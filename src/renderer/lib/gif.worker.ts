// The GIF encoder off the page's thread: compressing a 1080p frame takes about 20 ms, and finding
// the colours of an RGBA frame 0.1 s more, so a long export would otherwise stall the window.
import { gifWriter, type FrameImage } from './gif.ts';

export type GifJob = { frame: FrameImage; cs: number; scale: number } | { finish: true };
export type GifReply = { ok: true } | { bytes: Uint8Array<ArrayBuffer> } | { error: string };

const gif = gifWriter();

self.onmessage = ({ data }: MessageEvent<GifJob>) => {
  try {
    if ('finish' in data) {
      const bytes = gif.finish() as Uint8Array<ArrayBuffer>;
      self.postMessage({ bytes } satisfies GifReply, { transfer: [bytes.buffer] });
    } else {
      gif.add(data.frame, data.cs, data.scale);
      self.postMessage({ ok: true } satisfies GifReply);
    }
  } catch (e) {
    self.postMessage({ error: e instanceof Error ? e.message : String(e) } satisfies GifReply);
  }
};
