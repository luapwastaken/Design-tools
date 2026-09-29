// A screen angle as a dial (the mockup's ink rows): drag round it to turn the screen, Shift for
// 15° steps, Esc to cancel. Always beside the angle's NumberField, which is the control the
// keyboard and screen readers use (brief rule 5).
import { useEffect, useRef, type PointerEvent } from 'react';
import type { NumberGesture } from '../../ui/index.ts';
import { cx } from '../../ui/cx.ts';
import { foldAngle } from './doc.ts';
import s from './Dial.module.css';

const R = 10.5;

export function Dial({ value, disabled, className, ...g }: { value: number; disabled?: boolean; className?: string } & NumberGesture) {
  const live = useRef(g);
  live.current = g;
  const drag = useRef<{ id: number; el: Element; last: number; onKey(e: KeyboardEvent): void } | null>(null);

  const end = (commit: boolean) => {
    const d = drag.current;
    drag.current = null;
    if (!d) return;
    removeEventListener('keydown', d.onKey, true);
    if (d.el.hasPointerCapture(d.id)) d.el.releasePointerCapture(d.id);
    if (commit) live.current.onCommit?.();
    else live.current.onCancel?.();
  };
  useEffect(() => () => end(true), []);

  const angleAt = (e: PointerEvent<SVGSVGElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    const a = foldAngle((Math.atan2(r.top + r.height / 2 - e.clientY, e.clientX - r.left - r.width / 2) * 180) / Math.PI);
    const snapped = e.shiftKey ? Math.round(a / 15) * 15 : Math.round(a * 2) / 2;
    return snapped >= 180 ? 0 : snapped;
  };
  const move = (e: PointerEvent<SVGSVGElement>) => {
    const d = drag.current;
    if (!d || d.id !== e.pointerId) return;
    const a = angleAt(e);
    if (a !== d.last) live.current.onChange((d.last = a));
  };

  const rad = (value * Math.PI) / 180;
  const [x, y] = [Math.cos(rad) * R, -Math.sin(rad) * R];
  return (
    <svg
      viewBox="-12 -12 24 24"
      className={cx(s.dial, disabled && s.off, className)}
      aria-hidden="true"
      onPointerDown={(e) => {
        if (disabled || e.button !== 0 || drag.current) return;
        e.preventDefault();
        e.currentTarget.setPointerCapture(e.pointerId);
        const onKey = (k: KeyboardEvent) => {
          if (k.key !== 'Escape') return;
          k.preventDefault();
          k.stopPropagation();
          end(false);
        };
        addEventListener('keydown', onKey, true);
        drag.current = { id: e.pointerId, el: e.currentTarget, last: value, onKey };
        live.current.onBegin?.();
        move(e);
      }}
      onPointerMove={move}
      onPointerUp={() => end(true)}
      onLostPointerCapture={() => end(true)}
    >
      <circle r={R + 0.5} />
      <line className={s.zero} x1={R - 3} y1={0} x2={R + 0.5} y2={0} />
      {/* a screen runs both ways through its centre */}
      <line x1={-x} y1={-y} x2={x} y2={y} className={s.back} />
      <line x1={0} y1={0} x2={x} y2={y} />
    </svg>
  );
}
