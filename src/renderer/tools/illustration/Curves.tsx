// The selected ramp's curves (Ramp settings): lightness, chroma and hue through its steps. Dragging a point up or down is the same operation as typing that step's L, C
// or H in the picker: one undoable step per drag (an edit of the base moves the ramp, any other
// step keeps your colour), and Esc puts it back.
import { useRef, useState, type PointerEvent } from 'react';
import type { Oklch } from '../../../shared/color/index.ts';
import { wrapHue } from '../../../shared/palette/space.ts';
import type { Swatch } from '../../../shared/types.ts';
import { cx } from '../../ui/cx.ts';
import { useDocColour } from '../../ui/index.ts';
import { fmtC, fmtH, fmtL } from '../common/names.ts';
import { useWidth } from '../common/useWidth.ts';
import { select, selected, type Doc } from './actions.ts';
import { baseOf, nameOf, rampName, rampOf, recolour, stepsOf, type IllustrationDoc } from './doc.ts';
import type { IllustrationView } from './view-state.ts';
import s from './Ramps.module.css';

type Channel = 'L' | 'C' | 'H';
const H = 200;
const TOP = 14;
const BOTTOM = 14;
const LEFT = 34; // room for the axis numbers
const RIGHT = 14;
const C_MAX = 0.4;
/** the hue curve spans this far either side of the base's hue */
const H_SPAN = 60;
const clamp = (x: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, x));

/** a hue's distance from the base's, in -180..180 */
const dh = (h: number, base: number) => ((((h - base) % 360) + 540) % 360) - 180;

/** where a channel sits, 0 (bottom) to 1 (top) */
const unitOf = (ch: Channel, o: Oklch, base: Oklch): number => (ch === 'L' ? o[0] : ch === 'C' ? o[1] / C_MAX : 0.5 + dh(o[2], base[2]) / (2 * H_SPAN));
/** a colour with one channel set from where it was dragged to */
const withUnit = (ch: Channel, o: Oklch, base: Oklch, u: number): Oklch =>
  ch === 'L' ? [u, o[1], o[2]] : ch === 'C' ? [o[0], u * C_MAX, o[2]] : [o[0], o[1], wrapHue(base[2] + (u - 0.5) * 2 * H_SPAN)];

const LINES: { ch: Channel; name: string; cls: string }[] = [
  { ch: 'L', name: 'Lightness', cls: 'cl' },
  { ch: 'C', name: 'Chroma', cls: 'cc' },
  { ch: 'H', name: 'Hue', cls: 'ch' },
];

export function Curves({ doc, d, v }: { doc: Doc; d: IllustrationDoc; v: IllustrationView }) {
  const { ref, width } = useWidth<HTMLDivElement>();
  const w = selected(d, v.selected);
  const r = rampOf(d, w?.group);
  const steps = r ? stepsOf(d, r.id) : [];
  const base = r ? (baseOf(d, r.id)?.oklch ?? r.base) : null;
  const [at, setAt] = useState<{ id: string; ch: Channel } | null>(null);
  const nums = steps.map((p) => p.step ?? 0);
  const lo = Math.min(0, ...nums);
  const cols = Math.max(1, Math.max(0, ...nums) - lo + 1);
  const plotW = Math.max(0, width - LEFT - RIGHT);
  const colW = plotW / cols;
  const x = (step: number) => LEFT + (step - lo + 0.5) * colW;
  const y = (u: number) => TOP + (1 - clamp(u, 0, 1)) * (H - TOP - BOTTOM);
  const shown = at && steps.find((p) => p.id === at.id);

  return (
    <section className={s.curves} aria-label="Curves">
      <header className={s.chead}>
        <span className={s.ctitle}>Curves</span>
        <span className={s.chint}>{r ? `${rampName(d, r)}: drag a point to edit that step` : 'Select a ramp to see its curves'}</span>
        <span className={s.grow} />
        {shown && (
          <span className={s.creadout}>
            {nameOf(d, shown)} · L {fmtL(shown.oklch[0])} · C {fmtC(shown.oklch[1])} · H {fmtH(shown.oklch[2])}
          </span>
        )}
        <span className={s.legend}>
          {LINES.map((l) => (
            <span key={l.ch}>
              <i className={s[l.cls]} />
              {l.name}
            </span>
          ))}
        </span>
      </header>
      <div ref={ref} className={s.plot}>
        {r && base && width > 0 && (
          <svg width={width} height={H} role="group" aria-label={`${rampName(d, r)} curves`} className={s.svg}>
            {[0, 0.33, 0.66, 1].map((u) => (
              <g key={u}>
                <line className={s.grid} x1={LEFT} x2={width - RIGHT} y1={y(u)} y2={y(u)} />
                <text className={s.axis} x={LEFT - 12} y={y(u) + 3.5} textAnchor="end">
                  {Math.round(u * 100)}
                </text>
              </g>
            ))}
            {steps.map((p) => (
              <line key={p.id} className={cx(s.gridV, p.id === w?.id && s.gridOn)} x1={x(p.step!)} x2={x(p.step!)} y1={TOP} y2={H - BOTTOM} />
            ))}
            {LINES.map((l) => (
              <polyline key={l.ch} className={cx(s.line, s[l.cls])} fill="none" points={steps.map((p) => `${x(p.step!)},${y(unitOf(l.ch, p.oklch, base))}`).join(' ')} />
            ))}
            {steps.map((p) => (
              <Points key={p.id} doc={doc} d={d} w={p} base={base} x={x(p.step!)} y={(ch, o) => y(unitOf(ch, o, base))} top={TOP} height={H - TOP - BOTTOM} on={p.id === w?.id} onAt={(ch) => setAt(ch ? { id: p.id, ch } : null)} />
            ))}
          </svg>
        )}
      </div>
    </section>
  );
}

type PointsProps = {
  doc: Doc;
  d: IllustrationDoc;
  w: Swatch;
  base: Oklch;
  x: number;
  y(ch: Channel, o: Oklch): number;
  top: number;
  height: number;
  on: boolean;
  onAt(ch: Channel | null): void;
};

/** the three dots of one step; each drags one channel of that step's colour, as one gesture */
function Points({ doc, d, w, base, x, y, top, height, on, onAt }: PointsProps) {
  const name = nameOf(d, w);
  const colour = useDocColour(doc, {
    label: `Change ${name}`,
    key: `${w.id}:colour`,
    get: (z) => z.swatches.find((q) => q.id === w.id)?.oklch ?? w.oklch,
    set: (z, o) => recolour(z, w.id, o),
  });
  const drag = useRef<{ id: number; ch: Channel; el: SVGCircleElement; start: Oklch; onKey(e: KeyboardEvent): void } | null>(null);

  const apply = (e: PointerEvent<Element>) => {
    const dr = drag.current;
    if (!dr) return;
    const rect = dr.el.ownerSVGElement!.getBoundingClientRect();
    const u = clamp(1 - (e.clientY - rect.top - top) / height, 0, 1);
    colour.onChange(withUnit(dr.ch, dr.start, base, u));
  };
  const end = (commit: boolean) => {
    const dr = drag.current;
    drag.current = null;
    if (!dr) return;
    removeEventListener('keydown', dr.onKey, true);
    if (dr.el.hasPointerCapture(dr.id)) dr.el.releasePointerCapture(dr.id);
    if (commit) colour.onCommit?.();
    else colour.onCancel?.();
  };
  const down = (ch: Channel) => (e: PointerEvent<SVGCircleElement>) => {
    if (e.button !== 0 || drag.current) return;
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    select(w.id);
    const onKey = (k: KeyboardEvent) => {
      if (k.key !== 'Escape') return;
      k.preventDefault();
      k.stopPropagation();
      end(false);
    };
    addEventListener('keydown', onKey, true);
    drag.current = { id: e.pointerId, ch, el: e.currentTarget, start: colour.value, onKey };
    colour.onBegin?.();
  };

  const o = colour.value;
  return (
    <g>
      {LINES.map((l) => (
        <circle
          key={l.ch}
          className={cx(s.pt, s[l.cls], on && s.ptOn)}
          cx={x}
          cy={y(l.ch, o)}
          r={on ? 6 : 5}
          data-curve-point={`${w.id}:${l.ch}`}
          role="slider"
          aria-label={`${name} ${l.name.toLowerCase()}`}
          aria-valuetext={l.ch === 'L' ? `L ${fmtL(o[0])}` : l.ch === 'C' ? `C ${fmtC(o[1])}` : `H ${fmtH(o[2])}`}
          onPointerDown={down(l.ch)}
          onPointerMove={(e) => drag.current?.id === e.pointerId && apply(e)}
          onPointerUp={(e) => drag.current?.id === e.pointerId && end(true)}
          onLostPointerCapture={() => end(true)}
          onPointerEnter={() => onAt(l.ch)}
          onPointerLeave={() => !drag.current && onAt(null)}
        />
      ))}
    </g>
  );
}
