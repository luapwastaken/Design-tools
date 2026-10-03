// Small dithers for the inspector: a grey ramp under the algorithm, and the image in each look.
// They run the tool's own engine on a few hundred pixels, so what they show is what the image gets.
import { useEffect, useMemo, useRef, useState } from 'react';
import { linearRgb, rgb255, toOklch, type Oklch } from '../../../shared/color/index.ts';
import { cx } from '../../ui/cx.ts';
import type { DitherDoc } from './doc.ts';
import { linearOf } from './engine.ts';
import { sourceFrame, sourceId } from './source.ts';
import s from './Inspector.module.css';

/** a ramp from black to white, even in sRGB value as the dither mixes it, repeated down `h` rows; linear RGB */
export function ramp(w: number, h: number): Float32Array {
  const col = Array.from({ length: w }, (_, x) => {
    const v = (x + 0.5) / w;
    return linearRgb(toOklch({ mode: 'rgb', r: v, g: v, b: v }))[0];
  });
  const out = new Float32Array(w * h * 3);
  for (let p = 0; p < w * h; p++) out.fill(col[p % w], p * 3, p * 3 + 3);
  return out;
}

/** palette indices drawn one canvas pixel a block, scaled up by CSS with nearest-neighbour */
export function Blocks({ indices, w, h, colours, className }: { indices: Uint8Array | null; w: number; h: number; colours: Oklch[]; className?: string }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const c = ref.current;
    if (!c) return;
    c.width = w;
    c.height = h;
    if (!indices) return;
    const lut = colours.map(rgb255);
    const img = new ImageData(w, h);
    for (let p = 0; p < indices.length; p++) {
      const [r, g, b] = lut[indices[p]] ?? [0, 0, 0];
      img.data.set([r, g, b, 255], p * 4);
    }
    c.getContext('2d')!.putImageData(img, 0, 0);
  }, [indices, w, h, colours]);
  return <canvas ref={ref} className={cx(s.specimen, className)} style={{ aspectRatio: `${w} / ${h}` }} aria-hidden="true" />;
}

/** the image's first frame at `w` × `h`, cropped to fill, linear RGB; null until it's read (or with no image) */
export function useThumbnail(d: DitherDoc, w: number, h: number): Float32Array | null {
  const [img, setImg] = useState<{ key: string; px: Float32Array } | null>(null);
  const src = d.source;
  const key = sourceId(src);
  useEffect(() => {
    if (!src) return;
    let live = true;
    sourceFrame(src, 0).then(
      (b) => {
        if (!live) return;
        const k = Math.max(w / b.width, h / b.height);
        const ctx = new OffscreenCanvas(w, h).getContext('2d', { willReadFrequently: true })!;
        ctx.imageSmoothingQuality = 'high';
        ctx.drawImage(b, (w - b.width * k) / 2, (h - b.height * k) / 2, b.width * k, b.height * k);
        setImg({ key, px: linearOf(ctx.getImageData(0, 0, w, h).data, w * h) });
      },
      () => {},
    );
    return () => void (live = false);
  }, [key, w, h]);
  return useMemo(() => (src && img?.key === key ? img.px : null), [src, img, key]);
}
