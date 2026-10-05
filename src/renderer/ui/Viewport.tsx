import { useEffect, useLayoutEffect, useRef, useState, type PointerEvent, type ReactNode, type RefObject } from 'react';
import { comboOf, isTextField, toolMayTake } from '../shell/core/keys.ts';
import { cx } from './cx.ts';
import { Icon } from './Icon.tsx';
import { Rulers, useHover, type Hover } from './Rulers.tsx';
import type { RulerUnit } from './rulers.ts';
import { clampScale, clampView, fitView, MAX_SCALE, MIN_SCALE, originOf, panBy, sameZoom, snapScale, stepScale, wheelFactor, zoomAt, zoomKey, type Point, type Size, type View, type Zoom, type ZoomKey } from './viewport.ts';
import { ViewStrip } from './ViewStrip.tsx';
import s from './Viewport.module.css';

/** Where the content is on screen, handed to `render` and `overlay`. */
export type ViewTransform = {
  /** screen px per content px */
  scale: number;
  /** content (0, 0) in CSS px from the view's top left, snapped to device pixels */
  x: number;
  y: number;
  /** the view, CSS px */
  width: number;
  height: number;
  dpr: number;
  /** the part of the content plane on screen, in content px (draw only this) */
  visible: { x: number; y: number; w: number; h: number };
  /** a pointer's clientX/clientY in content px */
  toContent(clientX: number, clientY: number): Point;
};

export type { RulerUnit };

export type ViewportProps = {
  contentWidth: number;
  contentHeight: number;
  /** drawn at content size and scaled with the view: an <img>, a <canvas>, an <svg> */
  children?: ReactNode;
  /** or draw it yourself on a view-sized canvas, already transformed to content px (a repeat that fills the view);
   *  called on every view change, and again whenever you pass a new function (so make a new one when the content changes) */
  render?(ctx: CanvasRenderingContext2D, t: ViewTransform): void;
  /** a screen-space layer over the content, for lines and handles that stay 1px at any zoom; pointer events off unless a child turns them on */
  overlay?(t: ViewTransform): ReactNode;
  /** view state: Fit, or a zoom and centre. Reported through onZoom when a gesture settles, not on every frame */
  zoom?: Zoom;
  onZoom?(z: Zoom): void;
  /** the readout at the bottom right, given the pointer in content px (null off the view); values in <b> read as values; false for none */
  cursor?: false | ((p: Point | null) => ReactNode);
  /** the strip's overlay toggles, after the zoom (Seams, Guides, Clearspace) */
  overlays?: ReactNode;
  /** the strip's canvas-background control, right-aligned before the readout */
  background?: ReactNode;
  /** content px in a cell of a pixel grid (Dither's block): Fit, the wheel and the zoom steps land
   *  where a cell is a whole number of device pixels; a typed zoom and 100% stay as asked */
  cell?: number;
  /** rulers along the top and left in this unit, 0 at the content's top left, marking the pointer */
  rulers?: RulerUnit;
  /** a screen-space layer that follows the pointer (an ink readout beside it), with the crosshair
   *  cursor; only it re-renders as the pointer moves. `at` is null off the view */
  probe?(at: { screen: Point; content: Point } | null, t: ViewTransform): ReactNode;
  className?: string;
};

type Box = Size & { pw: number; ph: number };
type Preset = 'fit' | 'actual' | 'none';
const SETTLE_MS = 250;

/**
 * The shared canvas viewer (foundation spec §9, brief §5): content on the pasteboard, wheel zoom
 * around the pointer, Space-drag and middle-drag pan, Fit, 100% and a typed zoom in the bar.
 * It takes its keys only while it is on screen, so a hidden tool's viewport never moves.
 */
export function Viewport(p: ViewportProps) {
  const { contentWidth, contentHeight, children, render, overlay, cursor = cursorXY, overlays, background, rulers, probe, className, cell } = p;
  const content: Size = { w: contentWidth, h: contentHeight };
  const viewEl = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const [box, setBox] = useState<Box | null>(null);
  const [shown, setShown] = useState(true);
  const [own, setOwn] = useState<Zoom>(p.zoom ?? 'fit');
  // the last zoom told to or heard from the tool: a different prop is the tool moving the view
  const [told, setTold] = useState<Zoom | undefined>(p.zoom);
  if (p.zoom !== undefined && !sameZoom(p.zoom, told)) {
    setTold(p.zoom);
    setOwn(p.zoom);
  }
  const [zoomBad, setZoomBad] = useState(false);
  const readout = useRef<(at: Point | null) => void>(() => {});
  const [hover] = useState<Hover>(() => new Set());
  const over = useRef(false);
  const space = useRef(false);
  const pan = useRef<{ id: number; x: number; y: number; from: View } | null>(null);
  const settle = useRef<ReturnType<typeof setTimeout>>(undefined);
  /** where the wheel is heading before snapping, so a pinch's small steps add up */
  const wheelWant = useRef<number | null>(null);

  const snap = (scale: number, b: Box, dir: -1 | 0 | 1) => (cell ? snapScale(scale, cell, b.pw / b.w, dir) : scale);
  const fit = (b: Box): View => {
    const f = fitView(content, b);
    return { ...f, scale: snap(f.scale, b, -1) };
  };
  const view = box && (own === 'fit' ? fit(box) : own);
  const t = view && box && transformOf(view, box, viewEl);

  // what the window listeners and the settle timer read: this render's state, plus changes made since
  const live = useRef({ view, box, content, own, told, onZoom: p.onZoom, change, act, snap });
  Object.assign(live.current, { view, box, content, own, told, onZoom: p.onZoom, change, act, snap });

  function report(z: Zoom) {
    clearTimeout(settle.current);
    const l = live.current;
    if (sameZoom(z, l.told)) return;
    l.told = z;
    setTold(z);
    l.onZoom?.(z);
  }
  /** report now, once the wheel stops, or at the end of a pan; whatever you do, some of the work stays in view */
  function change(to: Zoom, when: 'now' | 'later' | 'end') {
    const l = live.current;
    const z = to === 'fit' || !l.box ? to : clampView(to, l.content, l.box);
    l.own = z;
    if (z !== 'fit') l.view = z;
    setOwn(z);
    clearTimeout(settle.current);
    if (when === 'now') report(z);
    else if (when === 'later') settle.current = setTimeout(() => report(live.current.own), SETTLE_MS);
  }
  function zoomTo(scale: number) {
    const { view: v, box: b } = live.current;
    if (v && b) change(zoomAt(v, scale, { x: b.w / 2, y: b.h / 2 }, b), 'now');
  }
  function act(k: ZoomKey) {
    const { view: v, box: b } = live.current;
    const dir = k === 'in' ? 1 : -1;
    if (k === 'fit') change('fit', 'now');
    else if (v && b) zoomTo(k === 'actual' ? 1 : live.current.snap(stepScale(v.scale, dir), b, dir));
  }

  // size: a hidden tool reports 0×0, which is ignored (the view keeps its place) and frees the canvas
  useLayoutEffect(() => {
    const el = viewEl.current!;
    const ro = new ResizeObserver(([e]) => {
      const { width: w, height: h } = e.contentRect;
      if (!w || !h) return setShown(false);
      const dev = e.devicePixelContentBoxSize?.[0];
      const next = { w, h, pw: dev?.inlineSize ?? Math.round(w * devicePixelRatio), ph: dev?.blockSize ?? Math.round(h * devicePixelRatio) };
      setShown(true);
      setBox((b) => (b && b.w === next.w && b.h === next.h && b.pw === next.pw && b.ph === next.ph ? b : next));
    });
    // device pixels also change when the window moves to a screen with another scale
    try {
      ro.observe(el, { box: 'device-pixel-content-box' });
    } catch {
      ro.observe(el);
    }
    return () => ro.disconnect();
  }, []);

  // the drawn layer, every render (a pan, a zoom, a new render function from the tool)
  useLayoutEffect(() => {
    const c = canvas.current;
    if (!c) return;
    if (!shown || !t || !box) {
      c.width = c.height = 0;
      return;
    }
    if (c.width !== box.pw) c.width = box.pw;
    if (c.height !== box.ph) c.height = box.ph;
    const ctx = c.getContext('2d');
    if (!ctx || !render) return;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, c.width, c.height);
    const k = t.dpr * t.scale;
    ctx.setTransform(k, 0, 0, k, t.dpr * t.x, t.dpr * t.y);
    ctx.save();
    render(ctx, t);
    ctx.restore();
  });

  // Space pan and the zoom keys (spec §9), in the bubble phase after the shell's keymap: a key a
  // field, a menu or a tool shortcut took is already handled
  useEffect(() => {
    const el = viewEl.current!;
    const onScreen = () => el.getClientRects().length > 0 && !el.closest('[inert]');
    const release = () => {
      space.current = false;
      delete el.dataset.space;
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.defaultPrevented || e.isComposing || !onScreen()) return;
      const combo = comboOf(e);
      if (!toolMayTake(combo, isTextField(document.activeElement as HTMLElement | null))) return;
      if (combo.key === 'SPACE' && !combo.ctrl && !combo.alt) {
        if (!space.current && !over.current) return;
        e.preventDefault(); // no page scroll, and the focused button isn't pressed
        space.current = true;
        el.dataset.space = '';
        return;
      }
      const k = zoomKey(e, e.getModifierState('AltGraph'));
      if (!k) return;
      e.preventDefault();
      live.current.act(k);
    };
    const onKeyUp = (e: KeyboardEvent) => {
      if (e.key !== ' ' || !space.current) return;
      e.preventDefault();
      release();
    };
    // the wheel zooms here and never scrolls a panel behind (spec §9)
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const { view: v, box: b, snap: to } = live.current;
      if (!v || !b || !e.deltaY) return;
      // carry on from the wheel's own heading while the view is still where it led
      const from = wheelWant.current !== null && to(wheelWant.current, b, 0) === v.scale ? wheelWant.current : v.scale;
      const want = clampScale(from * wheelFactor(e));
      wheelWant.current = want;
      const r = el.getBoundingClientRect();
      const next = zoomAt(v, to(want, b, 0), { x: e.clientX - r.left, y: e.clientY - r.top }, b);
      if (next.scale !== v.scale) live.current.change(next, 'later');
    };
    addEventListener('keydown', onKeyDown);
    addEventListener('keyup', onKeyUp);
    addEventListener('blur', release);
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => {
      removeEventListener('keydown', onKeyDown);
      removeEventListener('keyup', onKeyUp);
      removeEventListener('blur', release);
      el.removeEventListener('wheel', onWheel);
      clearTimeout(settle.current);
      if (pan.current) delete document.documentElement.dataset.pan;
    };
  }, []);

  const endPan = () => {
    const d = pan.current;
    if (!d) return;
    pan.current = null;
    delete document.documentElement.dataset.pan;
    const el = viewEl.current;
    if (el?.hasPointerCapture(d.id)) el.releasePointerCapture(d.id);
    report(live.current.own);
  };

  const onPointerDownCapture = (e: PointerEvent<HTMLDivElement>) => {
    if (!view || pan.current || !(e.button === 1 || (e.button === 0 && space.current))) return;
    // the content under the pointer never sees a pan's press
    e.preventDefault();
    e.stopPropagation();
    e.currentTarget.setPointerCapture(e.pointerId);
    pan.current = { id: e.pointerId, x: e.clientX, y: e.clientY, from: view };
    document.documentElement.dataset.pan = '';
  };
  const onPointerMoveCapture = (e: PointerEvent<HTMLDivElement>) => {
    readout.current(t && t.toContent(e.clientX, e.clientY));
    if (hover.size) {
      const r = e.currentTarget.getBoundingClientRect();
      for (const f of hover) f({ x: e.clientX - r.left, y: e.clientY - r.top });
    }
    const d = pan.current;
    if (d?.id === e.pointerId) change(panBy(d.from, e.clientX - d.x, e.clientY - d.y), 'end');
  };

  const pct = (view?.scale ?? 1) * 100;
  const preset: Preset = own === 'fit' ? 'fit' : view?.scale === 1 ? 'actual' : 'none';

  const viewer = (
    <div
      ref={viewEl}
      className={s.view}
      data-probe={probe ? '' : undefined}
      onPointerEnter={() => (over.current = true)}
      onPointerLeave={() => {
        over.current = false;
        readout.current(null);
        for (const f of hover) f(null);
      }}
      onPointerDownCapture={onPointerDownCapture}
      onPointerMoveCapture={onPointerMoveCapture}
      onPointerUp={endPan}
      onLostPointerCapture={endPan}
    >
      {render && <canvas ref={canvas} className={s.canvas} />}
      {t && (
        <>
          {children !== undefined && (
            <div className={s.content} style={{ width: contentWidth, height: contentHeight, transform: `translate(${t.x}px, ${t.y}px) scale(${t.scale})` }}>
              {children}
            </div>
          )}
          <div className={s.frame} style={{ left: t.x, top: t.y, width: contentWidth * t.scale, height: contentHeight * t.scale }} />
          {overlay && <div className={s.overlay}>{overlay(t)}</div>}
          {probe && <Probe hover={hover} t={t} probe={probe} />}
        </>
      )}
    </div>
  );

  return (
    <div className={cx(s.vp, className)} data-viewport="">
      {/* the same tree with or without rulers, so turning them on never remounts the view */}
      <div className={cx(s.ruled, rulers && s.on)}>
        {rulers && <Rulers t={t} unit={rulers} hover={hover} />}
        {viewer}
      </div>
      <ViewStrip
        zoom={{
          pct,
          preset,
          disabled: !view,
          onFit: () => act('fit'),
          onActual: () => act('actual'),
          onIn: () => act('in'),
          onOut: () => act('out'),
          onType: (v) => zoomTo(v / 100),
          onBad: setZoomBad,
        }}
        overlays={overlays}
        background={background}
        readout={
          zoomBad ? (
            // the field's own message is too long for the strip: its danger edge says what's wrong, this the range
            <span className={s.error} role="alert">
              <Icon name="error" size={14} />
              {`${MIN_SCALE * 100}% to ${MAX_SCALE * 100}%`}
            </span>
          ) : (
            cursor && <Readout bind={readout} cursor={cursor} />
          )
        }
      />
    </div>
  );
}

function transformOf(v: View, box: Box, el: RefObject<HTMLDivElement | null>): ViewTransform {
  const dpr = box.pw / box.w;
  const o = originOf(v, box);
  const x = Math.round(o.x * dpr) / dpr;
  const y = Math.round(o.y * dpr) / dpr;
  return {
    scale: v.scale,
    x,
    y,
    width: box.w,
    height: box.h,
    dpr,
    visible: { x: -x / v.scale, y: -y / v.scale, w: box.w / v.scale, h: box.h / v.scale },
    toContent(clientX, clientY) {
      const r = el.current?.getBoundingClientRect();
      return { x: (clientX - (r?.left ?? 0) - x) / v.scale, y: (clientY - (r?.top ?? 0) - y) / v.scale };
    },
  };
}

/** its own state, so a pointer move re-renders only the readout */
function Readout({ bind, cursor }: { bind: RefObject<(at: Point | null) => void>; cursor: (p: Point | null) => ReactNode }) {
  const [at, setAt] = useState<Point | null>(null);
  useLayoutEffect(() => {
    bind.current = setAt;
  }, [bind]);
  return <div className={s.readout}>{cursor(at)}</div>;
}

function Probe({ hover, t, probe }: { hover: Hover; t: ViewTransform; probe: NonNullable<ViewportProps['probe']> }) {
  const at = useHover(hover);
  return <div className={s.overlay}>{probe(at && { screen: at, content: { x: (at.x - t.x) / t.scale, y: (at.y - t.y) / t.scale } }, t)}</div>;
}

/**
 * The default readout: the pointer in content px, lit while it is over the view. Tools compose it
 * with their own counts, and may give the unit their content is measured in (`per` px each).
 */
export function cursorXY(p: Point | null, unit = { name: 'px', per: 1, digits: 0 }): ReactNode {
  const v = (n: number) => (unit.digits ? (n / unit.per).toFixed(unit.digits) : Math.floor(n / unit.per));
  return (
    <span className={cx(s.xy, p && s.live)}>
      X <b>{p ? v(p.x) : '–'}</b> Y <b>{p ? v(p.y) : '–'}</b> {unit.name}
    </span>
  );
}
