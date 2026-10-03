// Parts in (Logo plan unit T): an icon or a wordmark from SVG markup or an image, ready for the
// lockups. Everything is measured by the artwork, never the file's box: an artboard's padding or a
// PNG's transparent margin changes nothing (v1's biggest layout error). A wordmark also gets its
// cap height and baseline, when it reads as a line of type.
import { hexToOklch } from '../../../shared/color/index.ts';
import { isPaper } from '../../../shared/logo/svg.ts';
import { clipToView, namespace, parseSize } from '../../../shared/svg/index.ts';
import { parseSvg, walk } from '../../../shared/svg/xml.ts';
import { asSvg, decodeImage } from '../../lib/load.ts';
import { measureArtwork } from '../../lib/svg-measure.ts';
import { measureType } from '../../lib/type-metrics.ts';
import type { Part, Role } from './doc.ts';
import { drawSvg } from './raster.ts';

/** ids of their own, so two Illustrator exports ("Layer_1", ".cls-1") never restyle each other */
const prefix = (role: Role) => `${role}-${crypto.randomUUID().slice(0, 8)}`;

const DRAWS = new Set(['path', 'rect', 'circle', 'ellipse', 'line', 'polyline', 'polygon', 'text', 'use']);
/** the most pixels a side of a picture taken out of an SVG gets */
const PICTURE_MAX = 4096;

/**
 * SVG markup as a part: namespaced, measured, and clipped to its viewBox, so it looks as the file
 * does on its own however far from the artboard stray art lies (Illustrator keeps the pasteboard).
 * An SVG that only wraps a picture (a converter's, Canva's) is taken as that picture.
 */
export async function partFromSvg(svg: string, name: string, role: Role, label = name): Promise<Part> {
  const id = prefix(role);
  // `label` names a dropped file, extension and all, as every tool's message does
  const markup = await asSvg(label, () => namespace(svg.trim(), id));
  const picture = pictureOnly(markup);
  if (picture) return partFromImage(await pictureOf(markup, picture), name, role);
  const m = await measureArtwork(markup).catch((e: Error) => {
    throw new Error(`${name} can't be the ${role}. ${e.message}`);
  });
  // namespace() prefixed every id with `${id}-`, so this one is free
  return typed({ svg: clipToView(markup, `${id}_view`), png: null, name, box: { x: m.x, y: m.y, w: m.w, h: m.h } }, role);
}

/** the pixel width of the one picture an SVG holds when it draws nothing else, else null */
function pictureOnly(svg: string): { href: string; width: number } | null {
  let image: { href: string; width: number } | null = null;
  for (const { el, inside } of walk(parseSvg(svg))) {
    if (inside.some((n) => n === 'defs' || n === 'clipPath' || n === 'mask' || n === 'symbol' || n === 'pattern')) continue;
    if (DRAWS.has(el.name)) return null;
    if (el.name !== 'image') continue;
    if (image) return null;
    const href = el.attrs.find((a) => /(^|:)href$/.test(a.name))?.value ?? '';
    image = { href, width: Number.parseFloat(el.attrs.find((a) => a.name === 'width')?.value ?? '') };
  }
  return image;
}

/** the SVG drawn at its picture's own resolution, as an image file */
async function pictureOf(svg: string, picture: { href: string; width: number }): Promise<Blob> {
  const img = new Image();
  img.src = picture.href;
  const natural = await img.decode().then(() => img.naturalWidth, () => 0);
  const { viewBox } = parseSize(svg);
  const k = natural && picture.width > 0 ? natural / picture.width : 1024 / Math.max(viewBox[2], viewBox[3]);
  const s = Math.min(k, PICTURE_MAX / Math.max(viewBox[2], viewBox[3]));
  const c = await drawSvg(svg, Math.max(1, Math.round(viewBox[2] * s)), Math.max(1, Math.round(viewBox[3] * s)));
  return c.convertToBlob({ type: 'image/png' });
}

/**
 * An image as a part: its transparent margin trimmed off, kept as a PNG data URL, so `box` is its
 * trimmed pixel size. A picture that is opaque across its artwork would show as a solid block in
 * every colour version (a v1 failure), so it is turned away, a transparent border round it or not.
 */
export async function partFromImage(image: Blob, name: string, role: Role): Promise<Part> {
  // as it looks: an embedded profile is converted, since the PNG written back carries none
  const bmp = await decodeImage(image, name, { asShown: true });
  const { width: w, height: h } = bmp;
  const ctx = new OffscreenCanvas(w, h).getContext('2d', { willReadFrequently: true })!;
  ctx.drawImage(bmp, 0, 0);
  bmp.close();
  const a = ctx.getImageData(0, 0, w, h).data;
  let [x0, y0, x1, y1] = [w, h, -1, -1];
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (!a[(y * w + x) * 4 + 3]) continue;
      x0 = Math.min(x0, x);
      x1 = Math.max(x1, x);
      y0 = Math.min(y0, y);
      y1 = y;
    }
  }
  if (x1 < 0) throw new Error(`${name} is empty: every pixel is transparent.`);
  const box = { x: 0, y: 0, w: x1 + 1 - x0, h: y1 + 1 - y0 };
  const trimmed = new OffscreenCanvas(box.w, box.h);
  const tc = trimmed.getContext('2d', { willReadFrequently: true })!;
  tc.drawImage(ctx.canvas, x0, y0, box.w, box.h, 0, 0, box.w, box.h);
  const pixels = tc.getImageData(0, 0, box.w, box.h);
  let clear = 0;
  for (let i = 3; i < pixels.data.length; i += 4) if (pixels.data[i] < 255) clear++;
  // a rounded badge's corners are clear; a photo's hard edge isn't
  if (clear < 0.01 * box.w * box.h) throw new Error(`${name} has no transparent background. Use an SVG, or a PNG with one.`);
  const png = await dataUrl(await trimmed.convertToBlob({ type: 'image/png' }));
  const silhouette = await dataUrl(await silhouetteOf(pixels));
  return typed({ svg: null, png, name, box, silhouette }, role);
}

/**
 * White where the image paints, as much as it paints there: what a one-colour version fills. Its
 * near-white paper is left clear, when the image paints darker too, as svg.ts cuts it from vectors.
 */
function silhouetteOf(pixels: ImageData): Promise<Blob> {
  const d = pixels.data;
  const paper = new Map<number, boolean>();
  const isPaperAt = (i: number) => {
    const rgb = (d[i] << 16) | (d[i + 1] << 8) | d[i + 2];
    let p = paper.get(rgb);
    if (p === undefined) paper.set(rgb, (p = isPaper(hexToOklch(`#${rgb.toString(16).padStart(6, '0')}`))));
    return p;
  };
  let [ink, white] = [0, 0];
  for (let i = 0; i < d.length; i += 4) if (d[i + 3] >= 128) isPaperAt(i) ? white++ : ink++;
  const cut = white > 0 && ink > 0;
  const out = new ImageData(pixels.width, pixels.height);
  for (let i = 0; i < d.length; i += 4) {
    out.data[i] = out.data[i + 1] = out.data[i + 2] = 255;
    out.data[i + 3] = cut && d[i + 3] && isPaperAt(i) ? 0 : d[i + 3];
  }
  const c = new OffscreenCanvas(pixels.width, pixels.height);
  c.getContext('2d')!.putImageData(out, 0, 0);
  return c.convertToBlob({ type: 'image/png' });
}

/**
 * The same part measured for the other job, as when icon and wordmark swap: a wordmark gets its type
 * metrics, an icon drops them. The markup and pixels stay as they are.
 */
export async function partAs(part: Part, role: Role): Promise<Part> {
  const { type: _, ...rest } = part;
  return typed(rest, role);
}

async function typed(part: Part, role: Role): Promise<Part> {
  if (role !== 'wordmark') return part;
  const type = await measureType(part);
  return type ? { ...part, type } : part;
}

function dataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result as string);
    r.onerror = () => reject(new Error("The image couldn't be kept."));
    r.readAsDataURL(blob);
  });
}
