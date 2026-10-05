import type { KeyboardEvent, PointerEvent } from 'react';
import s from './ResizeHandle.module.css';

type Props = {
  value: number;
  min: number;
  max: number;
  reset: number;
  label: string;
  /** which edge of its panel it sits on; a left edge grows the panel as it moves left, a top edge as it moves up */
  edge?: 'right' | 'left' | 'top' | 'bottom';
  onChange(v: number): void;
};

const clamp = (v: number, lo: number, hi: number) => Math.round(Math.min(hi, Math.max(lo, v)));

/**
 * The --gap strip on a panel's edge (brief §5): drag to resize, arrow keys ±10 (Shift ±40),
 * double-click resets. Place it inside a positioned parent.
 */
export function ResizeHandle({ value, min, max, reset, label, edge = 'right', onChange }: Props) {
  const dir = edge === 'left' || edge === 'top' ? -1 : 1;
  const rows = edge === 'top' || edge === 'bottom';
  const onPointerDown = (e: PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    e.preventDefault();
    const el = e.currentTarget;
    const x0 = rows ? e.clientY : e.clientX;
    el.setPointerCapture(e.pointerId);
    const move = (m: globalThis.PointerEvent) => onChange(clamp(value + dir * ((rows ? m.clientY : m.clientX) - x0), min, max));
    const end = () => {
      el.removeEventListener('pointermove', move);
      el.removeEventListener('pointerup', move);
      el.removeEventListener('lostpointercapture', end);
    };
    el.addEventListener('pointermove', move);
    // the release position too: the last move can be coalesced away
    el.addEventListener('pointerup', move);
    el.addEventListener('lostpointercapture', end);
  };

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const step = e.shiftKey ? 40 : 10;
    const less = rows ? 'ArrowUp' : 'ArrowLeft';
    const more = rows ? 'ArrowDown' : 'ArrowRight';
    const next = e.key === less ? value - dir * step : e.key === more ? value + dir * step : e.key === 'Home' ? min : e.key === 'End' ? max : null;
    if (next === null) return;
    e.preventDefault();
    onChange(clamp(next, min, max));
  };

  return (
    <div
      role="separator"
      aria-orientation={rows ? 'horizontal' : 'vertical'}
      aria-label={label}
      aria-valuenow={value}
      aria-valuemin={min}
      aria-valuemax={max}
      tabIndex={0}
      className={s[edge]}
      onPointerDown={onPointerDown}
      onDoubleClick={() => onChange(reset)}
      onKeyDown={onKeyDown}
    />
  );
}
