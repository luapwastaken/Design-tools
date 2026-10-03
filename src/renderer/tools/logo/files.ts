// What each export writes, as bytes or text; Export.tsx hands them to the shared export path, and
// the smoke pass reads the same files back (the ICO, the lockup SVG).
import { faviconFiles, faviconSvg, TOUCH, writeIco } from '../../../shared/logo/favicon.ts';
import { layoutLockup, usable } from '../../../shared/logo/layout.ts';
import { brandSheetSvg, PAPER } from '../../../shared/logo/sheet.ts';
import { lockupSvg, NOTHING, previewSvg } from '../../../shared/logo/svg.ts';
import { parseSize } from '../../../shared/svg/index.ts';
import { KIND_FILE, shownLockups, shownVersions, type Lockup, type LogoDoc, type Version } from './doc.ts';
import { pngSize } from './geometry.ts';
import { bytes, groundOf, pngOf } from './raster.ts';

export type OutFile = { name: string; data: ArrayBuffer | string };

export const buffer = async (b: Blob | Uint8Array): Promise<ArrayBuffer> => {
  const u = b instanceof Blob ? await bytes(b) : b;
  return u.buffer.slice(u.byteOffset, u.byteOffset + u.byteLength) as ArrayBuffer;
};

/** the file's name: "Acme horizontal black" */
export const fileName = (name: string, l: Lockup, v: Version): string => `${name} ${KIND_FILE[l.kind]} ${v}`;

/** a lockup's PNG: its SVG with the export padding, the document's PNG height tall */
export async function lockupPng(d: LogoDoc, l: Lockup, v: Version, dpi: number): Promise<Blob> {
  const px = pngSize(d, layoutLockup(d, l), v);
  return pngOf(lockupSvg(d, l, v, { padding: d.exportPadding, height: d.pngHeight }), px.w, px.h, dpi);
}

/** every lockup that's on in every version that's on, as SVG and PNG */
export async function everyFile(d: LogoDoc, name: string, dpi: number): Promise<OutFile[]> {
  const files: OutFile[] = [];
  for (const l of shownLockups(d))
    for (const v of shownVersions(d)) {
      files.push({ name: `${fileName(name, l, v)}.svg`, data: lockupSvg(d, l, v, { padding: d.exportPadding }) });
      files.push({ name: `${fileName(name, l, v)}.png`, data: await buffer(await lockupPng(d, l, v, dpi)) });
    }
  return files;
}

/** the favicon bundle's files, each drawn at its own pixel size; the ICO holds PNGs of its sizes */
export async function faviconBundle(d: LogoDoc, v: Version, name: string): Promise<OutFile[]> {
  const png = (svg: string, size: number) => pngOf(svg, size, size, 72);
  // the touch icon's ground, from how the icon's own colours cover it
  const ground = v === 'original' && usable(d.icon) ? await groundOf(faviconSvg(d, v), TOUCH.light, TOUCH.dark) : undefined;
  return Promise.all(
    faviconFiles(d, v, name, ground).map(async (f) => ({
      name: f.name,
      data:
        f.kind === 'text'
          ? f.text
          : f.kind === 'png'
            ? await buffer(await png(f.svg, f.size))
            : await buffer(writeIco(await Promise.all(f.sizes.map(async (size) => ({ size, data: await bytes(await png(f.svg, size)) }))))),
    })),
  );
}

/** the brand sheet, its original version on the ground the logo's own colours read best on */
export async function sheetSvg(d: LogoDoc, name: string): Promise<string> {
  const main = previewSvg(d);
  if (!main) throw new Error(NOTHING);
  return brandSheetSvg(d, { name, ground: await groundOf(main, PAPER.light, PAPER.dark) });
}

/** the brand sheet as a PNG at twice its size */
export async function sheetPng(d: LogoDoc, name: string): Promise<ArrayBuffer> {
  const svg = await sheetSvg(d, name);
  const { width, height } = parseSize(svg);
  return buffer(await pngOf(svg, Math.round(width * 2), Math.round(height * 2), 144));
}
