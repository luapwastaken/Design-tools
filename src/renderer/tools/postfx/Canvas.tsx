// The work area (spec §2): the frame in the Viewport, the result, or the original while Y or the strip's
// button says so. Only this component redraws while a clip plays.
import { useShell } from '../../shell/core/index.ts';
import { cursorXY, IconButton, Viewport, type ViewTransform } from '../../ui/index.ts';
import type { PostFxDoc, Timeline } from './doc.ts';
import { sourceKey } from './media.ts';
import { shown } from './preview.ts';
import { Transport } from './Transport.tsx';
import { patchView, toggleOriginal, type PostFxView } from './view-state.ts';
import s from './Canvas.module.css';

const token = (name: string) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();

/**
 * Transparency sits on a neutral checker of 8 screen px, in the rule and tick tones. The well tones it
 * had were a hair apart and the same as the pasteboard in the dark theme; these are far from it in both
 * themes, so clear pixels read as a pattern and a near-black or near-white pixel still stands out.
 */
function checker(ctx: CanvasRenderingContext2D, t: ViewTransform): CanvasPattern | null {
  const c = new OffscreenCanvas(16, 16);
  const g = c.getContext('2d')!;
  g.fillStyle = token('--line');
  g.fillRect(0, 0, 16, 16);
  g.fillStyle = token('--tick');
  g.fillRect(8, 0, 8, 8);
  g.fillRect(0, 8, 8, 8);
  const p = ctx.createPattern(c, 'repeat');
  p?.setTransform(new DOMMatrix().scale(1 / t.scale));
  return p;
}

type Props = { d: PostFxDoc; v: PostFxView; busy: boolean; t: Timeline; active: boolean };

export function PostFxCanvas({ d, v, busy, t: timeline, active }: Props) {
  useShell((st) => st.settings?.theme);
  const frame = shown.use();
  const src = d.source!;
  const [W, H] = [src.w, src.h];
  const mine = frame && frame.source === sourceKey(src) ? frame : null;

  const draw = (ctx: CanvasRenderingContext2D, img: ImageBitmap, t: ViewTransform) => {
    if (!img.width) return; // closed: the next frame is on its way
    // magnified past a device pixel, pixels stay square so grain and scanlines read as they export
    ctx.imageSmoothingEnabled = (W / img.width) * t.scale * t.dpr < 1;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(img, 0, 0, W, H);
  };

  const render = (ctx: CanvasRenderingContext2D, t: ViewTransform) => {
    ctx.fillStyle = checker(ctx, t) ?? token('--line');
    ctx.fillRect(0, 0, W, H);
    if (!mine) return;
    const img = v.original ? mine.before : mine.after;
    if (img) draw(ctx, img, t);
  };

  // on the image's own corner, not the viewport's; the result carries no tag
  const overlay = (t: ViewTransform) => (v.original ? <span className={s.tag} style={{ left: Math.max(0, t.x) + 8, top: Math.max(0, t.y) + 8 }}>Original</span> : null);

  return (
    <Viewport
      className={s.vp}
      contentWidth={W}
      contentHeight={H}
      render={render}
      overlay={overlay}
      zoom={v.zoom}
      onZoom={(zoom) => patchView({ zoom })}
      cursor={(p) => (
        <>
          {cursorXY(p)}
          {mine && mine.scale < 1 && (
            <span>
              preview <b>{Math.round(mine.scale * 100)}</b>%
            </span>
          )}
        </>
      )}
      overlays={
        <>
          <IconButton icon="image" label="Show the original" shortcut="Y" size="sm" latched={v.original} onClick={toggleOriginal} />
          {timeline.count > 1 && (
            <>
              <span className={s.sep} />
              <Transport t={timeline} active={active} />
            </>
          )}
          {busy && (
            <span className={s.busy} role="status">
              Rendering
            </span>
          )}
        </>
      }
    />
  );
}
