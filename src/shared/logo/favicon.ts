// The favicon and app-icon bundle from the icon: which files to write and what each one draws, the
// ICO writer, the web manifest. Rendering the PNGs needs a canvas, so the tool does that.
import { layoutLockup, usable } from './layout.ts';
import { drawn, groundFor, type Ground } from './svg.ts';
import type { Lockup, LogoDoc, Version } from './types.ts';

export type FaviconFile =
  /** `svg` drawn at size × size px */
  | { name: string; kind: 'png'; size: number; svg: string }
  /** `svg` drawn at each size, then writeIco */
  | { name: string; kind: 'ico'; sizes: number[]; svg: string }
  | { name: string; kind: 'text'; text: string };

const SIDE = 512;
/** what the touch icon sits on: iOS would fill a transparent one with black */
export const TOUCH = { light: '#ffffff', dark: '#000000' };
const ICON: Lockup = { kind: 'icon', on: true, ratio: 1, gap: 0, align: 'center' };
const PNG_SIGNATURE = [137, 80, 78, 71, 13, 10, 26, 10];

/**
 * The icon centred in a square, as large as fits inside `inset` (a share of the side kept clear on
 * each edge; v1 left 43% of the tile empty). `background` fills the square; knockout brings its field.
 */
export function faviconSvg(doc: LogoDoc, version: Version = 'original', opts: { inset?: number; background?: string } = {}): string {
  if (!usable(doc.icon)) throw new Error('The favicon is made from the icon. Add an icon first.');
  const lay = layoutLockup(doc, ICON);
  const room = SIDE * (1 - 2 * (opts.inset ?? 0));
  const u = room / Math.max(lay.w, lay.h);
  return drawn(doc, 'icon', lay, version, SIDE, SIDE, { ox: (SIDE - lay.w * u) / 2, oy: (SIDE - lay.h * u) / 2, u }, opts.background);
}

/**
 * The bundle. Browser favicons and Android icons are transparent and fill their square; iOS fills
 * a transparent touch icon with black and rounds its corners, so that one is opaque with a margin.
 * `ground`: what the original icon shows on, when the caller drew it to see (svg.ts groundFor).
 */
export function faviconFiles(doc: LogoDoc, version: Version = 'original', name = 'Logo', ground?: Ground): FaviconFile[] {
  const svg = faviconSvg(doc, version);
  const background = groundFor(doc, version, TOUCH.light, TOUCH.dark, ground);
  const touch = faviconSvg(doc, version, { inset: 0.12, background });
  return [
    { name: 'favicon.ico', kind: 'ico', sizes: [16, 32, 48], svg },
    ...[16, 32, 48].map((size) => ({ name: `favicon-${size}x${size}.png`, kind: 'png' as const, size, svg })),
    { name: 'apple-touch-icon.png', kind: 'png', size: 180, svg: touch },
    { name: 'android-chrome-192x192.png', kind: 'png', size: 192, svg },
    { name: 'android-chrome-512x512.png', kind: 'png', size: 512, svg },
    { name: 'icon.svg', kind: 'text', text: svg },
    { name: 'site.webmanifest', kind: 'text', text: webmanifest(name, background) },
  ];
}

/** a launcher shows about 12 characters under an icon */
const SHORT = 12;

export function webmanifest(name: string, background = '#ffffff'): string {
  const icons = [192, 512].map((s) => ({ src: `android-chrome-${s}x${s}.png`, sizes: `${s}x${s}`, type: 'image/png' }));
  const first = name.trim().split(/\s+/)[0] ?? name;
  const short = name.length <= SHORT ? name : first.length <= SHORT ? first : first.slice(0, SHORT);
  return `${JSON.stringify({ name, short_name: short, icons, display: 'standalone', background_color: background, theme_color: background }, null, 2)}\n`;
}

/**
 * An ICO holding PNGs (Windows Vista on, every browser): a 6-byte header, a 16-byte entry per image,
 * then the PNGs as they are. Each must be a square PNG of its stated size, so the directory can't lie.
 */
export function writeIco(pngs: { size: number; data: Uint8Array }[]): Uint8Array {
  if (!pngs.length) throw new Error('An ICO needs at least one image.');
  for (const { size, data } of pngs) {
    if (!Number.isInteger(size) || size < 1 || size > 256) throw new Error(`An ICO image is 1 to 256 px, not ${size}.`);
    const v = new DataView(data.buffer, data.byteOffset, data.byteLength);
    const png = data.length >= 24 && PNG_SIGNATURE.every((b, i) => data[i] === b);
    if (!png || v.getUint32(16) !== size || v.getUint32(20) !== size) throw new Error(`The ${size} px icon isn't a ${size} × ${size} PNG.`);
  }
  const head = 6 + 16 * pngs.length;
  const out = new Uint8Array(head + pngs.reduce((t, p) => t + p.data.length, 0));
  const v = new DataView(out.buffer);
  v.setUint16(2, 1, true); // type 1: icon
  v.setUint16(4, pngs.length, true);
  let at = head;
  pngs.forEach(({ size, data }, i) => {
    const e = 6 + 16 * i;
    out[e] = out[e + 1] = size % 256; // 256 is written as 0
    v.setUint16(e + 4, 1, true); // colour planes
    v.setUint16(e + 6, 32, true); // bits per pixel
    v.setUint32(e + 8, data.length, true);
    v.setUint32(e + 12, at, true);
    out.set(data, at);
    at += data.length;
  });
  return out;
}
