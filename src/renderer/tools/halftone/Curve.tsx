// An ink's transfer curve, the way Illustrator and Photoshop set one for a screen: the dot it prints
// for 0, 25, 50, 75 and 100% in. Drag a point up or down on the graph, or type its value (brief rule 5).
import { useEffect, useRef, type PointerEvent } from 'react';
import { NumberField, useDocNumber } from '../../ui/index.ts';
import { cx } from '../../ui/cx.ts';
import type { Doc } from './actions.ts';
import { curveAt, CURVE_AT, IDENTITY, isIdentity, mapInk, withPoint, type Ink } from './doc.ts';
import s from './Curve.module.css';

const W = 200;
const H = 96;
const PAD = 7;
const px = (x: number) => PAD + x * (W - 2 * PAD);
const py = (y: number) => H - PAD - y * (H - 2 * PAD);

function PointField({ doc, ink, at }: { doc: Doc; ink: Ink; at: number }) {
  const n = useDocNumber(doc, {
    label: `Change the ${ink.name} curve`,
    key: `curve:${ink.id}:${at}`,
    get: (d) => Math.round(curveAt(d.inks.find((i) => i.id === ink.id)?.curve ?? IDENTITY, CURVE_AT[at]) * 100),
    set: (d, v) => mapInk(d, ink.id, (i) => ({ ...i, curve: withPoint(i.curve, at, v / 100) })),
  });
  return <NumberField label={`Out at ${CURVE_AT[at] * 100}% in`} hideLabel min={0} max={100} unit="%" {...n} />;
}

export function Curve({ doc, ink }: { doc: Doc; ink: Ink }) {
  const drag = useRef<{ id: number; el: Element; at: number; onKey(e: KeyboardEvent): void } | null>(null);
  const end = (commit: boolean) => {
    const d = drag.current;
    drag.current = null;
    if (!d) return;
    removeEventListener('keydown', d.onKey, true);
    if (d.el.hasPointerCapture(d.id)) d.el.releasePointerCapture(d.id);
    if (commit) doc.commit(`Change the ${ink.name} curve`);
    else doc.cancel();
  };
  useEffect(() => () => end(true), []);

  const valueAt = (e: PointerEvent<SVGSVGElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    const y = 1 - ((e.clientY - r.top) / r.height * H - PAD) / (H - 2 * PAD);
    return Math.round(Math.min(1, Math.max(0, y)) * 100) / 100;
  };
  const move = (e: PointerEvent<SVGSVGElement>) => {
    const d = drag.current;
    if (!d || d.id !== e.pointerId || !doc.inGesture()) return;
    const v = valueAt(e);
    doc.set((x) => mapInk(x, ink.id, (i) => ({ ...i, curve: withPoint(i.curve, d.at, v) })));
  };

  const pts = CURVE_AT.map((x) => [x, curveAt(ink.curve, x)] as const);
  const line = pts.map(([x, y]) => `${px(x)},${py(y)}`).join(' ');
  const plain = isIdentity(ink.curve);
  return (
    <div className={s.curve}>
      <svg
        viewBox={`0 0 ${W} ${H}`}
        className={s.graph}
        aria-hidden="true"
        onPointerDown={(e) => {
          if (e.button !== 0 || drag.current) return;
          e.preventDefault();
          const r = e.currentTarget.getBoundingClientRect();
          const x = ((e.clientX - r.left) / r.width) * W;
          const at = CURVE_AT.reduce((best, c, i) => (Math.abs(px(c) - x) < Math.abs(px(CURVE_AT[best]) - x) ? i : best), 0);
          e.currentTarget.setPointerCapture(e.pointerId);
          const onKey = (k: KeyboardEvent) => {
            if (k.key !== 'Escape') return;
            k.preventDefault();
            k.stopPropagation();
            end(false);
          };
          addEventListener('keydown', onKey, true);
          drag.current = { id: e.pointerId, el: e.currentTarget, at, onKey };
          doc.begin();
          move(e);
        }}
        onPointerMove={move}
        onPointerUp={() => end(true)}
        onLostPointerCapture={() => end(true)}
      >
        {CURVE_AT.map((c) => (
          <g key={c}>
            <line className={s.grid} x1={px(c)} y1={py(0)} x2={px(c)} y2={py(1)} />
            <line className={s.grid} x1={px(0)} y1={py(c)} x2={px(1)} y2={py(c)} />
          </g>
        ))}
        <line className={s.ident} x1={px(0)} y1={py(0)} x2={px(1)} y2={py(1)} />
        <polyline className={cx(s.line, plain && s.plain)} points={line} />
        {pts.map(([x, y]) => (
          <rect key={x} className={s.point} x={px(x) - 3} y={py(y) - 3} width={6} height={6} />
        ))}
      </svg>
      <div className={s.fields}>
        {CURVE_AT.map((c, i) => (
          <div key={c} className={s.col}>
            <span className="lbl">{c * 100}</span>
            <PointField doc={doc} ink={ink} at={i} />
          </div>
        ))}
      </div>
    </div>
  );
}
