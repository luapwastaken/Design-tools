// The work area (spec §2): the result in the Viewport at its exported size, each block drawn with
// nearest-neighbour so pixels stay crisp, the zoom landing where a block is a whole number of screen
// pixels (smoothed only below one, where nearest sampling would alias the pattern into a false
// tone), or the original frame. The readout names the palette index and colour under the pointer.
import { useEffect, useLayoutEffect, useMemo, useState, type ReactNode } from 'react';
import { cssColor, toHex } from '../../../shared/color/index.ts';
import { cursorXY, Icon, Viewport, type ViewTransform } from '../../ui/index.ts';
import { cx } from '../../ui/cx.ts';
import { workSize, type DitherDoc } from './doc.ts';
import { imageOf } from './exports.ts';
import type { Result } from './pipeline.ts';
import { sourceFrame, sourceId } from './source.ts';
import { patchView, under, type DitherView } from './view-state.ts';
import s from './Canvas.module.css';

/**
 * The frame at full resolution for Original; a copy, since the reader may close its own. A copy is
 * closed only once the next one has replaced it (or the view is done), never while it is still
 * the one being drawn.
 */
function useOriginal(d: DitherDoc, frame: number, on: boolean): ImageBitmap | null {
  const [img, setImg] = useState<ImageBitmap | null>(null);
  const src = d.source;
  useEffect(() => {
    if (!on || !src) return setImg(null);
    let live = true;
    sourceFrame(src, frame)
      .then((b) => createImageBitmap(b))
      .then(
        (b) => (live ? setImg(b) : b.close()),
        () => {},
      );
    return () => {
      live = false;
    };
  }, [src?.assets, frame, on]);
  useEffect(() => () => img?.close(), [img]);
  return img;
}

/** lights the palette chip under the pointer; a component, so the readout never sets state while it draws */
function Under({ index }: { index: number | null }) {
  useLayoutEffect(() => under.set(index), [index]);
  useEffect(() => () => under.set(null), []);
  return null;
}

type Props = { d: DitherDoc; v: DitherView; frame: number; result: Result | null; busy: boolean };

export function DitherCanvas({ d, v, frame, result, busy }: Props) {
  const original = v.show === 'original';
  const img = useOriginal(d, frame, original);
  const { w, h } = workSize(d);
  const [W, H] = [w * d.pixel, h * d.pixel];
  // the result of this image: the last one stays up, scaled to the page, while the next is made
  const shown = result?.src === sourceId(d.source) ? result : null;
  const pixels = useMemo(() => {
    if (!shown) return null;
    const c = new OffscreenCanvas(shown.w, shown.h);
    c.getContext('2d')!.putImageData(imageOf(shown), 0, 0);
    return c;
  }, [shown]);

  const render = (ctx: CanvasRenderingContext2D, t: ViewTransform) => {
    if (original) {
      if (!img || !img.width) return; // a closed bitmap reads as 0 wide and throws when drawn
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = 'high';
      return ctx.drawImage(img, 0, 0, W, H);
    }
    if (!pixels) return;
    // device pixels a block covers: under one, nearest sampling would alias the pattern
    ctx.imageSmoothingEnabled = t.scale * t.dpr * (W / pixels.width) < 1;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(pixels, 0, 0, W, H);
  };

  const cursor = (p: { x: number; y: number } | null): ReactNode => {
    const r = shown && !original && p && p.x >= 0 && p.y >= 0 && p.x < W && p.y < H ? shown : null;
    const at = r && p ? Math.floor((p.y / H) * r.h) * r.w + Math.floor((p.x / W) * r.w) : -1;
    const index = r ? r.indices[at] : null;
    const colour = r && index !== null ? r.colours[index] : null;
    return (
      <>
        {cursorXY(p)}
        <span className={cx(s.index, colour && s.live)}>
          <Under index={index ?? null} />
          Index <b>{index === null ? '–' : index + 1}</b>
          <i className={s.chip} style={colour ? { background: cssColor(colour) } : undefined} />
          <b className={s.hex}>{colour ? toHex(colour).toUpperCase() : '–'}</b>
        </span>
      </>
    );
  };

  return (
    <Viewport
      className={s.vp}
      contentWidth={W}
      contentHeight={H}
      cell={d.pixel}
      render={render}
      zoom={v.zoom}
      onZoom={(zoom) => patchView({ zoom })}
      cursor={cursor}
      bar={
        busy && (
          <span className={s.busy} role="status">
            <Icon name="progress_activity" size={16} className={s.spin} />
            Dithering
          </span>
        )
      }
    />
  );
}
