// Loading images (spec §10.3): full resolution, alpha kept, and a plain sentence for anything that
// can't be read. Every GIF frame and DPI arrive with the tools that need them.

// only the worker imports tiff.ts, so utif2 stays out of the page's bundle
import type { TiffReply } from './tiff.worker.ts';

/** what createImageBitmap reads here, plus TIFF through utif2 and SVG through an <img> */
const READS = /^image\/(png|jpeg|webp|gif|bmp|avif|tiff|svg\+xml)$/;

/** null when decodeImage can read a file of this type, else why not. `name` gives the extension when the type is vague. */
export function unsupportedImage(type: string, name = ''): string | null {
  if (!type || READS.test(type)) return null; // no type: let the decoder decide
  const ext = (/\.([a-z0-9]+)$/i.exec(name)?.[1] ?? type.split('/')[1] ?? '').toLowerCase();
  if (ext === 'psd' || type === 'image/vnd.adobe.photoshop') return "PSD files aren't supported. Export a PNG or TIFF.";
  if (ext === 'heic' || ext === 'heif') return "HEIC photos aren't supported. Export a JPEG or PNG.";
  const what = /^[a-z0-9]{1,5}$/.test(ext) ? `${ext.toUpperCase()} files aren't` : "This file isn't";
  return `${what} an image this tool can open. Use a PNG, JPEG, WebP, GIF, BMP, AVIF, TIFF or SVG.`;
}

/**
 * The image at full resolution with its alpha as stored (no premultiplying). Its values as stored
 * too (no colour conversion), which image processing wants; `{ asShown: true }` converts an embedded
 * profile (a Display P3 screenshot, an Adobe RGB photo) to sRGB, for taking colours as they look.
 * GIFs give their first frame; TIFFs their largest page, 16-bit rounded to 8, with any embedded
 * profile left unapplied. Rejects with a plain sentence, never hangs, on anything unreadable.
 */
export async function decodeImage(blob: Blob, name = 'The image', { asShown = false } = {}): Promise<ImageBitmap> {
  const why = unsupportedImage(blob.type, name);
  if (why) throw new Error(why);
  // by content, so a TIFF with a vague type or the wrong extension still opens
  const tiff = tiffKind(new Uint8Array(await blob.slice(0, 4).arrayBuffer()));
  if (tiff === 'big') throw new Error(`${name} is a BigTIFF, which can't be opened here. Save it as a standard TIFF or a PNG.`);
  if (tiff) return readInWorker(blob, name);
  try {
    if (blob.type !== 'image/svg+xml') return await createImageBitmap(blob, { premultiplyAlpha: 'none', colorSpaceConversion: asShown ? 'default' : 'none' });
    // createImageBitmap can't read SVG; an <img> can, in a document of its own
    const img = new Image();
    img.src = URL.createObjectURL(blob);
    try {
      await img.decode();
      return await createImageBitmap(img);
    } finally {
      URL.revokeObjectURL(img.src);
    }
  } catch {
    throw new Error(damaged(name));
  }
}

const damaged = (name: string) => `${name} couldn't be read as an image. The file may be damaged.`;

/** 'II' then 42 little-endian, or 'MM' then 42 big-endian; 43 is a BigTIFF (64-bit offsets, which utif2 can't follow) */
export function tiffKind(b: Uint8Array): 'tiff' | 'big' | null {
  const version = b[0] === 0x49 && b[1] === 0x49 ? b[2] | (b[3] << 8) : b[0] === 0x4d && b[1] === 0x4d ? (b[2] << 8) | b[3] : 0;
  return version === 42 ? 'tiff' : version === 43 ? 'big' : null;
}

function readInWorker(blob: Blob, name: string): Promise<ImageBitmap> {
  const worker = new Worker(new URL('./tiff.worker.ts', import.meta.url), { type: 'module' });
  return new Promise<ImageBitmap>((ok, fail) => {
    worker.onmessage = ({ data: r }: MessageEvent<TiffReply>) => ('bitmap' in r ? ok(r.bitmap) : fail(new Error(r.unsupported ? `${name} ${r.error}` : damaged(name))));
    worker.onerror = () => fail(new Error(damaged(name)));
    worker.postMessage(blob);
  }).finally(() => worker.terminate());
}
