// The edit view (spec §2): one lockup large on the surround, its clearspace and guides as toggles,
// and handles on the icon that scale it against the wordmark. A handle follows the pointer: the
// icon scales about its opposite corner while the wordmark keeps its size on screen (v1's handles
// drifted, and the view refitted under them).
import { useMemo, useRef, useState, type PointerEvent, type ReactNode } from 'react';
import { capBand, layoutLockup } from '../../../shared/logo/layout.ts';
import { sideBySide } from '../../../shared/logo/types.ts';
import { lockupSvg } from '../../../shared/logo/svg.ts';
import { Toggle, Viewport, type ViewTransform, type Zoom } from '../../ui/index.ts';
import { cx } from '../../ui/cx.ts';
import type { Doc } from './actions.ts';
import { fix, KIND_LABEL, mapLockup, twoParts, type Lockup, type LogoDoc } from './doc.ts';
import { corners, heldView, pngSize, pxPerUnit, ratioFor, type Grip } from './geometry.ts';
import { useSvgUrl } from './raster.ts';
import { surroundOf } from './surround.ts';
import { patchView, type LogoView } from './view-state.ts';
import s from './Stage.module.css';

type Hold = { g: Grip; id: number; rect: DOMRect; box: { w: number; h: number }; base: LogoDoc; lockup: Lockup; onKey(e: KeyboardEvent): void };

const CURSORS = ['nwse-resize', 'nesw-resize', 'nwse-resize', 'nesw-resize'];
const HANDLE = 9;
/** what a handle catches: more than it shows, so a small icon's corner is easy to take */
const HIT = 17;

export function Stage({ doc, d, v, lockup }: { doc: Doc; d: LogoDoc; v: LogoView; lockup: Lockup }) {
  const lay = useMemo(() => layoutLockup(d, lockup), [d.icon, d.wordmark, lockup]);
  const u = pxPerUnit(d, lay, v.version);
  const pad = d.clearspace;
  const W = (lay.w + 2 * pad) * u;
  const H = (lay.h + 2 * pad) * u;
  const svg = useMemo(() => lockupSvg(d, lockup, v.version, { padding: 'clearspace', height: H }), [d.icon, d.wordmark, d.colour, pad, lockup, v.version, H]);
  const url = useSvgUrl(svg);
  const ground = surroundOf(v.surround, d);

  // a handle drag: the view it holds, so the icon's far corner stays put while the lockup's size changes
  const [held, setHeld] = useState<Zoom | null>(null);
  const heldNow = useRef<Zoom | null>(null);
  const hold = useRef<Hold | null>(null);
  const seen = useRef<ViewTransform | null>(null);

  const end = (commit: boolean) => {
    const h = hold.current;
    hold.current = null;
    if (!h) return;
    removeEventListener('keydown', h.onKey, true);
    // Ctrl+Z mid-drag already cancelled the gesture: nothing to keep
    const kept = commit && doc.inGesture();
    if (kept) doc.commit(`Resize the icon in ${KIND_LABEL[h.lockup.kind].toLowerCase()}`);
    else doc.cancel();
    // a fitted view fits the new lockup once the drag ends; a chosen zoom stays where the drag left it
    if (kept && heldNow.current && v.zoom !== 'fit') patchView({ zoom: heldNow.current });
    heldNow.current = null;
    setHeld(null);
  };

  const grab = (corner: number) => (e: PointerEvent<SVGRectElement>) => {
    const t = seen.current;
    if (e.button !== 0 || hold.current || !t || !lay.icon) return;
    e.preventDefault();
    e.stopPropagation();
    e.currentTarget.setPointerCapture(e.pointerId);
    const S = u * t.scale;
    const anchor = corners(lay.icon)[(corner + 2) % 4];
    const onKey = (k: KeyboardEvent) => {
      if (k.key !== 'Escape') return;
      k.preventDefault();
      k.stopPropagation();
      end(false);
    };
    addEventListener('keydown', onKey, true);
    hold.current = {
      g: { corner, a0: { x: t.x + (anchor.x + pad) * S, y: t.y + (anchor.y + pad) * S }, cap: S / lockup.ratio },
      id: e.pointerId,
      rect: e.currentTarget.ownerSVGElement!.getBoundingClientRect(),
      box: { w: t.width, h: t.height },
      base: d,
      lockup,
      onKey,
    };
    doc.begin();
  };

  const drag = (e: PointerEvent<SVGRectElement>) => {
    const h = hold.current;
    if (!h || e.pointerId !== h.id) return;
    if (!doc.inGesture()) return end(false);
    const ratio = ratioFor(h.base, h.g, { x: e.clientX - h.rect.left, y: e.clientY - h.rect.top });
    doc.set((x) => fix(mapLockup(x, h.lockup.kind, (l) => ({ ...l, ratio }))));
    const view = heldView(h.base, { ...h.lockup, ratio }, h.g, h.box, v.version);
    heldNow.current = view;
    setHeld(view);
  };

  const render = (ctx: CanvasRenderingContext2D, t: ViewTransform) => {
    ctx.fillStyle = ground;
    ctx.fillRect(t.visible.x, t.visible.y, t.visible.w, t.visible.h);
  };

  const overlay = (t: ViewTransform): ReactNode => {
    seen.current = t;
    return <Marks d={d} v={v} lockup={lockup} t={t} u={u} W={W} H={H} dragging={held !== null} grab={grab} drag={drag} end={end} />;
  };

  const png = pngSize(d, lay, v.version);
  const readout = () =>
    held ? (
      <span className={s.live}>
        Icon <b>{lockup.ratio.toFixed(2)}</b> × {d.wordmark?.type ? 'cap height' : 'wordmark height'}
      </span>
    ) : (
      <span>
        PNG <b>{png.w}</b> × <b>{png.h}</b> px
      </span>
    );

  return (
    <Viewport
      className={s.vp}
      contentWidth={W}
      contentHeight={H}
      render={render}
      overlay={overlay}
      zoom={held ?? v.zoom}
      onZoom={(zoom) => !hold.current && patchView({ zoom })}
      cursor={readout}
      bar={
        <>
          <span className={s.sep} />
          <Toggle label="Clearspace" checked={v.clearspace} onChange={(clearspace) => patchView({ clearspace })} className={s.toggle} />
          <Toggle label="Guides" checked={v.guides} onChange={(guides) => patchView({ guides })} className={s.toggle} />
        </>
      }
    >
      {url && <img src={url} width={W} height={H} alt="" draggable={false} className={s.art} />}
    </Viewport>
  );
}

type MarksProps = {
  d: LogoDoc;
  v: LogoView;
  lockup: Lockup;
  t: ViewTransform;
  u: number;
  W: number;
  H: number;
  dragging: boolean;
  grab(corner: number): (e: PointerEvent<SVGRectElement>) => void;
  drag(e: PointerEvent<SVGRectElement>): void;
  end(commit: boolean): void;
};

/**
 * The marks over the lockup, in screen px so they stay one device pixel at any zoom: the clearspace
 * box, the guides (each part's artwork box, the wordmark's cap line and baseline, the gap) and the
 * icon's handles. Lines are white on a dark halo, so they read on any surround and any logo.
 */
function Marks({ d, v, lockup, t, u, W, H, dragging, grab, drag, end }: MarksProps) {
  const lay = layoutLockup(d, lockup);
  const pad = d.clearspace;
  const S = u * t.scale;
  const X = (x: number) => t.x + (x + pad) * S;
  const Y = (y: number) => t.y + (y + pad) * S;
  const snap = (p: number) => (Math.round(p * t.dpr) + 0.5) / t.dpr;
  const box = (x: number, y: number, w: number, h: number) => `M${snap(x)} ${snap(y)}H${snap(x + w)}V${snap(y + h)}H${snap(x)}Z`;
  const hLine = (y: number, x0: number, x1: number) => `M${snap(x0)} ${snap(y)}H${snap(x1)}`;
  const vLine = (x: number, y0: number, y1: number) => `M${snap(x)} ${snap(y0)}V${snap(y1)}`;

  const solid: string[] = [];
  const dashed: string[] = [];
  const labels: { x: number; y: number; text: string; anchor?: 'end' | 'middle' }[] = [];
  const [left, right] = [X(-pad), X(lay.w + pad)];

  if (v.clearspace) {
    dashed.push(box(t.x, t.y, W * t.scale, H * t.scale));
    solid.push(box(X(0), Y(0), lay.w * S, lay.h * S));
    // kept inside the view when the box runs past its edge
    labels.push({ x: Math.max(6, t.x), y: Math.max(14, t.y - 6), text: `Clearspace ${pad.toFixed(2)}×` });
  }

  const { icon, wordmark } = lay;
  if (v.guides) {
    if (icon) solid.push(box(X(icon.x), Y(icon.y), icon.w * S, icon.h * S));
    if (wordmark && d.wordmark) {
      solid.push(box(X(wordmark.x), Y(wordmark.y), wordmark.w * S, wordmark.h * S));
      const band = capBand(d.wordmark);
      const k = wordmark.h / d.wordmark.box.h;
      const cap = Y(wordmark.y + (band.top - d.wordmark.box.y) * k);
      const base = Y(wordmark.y + (band.base - d.wordmark.box.y) * k);
      dashed.push(hLine(cap, left, right), hLine(base, left, right));
      // past the clearspace's right edge, off the artwork, unless the view ends there
      const room = t.width - right > 64;
      const at = room ? { x: right + 6, anchor: undefined } : { x: right, anchor: 'end' as const };
      if (d.wordmark.type) labels.push({ ...at, y: cap + 3.5, text: 'Cap' }, { ...at, y: base + 3.5, text: 'Baseline' });
    }
    if (icon && wordmark) {
      if (sideBySide(lockup.kind)) {
        const [a, b] = lockup.kind === 'horizontal' ? [X(icon.x + icon.w), X(wordmark.x)] : [X(wordmark.x + wordmark.w), X(icon.x)];
        const y = Y(icon.y + icon.h / 2);
        solid.push(hLine(y, a, b), vLine(a, y - 4, y + 4), vLine(b, y - 4, y + 4));
        // above the lockup, where the clearspace is empty, over the gap
        solid.push(vLine((a + b) / 2, Y(0) - 5, Y(0)));
        labels.push({ x: (a + b) / 2, y: Y(0) - 9, text: `Gap ${lockup.gap.toFixed(2)}×`, anchor: 'middle' });
      } else {
        const [a, b] = [Y(icon.y + icon.h), Y(wordmark.y)];
        const x = X(icon.x + icon.w / 2);
        solid.push(vLine(x, a, b), hLine(a, x - 4, x + 4), hLine(b, x - 4, x + 4));
        // beside the lockup, where the clearspace is empty, level with the gap
        solid.push(hLine((a + b) / 2, X(lay.w), X(lay.w) + 5));
        labels.push({ x: X(lay.w) + 8, y: (a + b) / 2 + 3.5, text: `Gap ${lockup.gap.toFixed(2)}×` });
        const axis = lockup.align === 'start' ? X(0) : lockup.align === 'end' ? X(lay.w) : X(lay.w / 2);
        dashed.push(vLine(axis, Y(-pad), Y(lay.h + pad)));
      }
    }
  }

  const handles = twoParts(lockup.kind) && icon && wordmark ? corners(icon).map((c) => ({ x: X(c.x), y: Y(c.y) })) : [];
  const grip = (i: number) => ({
    style: { cursor: CURSORS[i] },
    onPointerDown: grab(i),
    onPointerMove: drag,
    onPointerUp: () => end(true),
    onLostPointerCapture: () => end(true),
  });
  return (
    <svg className={cx(s.marks, dragging && s.dragging)} width={t.width} height={t.height}>
      <g className={s.halo}>
        <path d={solid.join('')} />
        <path d={dashed.join('')} />
      </g>
      <path className={s.line} d={solid.join('')} />
      <path className={cx(s.line, s.dash)} d={dashed.join('')} />
      {labels.map((l, i) => (
        <text key={i} x={l.x} y={l.y} textAnchor={l.anchor ?? 'start'} className={s.label}>
          {l.text}
        </text>
      ))}
      {handles.map((p, i) => (
        <g key={i} className={s.grip} {...grip(i)}>
          <rect x={p.x - HIT / 2} y={p.y - HIT / 2} width={HIT} height={HIT} className={s.hit} />
          <rect x={Math.round(p.x - HANDLE / 2) + 0.5} y={Math.round(p.y - HANDLE / 2) + 0.5} width={HANDLE - 1} height={HANDLE - 1} className={s.handle} />
        </g>
      ))}
    </svg>
  );
}
