// The CPU copy of the painting in and out of PNG (plan §4.5, §4.6). v2 is 2048 × 1280 RGBA8: sRGB
// colour, straight alpha, alpha the paint's height, written by our own encoder in a worker. v1 is
// the old 1024 × 640 opaque painting on white, which loads upscaled.
import type { PngJob, PngReply } from './png.worker.ts';

export const isV1 = (w: number, h: number): boolean => w === 1024 && h === 640;

let worker: Worker | null = null;
let next = 1;
const waiting = new Map<number, { ok(b: Blob): void; fail(e: Error): void }>();

/** the bytes as a v2 PNG, encoded in a worker; `bytes` is handed over and can't be used after */
export function encodePng(bytes: Uint8Array<ArrayBuffer>, width: number, height: number): Promise<Blob> {
  if (!worker) {
    worker = new Worker(new URL('./png.worker.ts', import.meta.url), { type: 'module' });
    worker.onmessage = ({ data }: MessageEvent<PngReply>) => {
      const w = waiting.get(data.id);
      waiting.delete(data.id);
      if ('png' in data) w?.ok(data.png);
      else w?.fail(new Error(data.error));
    };
    worker.onerror = () => {
      for (const w of waiting.values()) w.fail(new Error("The painting couldn't be encoded."));
      waiting.clear();
      worker?.terminate();
      worker = null;
    };
  }
  const id = next++;
  const w = worker;
  return new Promise<Blob>((ok, fail) => {
    waiting.set(id, { ok, fail });
    w.postMessage({ id, bytes, width, height } satisfies PngJob, [bytes.buffer]);
  });
}

/** 4 bytes as one word, in this machine's order */
export const word = (b: ArrayLike<number>): number => new Uint32Array(Uint8Array.from(b).buffer)[0];

/** every pixel is bare paper: height 0 and exactly the paper's colour */
export function isBlank(cpu: Uint8Array, paper: number): boolean {
  const px = new Uint32Array(cpu.buffer, cpu.byteOffset, cpu.byteLength / 4);
  for (let i = 0; i < px.length; i++) if (px[i] !== paper) return false;
  return true;
}
