// The pasteboard (spec §5): every lockup that's on is a named artboard on one surface. A click
// selects one (it gets the ember ring and its marks), a double click zooms to it, and Fit shows them
// all again. The selected lockup has its clearspace and guides as toggles, and handles on the icon
// that scale it against the wordmark. A handle follows the pointer: the icon scales about its
// opposite corner while the wordmark keeps its size on screen.
import { Fragment, useMemo, useRef, useState, type PointerEvent, type ReactNode } from 'react';
import { capBand } from '../../../shared/logo/layout.ts';
import { sideBySide } from '../../../shared/logo/types.ts';
import { Segmented, Toggle, Viewport, type ViewTransform } from '../../ui/index.ts';
import { clampScale } from '../../ui/viewport.ts';
import { cx } from '../../ui/cx.ts';
import { select, type Doc } from './actions.ts';
import { boardLayout, CELL, LABEL, type Cell, type Drag } from './board.ts';
import { fix, KIND_LABEL, KIND_WHERE, mapLockup, twoParts, VERSION_LABEL, type LogoDoc } from './doc.ts';
import { corners, pngSize, ratioFor, type Grip } from './geometry.ts';
import { LockupImg } from './LockupImg.tsx';
import { SURROUNDS, surroundOf } from './surround.ts';
import { patchView, type LogoView } from './view-state.ts';
import s from './Board.module.css';

type Hold = { g: Grip; id: number; rect: DOMRect; base: LogoDoc; cell: Cell; onKey(e: KeyboardEvent): void };

const CURSORS = ['nwse-resize', 'nesw-resize', 'nwse-resize', 'nesw-resize'];
const HANDLE = 9;
/** what a handle catches: more than it shows, so a small icon's corner is easy to take */
const HIT = 17;

/** the canvas background, in the view strip: what the artboards are judged on */
export const Canvas = ({ v }: { v: LogoView }) => (
  <>
    <span className={s.canvasLabel}>Canvas</span>
    <Segmented options={SURROUNDS} value={v.surround} onChange={(surround) => patchView({ surround })} fit />
  </>
);

export function Board({ doc, d, v, selected }: { doc: Doc; d: LogoDoc; v: LogoView; selected: Cell['l']['kind'] }) {
  const [drag, setDrag] = useState<Drag | null>(null);
  const hold = useRef<Hold | null>(null);
  const seen = useRef<ViewTransform | null>(null);
  const layout = useMemo(() => boardLayout(d, drag), [d, drag]);
  const ground = surroundOf(v.surround, d);
  const cell = layout.cells.find((c) => c.l.kind === selected) ?? layout.cells[0];

  const end = (commit: boolean) => {
    const h = hold.current;
    hold.current = null;
    if (!h) return;
    removeEventListener('keydown', h.onKey, true);
    // Ctrl+Z mid-drag already cancelled the gesture: nothing to keep
    if (commit && doc.inGesture()) doc.commit(`Resize the icon in ${KIND_LABEL[h.cell.l.kind].toLowerCase()}`);
    else doc.cancel();
    setDrag(null);
  };

  const grab = (corner: number) => (e: PointerEvent<SVGRectElement>) => {
    const t = seen.current;
    if (e.button !== 0 || hold.current || !t || !cell.lay.icon) return;
    e.preventDefault();
    e.stopPropagation();
    e.currentTarget.setPointerCapture(e.pointerId);
    const a = corners(cell.lay.icon)[(corner + 2) % 4];
    const anchor = { x: cell.img.x + (a.x + d.clearspace) * cell.u, y: cell.img.y + (a.y + d.clearspace) * cell.u };
    const onKey = (k: KeyboardEvent) => {
      if (k.key !== 'Escape') return;
      k.preventDefault();
      k.stopPropagation();
      end(false);
    };
    addEventListener('keydown', onKey, true);
    hold.current = {
      // the cap height on screen stays put: layout units are icon heights, so it is the unit over the ratio
      g: { corner, a0: { x: t.x + anchor.x * t.scale, y: t.y + anchor.y * t.scale }, cap: (cell.u * t.scale) / cell.l.ratio },
      id: e.pointerId,
      rect: e.currentTarget.ownerSVGElement!.getBoundingClientRect(),
      base: d,
      cell,
      onKey,
    };
    setDrag({ kind: cell.l.kind, k: cell.k, anchor, corner });
    doc.begin();
  };

  const move = (e: PointerEvent<SVGRectElement>) => {
    const h = hold.current;
    if (!h || e.pointerId !== h.id) return;
    if (!doc.inGesture()) return end(false);
    const ratio = ratioFor(h.base, h.g, { x: e.clientX - h.rect.left, y: e.clientY - h.rect.top });
    doc.set((x) => fix(mapLockup(x, h.cell.l.kind, (l) => ({ ...l, ratio }))));
  };

  /** the artboard as large as the view allows */
  const zoomTo = (c: Cell) => {
    const t = seen.current;
    select(c.l.kind);
    if (!t) return;
    const scale = clampScale(Math.min(t.width / (CELL.w * 1.12), t.height / ((CELL.h + LABEL) * 1.25)));
    patchView({ zoom: { scale, x: c.x + CELL.w / 2, y: c.y + (CELL.h - LABEL) / 2 } });
  };

  const overlay = (t: ViewTransform): ReactNode => {
    seen.current = t;
    return <Marks layout={layout} cell={cell} d={d} v={v} t={t} dragging={drag !== null} grab={grab} move={move} end={end} zoomTo={zoomTo} />;
  };

  const png = cell && pngSize(d, cell.lay, v.version);
  const readout = () =>
    drag ? (
      <span className={s.live}>
        Icon <b>{cell.l.ratio.toFixed(2)}</b> × {d.wordmark?.type ? 'cap height' : 'wordmark height'}
      </span>
    ) : (
      <span>
        {KIND_LABEL[cell.l.kind]} · {VERSION_LABEL[v.version]} · PNG <b>{png.w.toLocaleString('en')}</b> × <b>{png.h.toLocaleString('en')}</b> px
      </span>
    );

  return (
    <Viewport
      className={s.vp}
      contentWidth={layout.w}
      contentHeight={layout.h}
      frame={false}
      overlay={overlay}
      zoom={v.zoom}
      onZoom={(zoom) => !hold.current && patchView({ zoom })}
      cursor={readout}
      overlays={
        <>
          <Toggle label="Clearspace" checked={v.clearspace} onChange={(clearspace) => patchView({ clearspace })} className={s.toggle} />
          <Toggle label="Guides" checked={v.guides} onChange={(guides) => patchView({ guides })} className={s.toggle} />
          <Toggle label="Sheet" checked={false} onChange={() => patchView({ mode: 'sheet' })} className={s.toggle} />
        </>
      }
      background={<Canvas v={v} />}
    >
      {layout.cells.map((c) => (
        <Fragment key={c.l.kind}>
          <div className={s.cell} style={{ left: c.x, top: c.y, width: CELL.w, height: CELL.h, background: ground }} />
          <div className={s.art} style={{ left: c.img.x, top: c.img.y, width: c.img.w, height: c.img.h }}>
            <LockupImg d={d} lockup={c.l} version={v.version} padding="clearspace" height={Math.max(1, Math.round(c.img.h))} />
          </div>
        </Fragment>
      ))}
    </Viewport>
  );
}

type MarksProps = {
  layout: ReturnType<typeof boardLayout>;
  cell: Cell;
  d: LogoDoc;
  v: LogoView;
  t: ViewTransform;
  dragging: boolean;
  grab(corner: number): (e: PointerEvent<SVGRectElement>) => void;
  move(e: PointerEvent<SVGRectElement>): void;
  end(commit: boolean): void;
  zoomTo(c: Cell): void;
};

/**
 * Over the artboards, in screen px so lines stay one device pixel at any zoom: each artboard's name
 * and its hit area, the selected one's ring, and on it the clearspace box, the guides (each part's
 * artwork box, the wordmark's cap line and baseline, the gap) and the icon's handles. Lines are
 * white on a dark halo, so they read on any surround and any logo.
 */
function Marks({ layout, cell, d, v, t, dragging, grab, move, end, zoomTo }: MarksProps) {
  const sel = cell.l;
  // the selected logo's own frame: its top left is the clearspace box's
  const o = { ...t, x: t.x + cell.img.x * t.scale, y: t.y + cell.img.y * t.scale };
  return (
    <svg className={cx(s.marks, dragging && s.dragging)} width={t.width} height={t.height}>
      <g role="radiogroup" aria-label="Lockups">
        {layout.cells.map((c) => {
          const on = c.l.kind === sel.kind;
          const [x, y, w, h] = [t.x + c.x * t.scale, t.y + c.y * t.scale, CELL.w * t.scale, CELL.h * t.scale];
          const pick = () => select(c.l.kind);
          return (
            <g key={c.l.kind} className={on ? s.on : undefined}>
              <rect
                className={s.hit}
                x={x}
                y={y}
                width={w}
                height={h}
                role="radio"
                aria-checked={on}
                aria-label={KIND_LABEL[c.l.kind]}
                data-artboard={c.l.kind}
                tabIndex={on ? 0 : -1}
                onClick={pick}
                onDoubleClick={() => zoomTo(c)}
                onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && (e.preventDefault(), pick())}
              />
              <text x={x} y={y - 9} className={s.name}>
                {KIND_LABEL[c.l.kind]}
                <tspan className={s.where} dx="8">
                  {KIND_WHERE[c.l.kind]}
                </tspan>
              </text>
              {on && <rect className={s.ring} x={x - 0.5} y={y - 0.5} width={w + 1} height={h + 1} rx="4" pointerEvents="none" />}
            </g>
          );
        })}
      </g>
      <Guides cell={cell} d={d} v={v} t={o} dragging={dragging} grab={grab} move={move} end={end} />
    </svg>
  );
}

function Guides({ cell, d, v, t, dragging, grab, move, end }: { cell: Cell; d: LogoDoc; v: LogoView; t: ViewTransform; dragging: boolean; grab: MarksProps['grab']; move: MarksProps['move']; end: MarksProps['end'] }) {
  const { lay, l: lockup } = cell;
  const pad = d.clearspace;
  const S = cell.u * t.scale;
  const [W, H] = [cell.img.w, cell.img.h];
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
    labels.push({ x: t.x + 6, y: t.y + H * t.scale - 7, text: `Clearspace ${pad.toFixed(2)}×` });
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
      // inside the clearspace's right edge, off the artwork
      if (d.wordmark.type) labels.push({ x: right - 6, y: cap - 5, text: 'Cap', anchor: 'end' }, { x: right - 6, y: base + 12, text: 'Baseline', anchor: 'end' });
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
    onPointerMove: move,
    onPointerUp: () => end(true),
    onLostPointerCapture: () => end(true),
  });
  return (
    <g pointerEvents="none" className={cx(dragging && s.dragging)}>
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
          <rect x={p.x - HIT / 2} y={p.y - HIT / 2} width={HIT} height={HIT} className={s.gripHit} />
          <rect x={Math.round(p.x - HANDLE / 2) + 0.5} y={Math.round(p.y - HANDLE / 2) + 0.5} width={HANDLE - 1} height={HANDLE - 1} className={s.handle} />
        </g>
      ))}
    </g>
  );
}
