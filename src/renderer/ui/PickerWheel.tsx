import type { KeyboardEvent } from 'react';
import type { Hsb } from '../../shared/color/picker.ts';
import { useDrag } from './drag.ts';
import { arrow, focusThen, HUES, keyStep, Mark, SbArea, type HsbProps } from './PickerSquare.tsx';
import { roundTo } from './scrub.ts';
import s from './Picker.module.css';

const wrap = (h: number) => ((h % 360) + 360) % 360;

/** The Wheel style: the hue round a ring, red at the top and clockwise, the square inside (Krita, Clip Studio). */
export function PickerWheel({ hsb, onHsb, ...g }: HsbProps) {
  const [h, sat, b] = hsb;
  const drag = useDrag({
    onBegin: g.onBegin,
    // past the ring the pointer still steers: its angle from the centre, unclamped
    onMove({ free }) {
      const hue = roundTo(wrap((Math.atan2(free.x - 0.5, 0.5 - free.y) * 180) / Math.PI), 1);
      if (hue !== h) onHsb([hue, sat, b]);
    },
    onCommit: g.onCommit,
    onCancel: g.onCancel,
  });
  const onKeyDown = (e: KeyboardEvent) => {
    const d = arrow(e);
    if (!d) return;
    const next: Hsb = [wrap(Math.round(h) + d[0] + d[1]), sat, b];
    keyStep(g, () => onHsb(next));
  };

  return (
    <div className={s.wheel}>
      <div
        className={s.hueRing}
        style={{ backgroundImage: `conic-gradient(in srgb, ${HUES})` }}
        tabIndex={0}
        role="slider"
        aria-label="Hue"
        aria-valuemin={0}
        aria-valuemax={360}
        aria-valuenow={Math.round(h)}
        aria-valuetext={`Hue ${Math.round(h)}°`}
        {...drag.handlers}
        onPointerDown={focusThen(drag.handlers.onPointerDown)}
        onKeyDown={onKeyDown}
      />
      {/* the hole: a press between the ring and the square does nothing */}
      <i className={s.hole} />
      <SbArea hsb={hsb} onHsb={onHsb} className={s.wheelSb} {...g} />
      <Mark className={s.hueMark} style={{ transform: `rotate(${h}deg) translateY(calc((var(--ring) - var(--wheel)) / 2))` }} />
    </div>
  );
}
