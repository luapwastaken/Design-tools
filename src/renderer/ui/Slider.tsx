import { useEffect, useRef, useState, type PointerEvent } from 'react';
import { cx } from './cx.ts';
import { InfoTip } from './InfoTip.tsx';
import { NumberField } from './NumberField.tsx';
import { clamp, decimalsOf, roundTo, useScrub, type NumberGesture } from './scrub.ts';
import { Ticks } from './Ticks.tsx';
import s from './Slider.module.css';

export type SliderProps = {
  label: string;
  /** one sentence of help: an (i) after the label shows it in a tooltip */
  info?: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  unit?: string;
  precision?: number;
  disabled?: boolean;
  className?: string;
  /** width of the number field; default 88 */
  fieldWidth?: number;
  /** where the fill starts: 0 for a signed value (an angle, a gap), so it reads as a direction and a size; default min */
  origin?: number;
} & NumberGesture;

/**
 * A row: the label (a scrub handle), the track, and its NumberField (hard rule 5: a slider never
 * ships alone). Dragging the track is one gesture; Esc cancels it.
 */
export function Slider(p: SliderProps) {
  const { label, value, min, max, step = 1, unit, disabled, className, fieldWidth = 88 } = p;
  const precision = p.precision ?? decimalsOf(step);
  const field = useRef<HTMLInputElement>(null);
  const scrub = useScrub({ ...p, step, precision, onClick: () => field.current?.focus() });
  const live = useRef(p);
  live.current = p;
  const drag = useRef<{ id: number; last: number; onKey(e: KeyboardEvent): void } | null>(null);
  const [tracking, setTracking] = useState(false);

  const fromX = (e: PointerEvent<HTMLElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    const v = min + clamp((e.clientX - r.left) / r.width, 0, 1) * (max - min);
    return clamp(roundTo(min + Math.round((v - min) / step) * step, precision), min, max);
  };
  const move = (e: PointerEvent<HTMLElement>) => {
    const d = drag.current;
    if (!d || d.id !== e.pointerId) return;
    const v = fromX(e);
    if (v !== d.last) live.current.onChange((d.last = v));
  };
  const end = (commit: boolean) => {
    const d = drag.current;
    drag.current = null;
    if (!d) return;
    removeEventListener('keydown', d.onKey, true);
    setTracking(false);
    if (commit) live.current.onCommit?.();
    else live.current.onCancel?.();
  };

  // unmounting mid-drag commits what's there rather than leaving a gesture (and its Esc) open
  useEffect(() => () => end(true), []);

  const fracOf = (v: number) => (max > min ? clamp((v - min) / (max - min), 0, 1) : 0);
  const frac = fracOf(value);
  const from = fracOf(p.origin ?? min);
  const pct = `${frac * 100}%`;

  return (
    <div className={cx(s.row, disabled && s.off, className)}>
      <span className={s.cell}>
        <span className={cx(s.label, scrub.active && s.scrubbing)} aria-hidden="true" {...scrub.handlers}>
          {label}
        </span>
        {p.info && <InfoTip text={p.info} />}
      </span>
      <div
        className={s.track}
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
          drag.current = { id: e.pointerId, last: value, onKey };
          addEventListener('keydown', onKey, true);
          setTracking(true);
          p.onBegin?.();
          move(e);
        }}
        onPointerMove={move}
        onPointerUp={() => end(true)}
        onLostPointerCapture={() => end(true)}
      >
        <i className={s.bar} />
        <i className={s.fill} style={{ left: `${Math.min(from, frac) * 100}%`, width: `${Math.abs(frac - from) * 100}%` }} />
        <i className={s.needle} style={{ left: pct }} />
        <Ticks />
      </div>
      <NumberField {...p} ref={field} step={step} precision={precision} hideLabel width={fieldWidth} className={s.field} dragging={tracking || scrub.active} />
    </div>
  );
}
