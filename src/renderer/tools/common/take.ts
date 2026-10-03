// Taking things from outside a tool: an image's pixels (an SVG's paints are shared/svg's svgColours)
// for the colour tools, and what the image tools share in opening a dropped file.
import { toHex, type Oklch } from '../../../shared/color/index.ts';
import type { LibraryItemRef, ToolId } from '../../../shared/types.ts';
import { asSvg, decodeImage, unsupportedImage } from '../../lib/load.ts';
import { ipc } from '../../shell/core/ipc.ts';
import { rasterize } from '../../shell/core/rasterize.ts';

/** a Library item's file (dt://) */
export async function fetchBlob(url: string, name: string): Promise<Blob> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Couldn't read ${name}.`);
  return res.blob();
}

/** a file's name without its extension: the name a document takes */
export const baseName = (file: string): string => file.replace(/\.[^.]*$/, '') || 'Pasted image';
export const extOf = (blob: Blob, name: string): string => (/\.([a-z0-9]{1,8})$/i.exec(name)?.[1] ?? /^image\/([a-z]+)/.exec(blob.type)?.[1] ?? 'png').toLowerCase();
export const isSvg = (f: File): boolean => f.type === 'image/svg+xml' || /\.svg$/i.test(f.name);
export const isImage = (f: File): boolean => isSvg(f) || (f.type.startsWith('image/') && !unsupportedImage(f.type, f.name)) || /\.tiff?$/i.test(f.name);

/** a file the image tools take on: an image, or one they can say plainly why they can't open (a PSD, a HEIC) */
export const claims = (f: File): boolean => isImage(f) || /\.(psd|heic|heif)$/i.test(f.name);

/** an SVG file drawn as the shell draws a Library SVG "as an image": 4096 px on its long side; a refusal names the file */
export async function svgAsPng(file: File): Promise<Blob> {
  const url = URL.createObjectURL(file);
  try {
    return await asSvg(file.name, () => rasterize({ kind: 'svg', url, ref: { name: baseName(file.name) } as LibraryItemRef }));
  } finally {
    URL.revokeObjectURL(url);
  }
}

/** a source copied into the tool's workspace at full resolution (foundation spec §7.2): its dt:// url */
export const putAsset = async (tool: ToolId, blob: Blob, ext: string): Promise<string> => (await ipc.invoke('workspace.putAsset', tool, await blob.arrayBuffer(), ext)).url;

/** extractColours subsamples to this many pixels anyway; shrinking first keeps re-runs instant */
const MAX_PX = 40_000;

/** the image as it looks, shrunk to at most MAX_PX pixels */
export async function pixelsOf(blob: Blob, name: string): Promise<ImageData> {
  // colours as the image looks, so a Display P3 screenshot isn't read as if it were sRGB
  const bmp = await decodeImage(blob, name, { asShown: true });
  const k = Math.min(1, Math.sqrt(MAX_PX / (bmp.width * bmp.height)));
  const w = Math.max(1, Math.round(bmp.width * k));
  const h = Math.max(1, Math.round(bmp.height * k));
  const ctx = new OffscreenCanvas(w, h).getContext('2d')!;
  ctx.imageSmoothingEnabled = false; // real pixels, not blends of neighbours
  ctx.drawImage(bmp, 0, 0, w, h);
  bmp.close();
  return ctx.getImageData(0, 0, w, h);
}

export const unique = (list: Oklch[]): Oklch[] => [...new Map(list.map((o) => [toHex(o), o])).values()];
