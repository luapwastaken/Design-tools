// The work area (spec §2): the pattern repeated across the Viewport. One tile is drawn to a bitmap
// at the zoom it is seen at and repeated as a canvas pattern, so a big view stays fast. The content
// is the artboard, as the Artboard export gives it; the repeat carries on over the pasteboard under
// a veil, and one tile is outlined. Seams lines every tile edge, so a broken repeat shows at once.
import { useEffect, useRef, useState, type ReactNode } from 'react';
import type { Tile } from '../../../shared/pattern/types.ts';
import { useShell } from '../../shell/core/index.ts';
import { cursorXY, InfoTip, Toggle, toast, Viewport, type ViewTransform } from '../../ui/index.ts';
import { PX_PER, UNIT_STEP, type PatternDoc } from './doc.ts';
import { drawSvg } from './raster.ts';
import { dropSprites, spriteTile } from './sprites.ts';
import { patchView, type PatternView } from './view-state.ts';
import s from './Canvas.module.css';

type Preview = { svg: string; tileWidth: number; tileHeight: number };
type Bitmap = { img: ImageBitmap; kx: number; ky: number };
/** a tile drawing: w × h px for a tile of tw × th; quick draws it from the shapes' bitmaps */
type Job = { svg: string; d: PatternDoc; tile: Tile; w: number; h: number; tw: number; th: number; quick: boolean };

/** the tile's bitmap stays under this many pixels, however far in the view zooms */
const TILE_PIXELS = 4096 * 4096;
/** a vector tile slower than this can't keep up with a drag: edits draw quick until they stop for SETTLE_MS */
const SLOW_MS = 80;
const SETTLE_MS = 300;
/** below this many screen px a tile, seam lines would only grey the view */
const SEAM_MIN = 6;

/** device px per tile px, in half-octave steps, so a zoom redraws the tile only now and then */
const stepOf = (k: number) => 2 ** (Math.ceil(Math.log2(Math.max(k, 1 / 64)) * 2) / 2);

const token = (name: string) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();

/** a transparent pattern sits on a quiet checker of 8 screen px, so the work stays in front */
function checker(ctx: CanvasRenderingContext2D, t: ViewTransform): CanvasPattern | null {
  const c = new OffscreenCanvas(16, 16);
  const g = c.getContext('2d')!;
  g.fillStyle = token('--well');
  g.fillRect(0, 0, 16, 16);
  g.fillStyle = token('--well-hover');
  g.fillRect(8, 0, 8, 8);
  g.fillRect(0, 8, 8, 8);
  const p = ctx.createPattern(c, 'repeat');
  p?.setTransform(new DOMMatrix().scale(1 / t.scale));
  return p;
}

export function PatternCanvas({ d, tile, preview, v, active }: { d: PatternDoc; tile: Tile; preview: Preview; v: PatternView; active: boolean }) {
  // the canvas reads its colours from the tokens: a theme change redraws it
  useShell((st) => st.settings?.theme);
  const [want, setWant] = useState(1);
  const wanted = useRef(want);
  const [bmp, setBmp] = useState<Bitmap | null>(null);
  const held = useRef<Bitmap | null>(null);
  const hold = (next: Bitmap | null) => {
    if (held.current && held.current.img !== next?.img) held.current.img.close();
    held.current = next;
    setBmp(next);
  };
  const aw = d.artboard.w;
  const ah = d.artboard.h;

  // One tile drawing at a time, then the newest asked for: a slider drag moves faster than an SVG
  // decodes. Each one finished shows at once, so the view keeps up as best it can.
  const q = useRef<{ busy: boolean; next: Job | null; on: boolean; slow: boolean }>({ busy: false, next: null, on: false, slow: false });
  const pump = async () => {
    if (q.current.busy) return;
    q.current.busy = true;
    for (let j = q.current.next; j; j = q.current.next) {
      q.current.next = null;
      try {
        const t0 = performance.now();
        const img = j.quick ? await spriteTile(j.d, j.tile, j.w, j.h) : await createImageBitmap(await drawSvg(j.svg, j.w, j.h));
        if (!j.quick) q.current.slow = performance.now() - t0 > SLOW_MS;
        if (q.current.on) hold({ img, kx: j.w / j.tw, ky: j.h / j.th });
        else img.close();
      } catch (e) {
        // hidden mid-draw, the tool freed the sprites it was drawing with: nothing was lost
        if (!q.current.next && q.current.on) toast.show({ kind: 'error', message: `The pattern couldn't be drawn: ${e instanceof Error ? e.message : String(e)}` });
      }
    }
    q.current.busy = false;
  };
  const queue = (job: Job) => {
    q.current.next = job;
    void pump();
  };

  // the tile at the resolution it is shown at; a hidden tool frees its pixels (spec §4)
  useEffect(() => {
    q.current.on = active;
    if (!active) {
      q.current.next = null;
      dropSprites();
      return void hold(null);
    }
    const { svg, tileWidth: tw, tileHeight: th } = preview;
    const k = Math.min(want, Math.sqrt(TILE_PIXELS / Math.max(1, tw * th)));
    const job: Job = { svg, d, tile, tw, th, w: Math.max(1, Math.round(tw * k)), h: Math.max(1, Math.round(th * k)), quick: false };
    if (!q.current.slow) return queue(job);
    queue({ ...job, quick: true });
    const settle = setTimeout(() => queue(job), SETTLE_MS);
    return () => clearTimeout(settle);
  }, [preview, want, active]);
  useEffect(
    () => () => {
      q.current.on = false;
      q.current.next = null;
      dropSprites();
      hold(null);
    },
    [],
  );

  const render = (ctx: CanvasRenderingContext2D, t: ViewTransform) => {
    const k = stepOf(t.scale * t.dpr);
    if (k !== wanted.current) {
      wanted.current = k;
      queueMicrotask(() => setWant(k));
    }
    const { x, y, w, h } = t.visible;
    if (!d.background) {
      ctx.fillStyle = checker(ctx, t) ?? token('--well');
      ctx.fillRect(x, y, w, h);
    }
    if (bmp) {
      const p = ctx.createPattern(bmp.img, 'repeat');
      if (p) {
        p.setTransform(new DOMMatrix().scale(1 / bmp.kx, 1 / bmp.ky));
        ctx.fillStyle = p;
        ctx.fillRect(x, y, w, h);
      }
    }
    // the repeat goes on past the artboard, veiled, so the page reads as the page
    ctx.fillStyle = token('--pasteboard');
    ctx.globalAlpha = 0.72;
    ctx.beginPath();
    ctx.rect(x, y, w, h);
    ctx.rect(0, 0, aw, ah);
    ctx.fill('evenodd');
    ctx.globalAlpha = 1;
    lines(ctx, t, tile.width, tile.height, aw, ah, v.seams);
  };

  const perTile = tile.items.length;
  const onBoard = tile.width > 0 && tile.height > 0 ? Math.round((perTile * aw * ah) / (tile.width * tile.height)) : 0;
  const unit = { name: d.exportUnit, per: PX_PER[d.exportUnit], digits: Math.max(0, -Math.log10(UNIT_STEP[d.exportUnit])) };
  const readout = (p: Parameters<typeof cursorXY>[0]): ReactNode => (
    <>
      {cursorXY(p, unit)}
      <span>
        ≈ <b>{onBoard.toLocaleString('en')}</b> on the artboard
      </span>
    </>
  );

  return (
    <Viewport
      className={s.vp}
      contentWidth={aw}
      contentHeight={ah}
      render={render}
      zoom={v.zoom}
      onZoom={(zoom) => patchView({ zoom })}
      cursor={readout}
      overlays={
        <>
          <span className={s.sep} />
          <Toggle label="Tile seams" checked={v.seams} onChange={(seams) => patchView({ seams })} className={s.seams} />
          <InfoTip text="Lines every tile edge in view, so a broken repeat shows at once." />
        </>
      }
    />
  );
}

/**
 * One tile near the artboard's middle outlined, or with Seams every tile edge in view: 1 device px
 * sharp, with a halo that reads on any colour, and the colours between them left as they are.
 */
function lines(ctx: CanvasRenderingContext2D, t: ViewTransform, tw: number, th: number, aw: number, ah: number, seams: boolean): void {
  if (!(tw > 0 && th > 0)) return;
  const at = (content: number, origin: number) => Math.round((origin + content * t.scale) * t.dpr) + 0.5;
  const [W, H] = [t.width * t.dpr, t.height * t.dpr];
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.beginPath();
  if (seams && tw * t.scale >= SEAM_MIN && th * t.scale >= SEAM_MIN) {
    const { x, y, w, h } = t.visible;
    for (let i = Math.ceil(x / tw); i * tw <= x + w; i++) {
      const X = at(i * tw, t.x);
      ctx.moveTo(X, 0);
      ctx.lineTo(X, H);
    }
    for (let j = Math.ceil(y / th); j * th <= y + h; j++) {
      const Y = at(j * th, t.y);
      ctx.moveTo(0, Y);
      ctx.lineTo(W, Y);
    }
  } else {
    const i = Math.max(0, Math.round(aw / tw / 2 - 0.5));
    const j = Math.max(0, Math.round(ah / th / 2 - 0.5));
    const [x0, y0] = [at(i * tw, t.x), at(j * th, t.y)];
    ctx.rect(x0, y0, at((i + 1) * tw, t.x) - x0, at((j + 1) * th, t.y) - y0);
  }
  ctx.strokeStyle = token('--cross-halo');
  ctx.lineWidth = 3 * t.dpr;
  ctx.stroke();
  ctx.strokeStyle = token('--cross');
  ctx.lineWidth = Math.max(1, Math.round(t.dpr));
  ctx.stroke();
}
