// The work area (spec §2): the page in the Viewport with rulers in the document's unit. Result
// draws the screen on the GPU for exactly the part in view at the screen's own pixels; Separations
// lays every plate out as film; Original shows the image placed on the page. The probe reads the
// plates under the pointer. Result only ever shows a screen: the last one, fitted to the page,
// while the next is made, and bare paper when there is none.
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { cssColor } from '../../../shared/color/index.ts';
import { pagePx } from '../../../shared/halftone/screen.ts';
import { cursorXY, Icon, Viewport, type ViewTransform } from '../../ui/index.ts';
import { InkProbe } from './Meters.tsx';
import { filmOf, lookOf, Painter, type Look } from './draw.ts';
import { MM_PER, type HalftoneDoc } from './doc.ts';
import { placement, sourceBitmap, type Screened } from './screening.ts';
import { patchView, type HalftoneView } from './view-state.ts';
import s from './Canvas.module.css';

type Box = { x: number; y: number; w: number; h: number };

/** clear film, the plates' ground */
const FILM = cssColor([1, 0, 0]);

/** the plates laid out as a grid of pages, with room between for their labels */
function grid(n: number, page: { w: number; h: number }) {
  const cols = n <= 1 ? 1 : n <= 4 ? 2 : 3;
  const rows = Math.ceil(n / cols);
  const gap = Math.round(Math.min(page.w, page.h) * 0.06);
  const at = (i: number): Box => ({ x: (i % cols) * (page.w + gap), y: Math.floor(i / cols) * (page.h + gap), w: page.w, h: page.h });
  return { w: cols * page.w + (cols - 1) * gap, h: rows * page.h + (rows - 1) * gap, at, n };
}

/** the part of `box` (content px) on screen, snapped out to device pixels, and the page region under it */
function onScreen(t: ViewTransform, box: Box) {
  const dev = (v: number, o: number) => (o + v * t.scale) * t.dpr;
  const X0 = Math.max(0, Math.floor(dev(box.x, t.x)));
  const Y0 = Math.max(0, Math.floor(dev(box.y, t.y)));
  const X1 = Math.min(Math.round(t.width * t.dpr), Math.ceil(dev(box.x + box.w, t.x)));
  const Y1 = Math.min(Math.round(t.height * t.dpr), Math.ceil(dev(box.y + box.h, t.y)));
  if (X1 <= X0 || Y1 <= Y0) return null;
  const k = t.scale * t.dpr;
  return { X0, Y0, w: X1 - X0, h: Y1 - Y0, k, r: { x: (X0 / t.dpr - t.x) / t.scale - box.x, y: (Y0 / t.dpr - t.y) / t.scale - box.y } };
}

/** the look for a screen that may be a step behind the document: inks matched by id, new ones left out */
function lookFor(d: HalftoneDoc, sc: Screened, look: Look): Look {
  return {
    ...look,
    inks: look.inks.flatMap((x) => {
      const at = sc.inks.findIndex((k) => k.id === d.inks[x.index].id);
      return at < 0 ? [] : [{ ...x, index: at }];
    }),
  };
}

/** the plate box a content point is in, and the point inside it */
function plateAt(layout: ReturnType<typeof grid>, x: number, y: number): { i: number; x: number; y: number } | null {
  for (let i = 0; i < layout.n; i++) {
    const b = layout.at(i);
    if (x >= b.x && x < b.x + b.w && y >= b.y && y < b.y + b.h) return { i, x: x - b.x, y: y - b.y };
  }
  return null;
}

type Props = {
  d: HalftoneDoc;
  v: HalftoneView;
  /** the latest screen of this image, possibly a step behind the document; null when there is none */
  screened: Screened | null;
  dots: number;
  /** each ink's coverage as it prints, in the screen's order (the meters') */
  stats: { mean: number; peak: number }[] | null;
  busy: boolean;
  active: boolean;
  /** a drawing failure (the graphics card), shown where screening errors are; null once it draws */
  onDrawError(message: string | null): void;
};

export function HalftoneCanvas({ d, v, screened, dots, stats, busy, active, onDrawError }: Props) {
  const painter = useRef<Painter | null>(null);
  const [, redraw] = useState(0);
  const [img, setImg] = useState<ImageBitmap | null>(null);

  // the GPU while the tool shows; a hidden tool frees it (foundation spec §4), a lost context rebuilds
  useEffect(() => {
    if (!active) return;
    const p = new Painter('halftone preview');
    painter.current = p;
    const off = p.g.onRestore(() => {
      p.reset();
      redraw((n) => n + 1);
    });
    redraw((n) => n + 1);
    return () => {
      off();
      p.release();
      painter.current = null;
    };
  }, [active]);

  useEffect(() => {
    setImg(null);
    if (!active) return;
    let live = true;
    sourceBitmap(d)?.then((b) => live && setImg(b), () => {});
    return () => void (live = false);
  }, [d.source?.asset, active]);

  const page = pagePx(d.size);
  const sep = v.show === 'separations';
  const layout = grid(d.inks.length, page);
  const content = sep ? layout : page;
  // a screen of another image says nothing about this one
  const sc = screened && screened.doc.source?.asset === d.source?.asset ? screened : null;

  const paper = (ctx: CanvasRenderingContext2D, box: Box, colour: string) => {
    ctx.fillStyle = colour;
    ctx.fillRect(box.x, box.y, box.w, box.h);
  };

  const original = (ctx: CanvasRenderingContext2D) => {
    paper(ctx, { x: 0, y: 0, ...page }, cssColor(d.paper.colour));
    const at = placement(d);
    if (!img || !at) return;
    ctx.save();
    ctx.beginPath();
    ctx.rect(0, 0, page.w, page.h);
    ctx.clip();
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(img, at.x, at.y, at.w, at.h);
    ctx.restore();
  };

  /** the screen in `box`; one made for another page size is fitted to this one by its width */
  const paint = (ctx: CanvasRenderingContext2D, t: ViewTransform, sc: Screened, look: Look, box: Box) => {
    const p = painter.current;
    const on = onScreen(t, box);
    if (!p || !on) return;
    const f = sc.page.w / page.w;
    let bmp: ImageBitmap | null;
    try {
      bmp = p.bitmap(sc, look, [on.r.x * on.k, on.r.y * on.k], on.k / f, on.w, on.h);
      onDrawError(null);
    } catch (e) {
      onDrawError(`The graphics card couldn't draw the screen: ${e instanceof Error ? e.message : String(e)}`);
      return;
    }
    if (!bmp) return;
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.drawImage(bmp, on.X0, on.Y0);
    ctx.restore();
    bmp.close();
  };

  const render = (ctx: CanvasRenderingContext2D, t: ViewTransform) => {
    if (!d.source) return;
    if (v.show === 'original') return original(ctx);
    if (!sep) {
      paper(ctx, { x: 0, y: 0, ...page }, cssColor(d.paper.colour));
      return sc && paint(ctx, t, sc, lookFor(d, sc, lookOf(d, true)), { x: 0, y: 0, ...page });
    }
    d.inks.forEach((_, i) => {
      paper(ctx, layout.at(i), FILM);
      if (sc) paint(ctx, t, sc, lookFor(d, sc, filmOf(d, i)), layout.at(i));
    });
  };

  // the separations' labels, over each plate's top left
  const overlay = sep
    ? (t: ViewTransform) =>
        d.inks.map((ink, i) => {
          const b = layout.at(i);
          const st = sc && stats?.[sc.inks.findIndex((k) => k.id === ink.id)];
          return (
            <div key={ink.id} className={s.plateLabel} style={{ left: t.x + b.x * t.scale, top: t.y + b.y * t.scale }}>
              <i style={{ background: cssColor(ink.colour) }} />
              <b>{ink.process ? ink.process.toUpperCase() : i + 1}</b>
              <span>{ink.name}</span>
              <span className={s.dim}>{d.screen.shape === 'stochastic' ? 'FM' : `${ink.angle}°`}</span>
              {st && <span className={s.dim}>{Math.round(st.mean * 100)}%</span>}
              {!ink.visible && <span className={s.dim}>Hidden</span>}
            </div>
          );
        })
    : undefined;

  // the inks under the pointer, from the plates (what the screen was made from)
  const probe = (at: { screen: { x: number; y: number }; content: { x: number; y: number } } | null, t: ViewTransform): ReactNode => {
    if (!at || !sc || v.show === 'original') return null;
    let { x, y } = at.content;
    let only: number | null = null;
    if (sep) {
      const hit = plateAt(layout, x, y);
      if (!hit) return null;
      ({ x, y } = hit);
      only = hit.i;
    }
    if (x < 0 || y < 0 || x >= page.w || y >= page.h) return null;
    const px = Math.floor((x / page.w) * sc.plate.w) + Math.floor((y / page.h) * sc.plate.h) * sc.plate.w;
    const inks = d.inks
      .map((ink, n) => ({ ink, n, plate: sc.inks.find((k) => k.id === ink.id)?.plate }))
      .filter(({ ink, n, plate }) => plate && (only === null ? ink.visible : n === only))
      .map(({ ink, plate }) => ({ label: ink.process ? ink.process.toUpperCase() : ink.name, colour: ink.process ? undefined : ink.colour, value: plate![px] ?? 0 }));
    return inks.length ? <InkProbe at={at.screen} inks={inks} view={{ width: t.width, height: t.height }} /> : null;
  };

  const unit = d.size.unit;
  // content px (print px) in one mm or inch
  const per = (d.size.dpi * MM_PER[unit]) / 25.4;
  const cursor = (p: Parameters<typeof cursorXY>[0]): ReactNode => (
    <>
      {cursorXY(p && sep ? plateAt(layout, p.x, p.y) : p, { name: unit, per, digits: unit === 'mm' ? 1 : 2 })}
      {sc && d.screen.shape !== 'stochastic' && (
        <span>
          <b>{dots.toLocaleString('en')}</b> dots
        </span>
      )}
    </>
  );

  return (
    <Viewport
      className={s.vp}
      contentWidth={content.w}
      contentHeight={content.h}
      render={render}
      overlay={overlay}
      probe={d.source ? probe : undefined}
      rulers={sep ? undefined : { unit, per }}
      zoom={sep ? v.sepZoom : v.zoom}
      onZoom={(zoom) => patchView(sep ? { sepZoom: zoom } : { zoom })}
      cursor={cursor}
      bar={
        busy && (
          <span className={s.busy} role="status">
            <Icon name="progress_activity" size={16} className={s.spin} />
            Screening
          </span>
        )
      }
    />
  );
}
