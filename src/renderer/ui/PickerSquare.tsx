import type { CSSProperties, KeyboardEvent, PointerEvent } from 'react';
import { cssColor } from '../../shared/color/index.ts';
import { fromHsb, type Hsb } from '../../shared/color/picker.ts';
import { cx } from './cx.ts';
import { useDrag } from './drag.ts';
import type { Gesture } from './Picker.tsx';
import { PickerChannel } from './PickerChannel.tsx';
import { clamp, roundTo } from './scrub.ts';
import s from './Picker.module.css';

// Square: saturation across, brightness up, the hue bar below, as in Photoshop, Figma and Affinity.
// The square is two sRGB gradients multiplied, which is HSB exactly: white to the pure hue across,
// times black to white up.

const WHITE = cssColor([1, 0, 0]);
const BLACK = cssColor([0, 0, 0]);
const pure = (h: number) => cssColor(fromHsb([h, 100, 100]));
/** the pure hues 60° apart: between them the hue runs linearly in sRGB */
export const HUES = [0, 60, 120, 180, 240, 300, 360].map(pure).join(', ');

export type HsbProps = { hsb: Hsb; onHsb(v: Hsb): void } & Gesture;

/** the ring marking a place on a colour area */
export function Mark({ className, style }: { className?: string; style: CSSProperties }) {
  return (
    <svg className={cx(s.dot, className)} style={style} viewBox="-10 -10 20 20" aria-hidden="true">
      <circle className={s.halo} r="7" />
      <circle className={s.mark} r="7" />
    </svg>
  );
}

const ARROWS: Record<string, [number, number]> = { ArrowRight: [1, 0], ArrowLeft: [-1, 0], ArrowUp: [0, 1], ArrowDown: [0, -1] };

/** An arrow key as a step across and up (Shift ×10), taken from the page; null for other keys. */
export function arrow(e: KeyboardEvent): [number, number] | null {
  const d = ARROWS[e.key];
  if (!d) return null;
  e.preventDefault();
  const k = e.shiftKey ? 10 : 1;
  return [d[0] * k, d[1] * k];
}

/** a key press is its own step, which may coalesce with the one before (like a NumberField's arrows) */
export function keyStep(g: Gesture, change: () => void) {
  g.onBegin?.();
  change();
  g.onCommit?.(true);
}

/** focus on press, so the arrows work next */
export const focusThen = (down: (e: PointerEvent<HTMLElement>) => void) => (e: PointerEvent<HTMLElement>) => {
  e.currentTarget.focus({ preventScroll: true });
  down(e);
};

/** The saturation-by-brightness area at the hue (the Square's, and the one inside the Wheel). */
export function SbArea({ hsb, onHsb, className, ...g }: HsbProps & { className?: string }) {
  const [h, sat, b] = hsb;
  const drag = useDrag({
    onBegin: g.onBegin,
    onMove({ x, y }) {
      const next: Hsb = [h, roundTo(x * 100, 1), roundTo((1 - y) * 100, 1)];
      if (next[1] !== sat || next[2] !== b) onHsb(next);
    },
    onCommit: g.onCommit,
    onCancel: g.onCancel,
  });
  const onKeyDown = (e: KeyboardEvent) => {
    const d = arrow(e);
    if (!d) return;
    const next: Hsb = [h, clamp(Math.round(sat) + d[0], 0, 100), clamp(Math.round(b) + d[1], 0, 100)];
    if (next[1] !== sat || next[2] !== b) keyStep(g, () => onHsb(next));
  };

  return (
    <div
      className={cx(s.sb, className)}
      style={{ backgroundImage: `linear-gradient(0deg in srgb, ${BLACK}, ${WHITE}), linear-gradient(90deg in srgb, ${WHITE}, ${pure(h)})` }}
      data-plane=""
      tabIndex={0}
      role="slider"
      aria-label="Saturation and brightness"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round(sat)}
      aria-valuetext={`Saturation ${Math.round(sat)}%, brightness ${Math.round(b)}%`}
      {...drag.handlers}
      onPointerDown={focusThen(drag.handlers.onPointerDown)}
      onKeyDown={onKeyDown}
    >
      <Mark style={{ left: `${sat}%`, top: `${100 - b}%` }} />
    </div>
  );
}

/** The Square style: the area, then the hue bar (its value is typed in the number row below). */
export function PickerSquare({ hsb, onHsb, ...g }: HsbProps) {
  const [h, sat, b] = hsb;
  return (
    <>
      <SbArea hsb={hsb} onHsb={onHsb} {...g} />
      <PickerChannel
        bare
        label="H"
        value={h}
        min={0}
        max={360}
        step={1}
        track={`linear-gradient(90deg in srgb, ${HUES})`}
        className={s.hueBar}
        {...g}
        onChange={(x) => onHsb([x, sat, b])}
      />
    </>
  );
}
