// Logo SVG to pixels, and to a URL an <img> can show. Always through an <img> from a Blob URL, a
// document of its own (spec §10.3), at the exact pixel size asked, so the vectors land sharp on it.
import { useEffect, useState } from 'react';
import { contrast } from '../../../shared/color/index.ts';
import { VANISH, type Ground } from '../../../shared/logo/svg.ts';
import { framed, parseSize } from '../../../shared/svg/index.ts';
import { withDpi } from '../../lib/png.ts';

/** what one canvas can hold here */
const MAX_SIDE = 16384;
/** the long side a drawing is weighed at: every colour big enough to matter shows */
const WEIGH = 256;
/** how long an <img> may still be reading a Blob URL after its successor is made */
const LINGER = 2000;

/** the SVG drawn at w × h px */
export async function drawSvg(svg: string, w: number, h: number): Promise<OffscreenCanvas> {
  const url = URL.createObjectURL(new Blob([framed(svg, w, h)], { type: 'image/svg+xml' }));
  try {
    const img = new Image();
    img.src = url;
    await img.decode();
    const c = new OffscreenCanvas(w, h);
    c.getContext('2d')!.drawImage(img, 0, 0, w, h);
    return c;
  } finally {
    URL.revokeObjectURL(url);
  }
}

/** why a PNG this size can't be made, or null */
export const tooBig = (w: number, h: number): string | null =>
  w <= MAX_SIDE && h <= MAX_SIDE ? null : `That PNG would be ${w} × ${h} px. PNGs stop at ${MAX_SIDE} px a side: lower the height.`;

/** a PNG of the SVG at w × h px, its resolution set to `dpi` */
export async function pngOf(svg: string, w: number, h: number, dpi: number): Promise<Blob> {
  const why = tooBig(w, h);
  if (why) throw new Error(why);
  return withDpi(await (await drawSvg(svg, w, h)).convertToBlob({ type: 'image/png' }), dpi);
}

export const bytes = async (b: Blob): Promise<Uint8Array> => new Uint8Array(await b.arrayBuffer());

/**
 * Whether a drawing shows better on `light` or `dark`, judged where it meets the ground: its edge.
 * A colour inside the mark (a white smile on a blue disc) never touches the ground, so it counts for
 * nothing; a white name beside a blue mark (a logo made for dark grounds) is mostly edge. Dark only
 * when clearly less of the edge would all but vanish there.
 */
export async function groundOf(svg: string, light: string, dark: string): Promise<Ground> {
  const { width, height } = parseSize(svg);
  const k = WEIGH / Math.max(width, height);
  const [w, h] = [Math.max(1, Math.round(width * k)), Math.max(1, Math.round(height * k))];
  const px = (await drawSvg(svg, w, h)).getContext('2d')!.getImageData(0, 0, w, h).data;
  const solid = (x: number, y: number) => x >= 0 && y >= 0 && x < w && y < h && px[(y * w + x) * 4 + 3] >= 128;
  const seen = new Map<number, [boolean, boolean]>();
  let [edge, gone, goneDark] = [0, 0, 0];
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      if (!solid(x, y) || (solid(x - 1, y) && solid(x + 1, y) && solid(x, y - 1) && solid(x, y + 1))) continue;
      const i = (y * w + x) * 4;
      const rgb = (px[i] << 16) | (px[i + 1] << 8) | px[i + 2];
      let v = seen.get(rgb);
      if (!v) {
        const hex = `#${rgb.toString(16).padStart(6, '0')}`;
        seen.set(rgb, (v = [contrast(hex, light) < VANISH, contrast(hex, dark) < VANISH]));
      }
      edge++;
      if (v[0]) gone++;
      if (v[1]) goneDark++;
    }
  return gone - goneDark > 0.05 * edge ? 'dark' : 'light';
}

/** a Blob URL for SVG markup while it's shown, let go when it changes; cheaper than a data URL for a heavy part */
export function useSvgUrl(svg: string | null): string | null {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    if (!svg) return void setUrl(null);
    const u = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml' }));
    setUrl(u);
    // the <img> keeps this one until the next URL reaches it, and may be loading it meanwhile
    return () => void setTimeout(() => URL.revokeObjectURL(u), LINGER);
  }, [svg]);
  return url;
}
