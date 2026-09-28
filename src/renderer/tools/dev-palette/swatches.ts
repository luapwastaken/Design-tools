// DEV ONLY (plan unit D): deleted when the Design tool lands.
import { toOklch, type Oklch } from '../../../shared/color/index.ts';
import type { Swatch } from '../../../shared/types.ts';

export type PaletteDoc = { swatches: Swatch[]; notes: string };

export const newSwatch = (name: string, oklch: Oklch): Swatch => ({ id: crypto.randomUUID(), name, role: null, oklch, type: 'process' });

export const mapSwatch = (d: PaletteDoc, id: string, fn: (w: Swatch) => Swatch): PaletteDoc => ({
  ...d,
  swatches: d.swatches.map((w) => (w.id === id ? fn(w) : w)),
});

const N = 5;

/** Five real pixels spread over the image: nearest-neighbour down to 5×5, then its diagonal. */
export async function pickColours(url: string, name: string): Promise<Swatch[]> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Couldn't read ${name}.`);
  const bmp = await createImageBitmap(await res.blob(), { resizeWidth: N, resizeHeight: N, resizeQuality: 'pixelated' });
  const ctx = new OffscreenCanvas(N, N).getContext('2d')!;
  ctx.drawImage(bmp, 0, 0);
  bmp.close();
  const px = ctx.getImageData(0, 0, N, N).data;
  return Array.from({ length: N }, (_, i) => {
    const o = i * (N + 1) * 4;
    return newSwatch(`${name} ${i + 1}`, toOklch({ mode: 'rgb', r: px[o] / 255, g: px[o + 1] / 255, b: px[o + 2] / 255 }));
  });
}
