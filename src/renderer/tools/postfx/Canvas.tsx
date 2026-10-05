// The work area (spec §2): the frame in the Viewport, the original left of the divider and the result
// right of it. The divider is a place in the image (a share of its width), so it stays on the same
// pixel column at any zoom and pan (inventory: v1's lined up only when centred at 0.5). Both sides
// come from the same frame, and only this component redraws while a clip plays.
import { useRef, useState, type KeyboardEvent, type PointerEvent, type ReactNode } from 'react';
import { useShell } from '../../shell/core/index.ts';
import { cursorXY, Icon, NumberField, Viewport, type ViewTransform } from '../../ui/index.ts';
import { cx } from '../../ui/cx.ts';
import type { PostFxDoc, Timeline } from './doc.ts';
import { shown } from './preview.ts';
import { Transport } from './Transport.tsx';
import { patchView, type PostFxView } from './view-state.ts';
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

/** the divider's device column: the clip and the line land on the same whole pixel */
const columnOf = (t: ViewTransform, x: number) => Math.round((t.x + x * t.scale) * t.dpr);

type Props = { d: PostFxDoc; v: PostFxView; busy: boolean; t: Timeline; active: boolean };

export function PostFxCanvas({ d, v, busy, t: timeline, active }: Props) {
  useShell((st) => st.settings?.theme);
  const frame = shown.use();
  const src = d.source!;
  const [W, H] = [src.w, src.h];
  // a drag moves the divider here and saves it on release, so the inspector never redraws with it
  const [dragged, setDragged] = useState<number | null>(null);
  const split = dragged ?? v.split;
  const drag = useRef<{ id: number; t: ViewTransform; at: number } | null>(null);
  const mine = frame && frame.source === src.asset ? frame : null;
  const compare = v.compare;

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
    if (compare !== 'split') {
      const img = compare === 'before' ? mine.before : mine.after;
      if (img) draw(ctx, img, t);
      return;
    }
    const X = columnOf(t, split * W);
    const side = (img: ImageBitmap | null, from: number, to: number) => {
      if (!img || to <= from) return;
      ctx.save();
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.beginPath();
      ctx.rect(from, 0, to - from, ctx.canvas.height);
      ctx.clip();
      const k = t.dpr * t.scale;
      ctx.setTransform(k, 0, 0, k, t.dpr * t.x, t.dpr * t.y);
      draw(ctx, img, t);
      ctx.restore();
    };
    side(mine.before, 0, X);
    side(mine.after, X, ctx.canvas.width);
  };

  const place = (e: PointerEvent<HTMLElement>, t: ViewTransform) => Math.min(1, Math.max(0, t.toContent(e.clientX, e.clientY).x / W));
  const onKey = (e: KeyboardEvent<HTMLElement>) => {
    const by = { ArrowLeft: -0.01, ArrowRight: 0.01, Home: -1, End: 1 }[e.key];
    if (by === undefined) return;
    e.preventDefault();
    patchView({ split: Math.min(1, Math.max(0, Math.round((v.split + by * (e.shiftKey ? 10 : 1)) * 1000) / 1000)) });
  };

  const overlay = (t: ViewTransform): ReactNode => {
    // on the image's own corner, as the split's tags are, not the viewport's
    if (compare !== 'split') return <span className={s.tag} style={{ left: Math.max(0, t.x) + 8, top: Math.max(0, t.y) + 8 }}>{compare === 'before' ? 'Original' : 'Result'}</span>;
    const x = columnOf(t, split * W) / t.dpr;
    const top = Math.max(0, t.y);
    const bottom = Math.min(t.height, t.y + H * t.scale);
    if (x < -8 || x > t.width + 8 || bottom <= top) return null;
    const mid = (top + bottom) / 2;
    return (
      <>
        <div
          className={cx(s.divider, dragged !== null && s.dragging)}
          style={{ left: x, top, height: bottom - top }}
          onPointerDown={(e) => {
            if (e.button !== 0) return;
            e.preventDefault();
            e.currentTarget.setPointerCapture(e.pointerId);
            drag.current = { id: e.pointerId, t, at: place(e, t) };
            setDragged(drag.current.at);
          }}
          onPointerMove={(e) => {
            const g = drag.current;
            if (g?.id !== e.pointerId) return;
            g.at = place(e, g.t);
            setDragged(g.at);
          }}
          onLostPointerCapture={() => {
            const g = drag.current;
            drag.current = null;
            if (g) patchView({ split: Math.round(g.at * 1000) / 1000 });
            setDragged(null);
          }}
        >
          <i className={s.line} />
          <span
            className={s.grip}
            style={{ top: mid - top }}
            role="slider"
            tabIndex={0}
            aria-label="Divider between before and after"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={Math.round(split * 100)}
            aria-valuetext={`${Math.round(split * 100)}% across`}
            onKeyDown={onKey}
          >
            <Icon name="drag_indicator" size={14} />
          </span>
        </div>
        {x > 88 && <span className={cx(s.tag, s.before)} style={{ left: x - 8, top: top + 8 }}>Original</span>}
        {x < t.width - 80 && <span className={s.tag} style={{ left: x + 8, top: top + 8 }}>Result</span>}
      </>
    );
  };

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
      background={compare === 'split' ? <NumberField label="Split" min={0} max={100} step={1} unit="%" width={96} value={Math.round(split * 100)} onChange={(p) => patchView({ split: p / 100 })} className={s.split} /> : undefined}
    />
  );
}
