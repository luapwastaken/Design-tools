import type { KeyboardEvent } from 'react';
import { useDrag } from './drag.ts';
import { HUES } from './pickerModels.ts';
import { useHueLock } from './PickerStyles.tsx';
import { arrow, focusThen, keyStep, Mark, PickerArea, type AreaProps } from './PickerSquare.tsx';
import { roundTo } from './scrub.ts';
import s from './Picker.module.css';

const wrap = (h: number) => ((h % 360) + 360) % 360;

/**
 * The Wheel style: the hue round a ring, red at the top and clockwise, the square inside (Krita, Clip Studio).
 * The square follows the model for HSB and HSL; RGB, ≈CMYK and OKLCH have no hue ring to match, so they keep HSB's.
 */
export function PickerWheel({ area, ...g }: AreaProps) {
  const { h, set } = area.ring!;
  const hueHeld = useHueLock();
  const drag = useDrag({
    disabled: hueHeld,
    onBegin: g.onBegin,
    // past the ring the pointer still steers: its angle from the centre, unclamped
    onMove({ free }) {
      const hue = roundTo(wrap((Math.atan2(free.x - 0.5, 0.5 - free.y) * 180) / Math.PI), 1);
      if (hue !== h) set(hue);
    },
    onCommit: g.onCommit,
    onCancel: g.onCancel,
  });
  const onKeyDown = (e: KeyboardEvent) => {
    const d = arrow(e);
    if (!d || hueHeld) return;
    const next = wrap(Math.round(h) + d[0] + d[1]);
    keyStep(g, () => set(next));
  };

  return (
    <div className={s.wheel}>
      <div
        className={s.hueRing}
        style={{ backgroundImage: `conic-gradient(in srgb, ${HUES})` }}
        data-lock={hueHeld ? '' : undefined}
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
      <PickerArea area={area} className={s.wheelSb} {...g} />
      <Mark className={s.hueMark} style={{ transform: `rotate(${h}deg) translateY(calc((var(--ring) - var(--wheel)) / 2))` }} />
    </div>
  );
}
