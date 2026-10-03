import { useEffect, useRef, useState, type PointerEvent } from 'react';

// Dragging a value: a NumberField's label, a Slider's label. One step per 2px, Shift ×10,
// Alt ×0.1 (brief §6). The gesture begins only once the pointer has moved, so a plain click
// stays a click.

export type NumberGesture = {
  onBegin?(): void;
  onChange(v: number): void;
  /** `fromKey`: an arrow-key step, which may coalesce with the one before (spec §8) */
  onCommit?(fromKey?: boolean): void;
  onCancel?(): void;
};

export type Range = { min: number; max: number; step: number; precision: number };

export const clamp = (v: number, min: number, max: number) => Math.min(Math.max(v, min), max);
export const roundTo = (v: number, precision: number) => {
  const f = 10 ** precision;
  return Math.round(v * f) / f || 0; // no -0
};
export const decimalsOf = (step: number) => (String(step).split('.')[1] ?? '').length;

const PX_PER_STEP = 2;
const SLOP = 3;

type Drag = { id: number; x: number; start: number; acc: number; last: number; moved: boolean; el: Element };

export function useScrub(o: Range & NumberGesture & { value: number; disabled?: boolean; onClick?(): void }) {
  const [active, setActive] = useState(false);
  const drag = useRef<Drag | null>(null);
  const opts = useRef(o);
  opts.current = o;

  const end = (commit: boolean) => {
    const d = drag.current;
    drag.current = null;
    if (!d) return;
    if (d.el.hasPointerCapture(d.id)) d.el.releasePointerCapture(d.id);
    if (!d.moved) {
      if (commit) opts.current.onClick?.();
      return;
    }
    setActive(false);
    delete document.documentElement.dataset.scrub;
    if (commit) opts.current.onCommit?.();
    else opts.current.onCancel?.();
  };

  useEffect(() => {
    if (!active) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      e.preventDefault();
      e.stopPropagation();
      end(false);
    };
    addEventListener('keydown', onKey, true);
    return () => removeEventListener('keydown', onKey, true);
  }, [active]);

  // unmounting mid-drag commits what's there rather than leaving a gesture open
  useEffect(() => () => end(true), []);

  return {
    active,
    handlers: {
      onPointerDown(e: PointerEvent<Element>) {
        if (opts.current.disabled || e.button !== 0 || drag.current) return;
        e.preventDefault(); // keep focus where it is, no text selection
        e.currentTarget.setPointerCapture(e.pointerId);
        const v = opts.current.value;
        drag.current = { id: e.pointerId, x: e.clientX, start: v, acc: 0, last: v, moved: false, el: e.currentTarget };
      },
      onPointerMove(e: PointerEvent<Element>) {
        const d = drag.current;
        if (!d || e.pointerId !== d.id) return;
        const dx = e.clientX - d.x;
        if (!d.moved) {
          if (Math.abs(dx) < SLOP) return;
          d.moved = true;
          d.x = e.clientX;
          setActive(true);
          document.documentElement.dataset.scrub = '';
          opts.current.onBegin?.();
          return;
        }
        d.x = e.clientX;
        const { min, max, step, precision } = opts.current;
        const mult = e.shiftKey ? 10 : e.altKey ? 0.1 : 1;
        // clamp the running total so turning back at a limit responds at once
        d.acc = clamp(d.start + d.acc + (dx / PX_PER_STEP) * step * mult, min, max) - d.start;
        const next = roundTo(d.start + d.acc, precision);
        if (next !== d.last) {
          d.last = next;
          opts.current.onChange(next);
        }
      },
      onPointerUp: () => end(true),
      onLostPointerCapture: () => end(true),
    },
  };
}
