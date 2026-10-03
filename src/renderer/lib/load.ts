// Loading images (spec §10.3): full resolution, alpha kept, and a plain sentence for anything that
// can't be read. Every GIF frame and DPI arrive with the tools that need them.

// only the worker imports tiff.ts, so utif2 stays out of the page's bundle
import { SvgError } from '../../shared/svg/xml.ts';
import type { TiffReply } from './tiff.worker.ts';

/** what createImageBitmap reads here, plus TIFF through utif2 and SVG through an <img> */
const READS = /^image\/(png|jpeg|webp|gif|bmp|avif|tiff|svg\+xml)$/;

const PSD = "PSD files aren't supported. Export a PNG or TIFF.";

/**
 * null when decodeImage can read a file of this type, else why not. `name` gives the extension when
 * the type is vague: Explorer hands over some files (PSD, HEIC) with no type at all.
 */
export function unsupportedImage(type: string, name = ''): string | null {
  if (READS.test(type)) return null;
  const ext = (/\.([a-z0-9]+)$/i.exec(name)?.[1] ?? type.split('/')[1] ?? '').toLowerCase();
  if (ext === 'psd' || type === 'image/vnd.adobe.photoshop') return PSD;
  if (ext === 'heic' || ext === 'heif') return "HEIC photos aren't supported. Export a JPEG or PNG.";
  if (!type) return null; // no type and no name that says: let the decoder decide
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
export async function decodeImage(blob: Blob, label = 'The image', { asShown = false } = {}): Promise<ImageBitmap> {
  // a file says its own name, with its extension, as every tool's message names it
  const name = blob instanceof File && blob.name ? blob.name : label;
  const why = unsupportedImage(blob.type, name);
  if (why) throw new Error(why);
  // by content, so a TIFF with a vague type or the wrong extension still opens, and a PSD renamed says what it is
  const head = new Uint8Array(await blob.slice(0, 4).arrayBuffer());
  if (String.fromCharCode(...head) === '8BPS') throw new Error(PSD);
  const tiff = tiffKind(head);
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

/**
 * What every tool says of a file it couldn't read, so the same failure reads the same everywhere:
 * "bad.svg couldn't be read as an SVG. The file may be damaged." The name keeps its extension.
 */
export const unreadable = (name: string, what = 'an image', why = 'The file may be damaged.'): string => `${name} couldn't be read as ${what}. ${why}`;

const damaged = (name: string) => unreadable(name);

/** runs `read` on an SVG file's markup; a refusal of the markup reads like any other unreadable file */
export async function asSvg<T>(name: string, read: () => T | Promise<T>): Promise<T> {
  try {
    return await read();
  } catch (e) {
    if (e instanceof SvgError) throw new Error(unreadable(name, 'an SVG', e.reason === 'damaged' ? undefined : "Its top element isn't <svg>."));
    throw e;
  }
}

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
