// Loading images (spec §10.3): full resolution, alpha kept, and a plain sentence for anything that
// can't be read. TIFF, every GIF frame and DPI arrive with the tools that need them.

/** what createImageBitmap reads here, plus SVG through an <img> */
const READS = /^image\/(png|jpeg|webp|gif|bmp|avif|svg\+xml)$/;

/** null when decodeImage can read a file of this type, else why not. `name` gives the extension when the type is vague. */
export function unsupportedImage(type: string, name = ''): string | null {
  if (!type || READS.test(type)) return null; // no type: let the decoder decide
  const ext = (/\.([a-z0-9]+)$/i.exec(name)?.[1] ?? type.split('/')[1] ?? '').toLowerCase();
  if (ext === 'psd' || type === 'image/vnd.adobe.photoshop') return "PSD files aren't supported. Export a PNG or TIFF.";
  if (ext === 'tif' || ext === 'tiff') return "TIFF files can't be opened here yet. Export a PNG or JPEG.";
  if (ext === 'heic' || ext === 'heif') return "HEIC photos aren't supported. Export a JPEG or PNG.";
  const what = /^[a-z0-9]{1,5}$/.test(ext) ? `${ext.toUpperCase()} files aren't` : "This file isn't";
  return `${what} an image this tool can open. Use a PNG, JPEG, WebP, GIF, BMP, AVIF or SVG.`;
}

/**
 * The image at full resolution with its alpha as stored (no premultiplying). Its values as stored
 * too (no colour conversion), which image processing wants; `{ asShown: true }` converts an embedded
 * profile (a Display P3 screenshot, an Adobe RGB photo) to sRGB, for taking colours as they look.
 * GIFs give their first frame. Rejects with a plain sentence, never hangs, on anything unreadable.
 */
export async function decodeImage(blob: Blob, name = 'The image', { asShown = false } = {}): Promise<ImageBitmap> {
  const why = unsupportedImage(blob.type, name);
  if (why) throw new Error(why);
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
    throw new Error(`${name} couldn't be read as an image. The file may be damaged.`);
  }
}
