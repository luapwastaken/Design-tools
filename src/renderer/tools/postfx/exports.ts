// What each export writes: the stack (effects/stack.ts, the preview's own passes) at full resolution
// on the frame it names, read back as 8-bit RGBA with its alpha. One frame is a PNG; a loop goes
// through media.ts's exportAnimation, the shared animated path (lib/frames), in order.
import { gpuScope, type Texture } from '../../lib/gpu/index.ts';
import { timeline, type PostFxDoc, type Source } from './doc.ts';
import { Stack } from './effects/stack.ts';
import { exportAnimation, openMedia } from './media.ts';

type Progress = (done: number, detail?: string) => void;

/** what a canvas here can make into a PNG, as the other image tools */
const MAX_PX = 64e6;

let limits: ReturnType<typeof gpuScope> | null = null;
const px = (w: number, h: number) => `${w.toLocaleString('en')} × ${h.toLocaleString('en')} px`;

/** why this source can't be exported at full resolution, or null */
export function sizeLimit(s: Pick<Source, 'w' | 'h'>): string | null {
  const max = (limits ??= gpuScope('postfx limits')).maxSize;
  if (max && Math.max(s.w, s.h) > max) return `${px(s.w, s.h)} is wider than this graphics card can process at once (${max.toLocaleString('en')} px a side). Scale it down first.`;
  if (s.w * s.h > MAX_PX) return `${px(s.w, s.h)} is more than a PNG here can hold (64 megapixels). Scale it down first.`;
  return null;
}

/** the stack on one source frame, at full resolution: RGBA bytes, straight alpha, rows from the top */
function runOn(stack: Stack, src: Texture, d: PostFxDoc, frame: number, t: number): Uint8ClampedArray<ArrayBuffer> {
  const out = stack.render(src, d.stack, { t, frame: d.source!.kind === 'video' ? frame : null, scale: 1 });
  const bytes = stack.bytes(out);
  return new Uint8ClampedArray(bytes.buffer as ArrayBuffer, bytes.byteOffset, bytes.length);
}

/** frame `frame` of the timeline (the one on screen) as a PNG, full resolution, alpha kept */
export async function pngBlob(d: PostFxDoc, frame: number): Promise<Blob> {
  const s = d.source;
  if (!s) throw new Error('There is no image to export yet.');
  const why = sizeLimit(s);
  if (why) throw new Error(why);
  const t = timeline(d);
  const media = await openMedia(s);
  const stack = new Stack('postfx export');
  try {
    const img = await media.frame(s.kind === 'image' ? 0 : frame);
    const src = stack.g.texture(img, 'rgba16f');
    img.close();
    const data = runOn(stack, src, d, frame, t.count > 1 ? t.phase(frame) : 0);
    const canvas = new OffscreenCanvas(s.w, s.h);
    canvas.getContext('2d')!.putImageData(new ImageData(data, s.w, s.h), 0, 0);
    return await canvas.convertToBlob({ type: 'image/png' });
  } finally {
    stack.release();
    media.close();
  }
}

/** every frame of one loop, in order, as a GIF or numbered PNGs (spec §3: exact frame counts, a loop that repeats) */
export async function framesTo(d: PostFxDoc, to: 'gif' | 'folder', name: string, progress?: Progress, signal?: AbortSignal) {
  const s = d.source;
  if (!s) throw new Error('There is no image to export yet.');
  const why = sizeLimit(s);
  if (why) throw new Error(why);
  const stack = new Stack('postfx export');
  let src: Texture | null = null;
  try {
    return await exportAnimation({
      source: s,
      timing: timeline(d),
      to,
      name,
      progress,
      signal,
      render: async (image, i, t) => {
        // a still goes up once; a GIF's or a clip's frames each in turn
        if (!src) src = stack.g.texture(image, 'rgba16f');
        else if (s.kind !== 'image') src.upload(image);
        return { data: runOn(stack, src, d, i, t), width: s.w, height: s.h };
      },
    });
  } finally {
    stack.release();
  }
}
