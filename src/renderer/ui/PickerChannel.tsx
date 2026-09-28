import { useRef } from 'react';
import { cx } from './cx.ts';
import { useDrag } from './drag.ts';
import { NumberField } from './NumberField.tsx';
import { clamp, decimalsOf, roundTo, type NumberGesture } from './scrub.ts';
import { Ticks } from './Ticks.tsx';
import s from './Picker.module.css';

export type PickerChannelProps = {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  precision?: number;
  unit?: string;
  /** the track's CSS background-image: this channel's colours with the others held */
  track: string;
  /** the track's range when it differs from the field's (chroma runs to the plane's axis) */
  span?: [number, number];
  /** fraction of the track where sRGB ends: the colours stop there, marked by a line */
  limit?: number;
  /** a Value or Hue lock: the track doesn't drag; the field still takes typing */
  locked?: boolean;
} & NumberGesture;

/** One picker channel: a colour track with a needle, and its NumberField (hard rule 5). */
export function PickerChannel(p: PickerChannelProps) {
  const { label, value, min, max, step, unit, track, limit, locked } = p;
  const [lo, hi] = p.span ?? [min, max];
  const precision = p.precision ?? decimalsOf(step);
  const live = useRef(p);
  live.current = p;

  const drag = useDrag({
    disabled: locked,
    onBegin: () => live.current.onBegin?.(),
    onMove({ x }) {
      const v = clamp(roundTo(lo + Math.round((x * (hi - lo)) / step) * step, precision), min, max);
      if (v !== live.current.value) live.current.onChange(v);
    },
    onCommit: () => live.current.onCommit?.(),
    onCancel: () => live.current.onCancel?.(),
  });

  const at = hi > lo ? clamp((value - lo) / (hi - lo), 0, 1) : 0;
  const size = limit === undefined ? undefined : `${limit * 100}% 100%`;

  return (
    <div className={s.chan}>
      <div className={cx(s.trk, locked && s.locked)} {...drag.handlers}>
        <i className={s.grad} style={{ backgroundImage: track, backgroundSize: size }} />
        {limit !== undefined && <i className={s.lim} style={{ left: `${limit * 100}%` }} />}
        <i className={s.ndl} style={{ left: `${at * 100}%` }} />
        <Ticks className={s.tk} />
      </div>
      <NumberField
        label={label}
        value={value}
        min={min}
        max={max}
        step={step}
        precision={precision}
        unit={unit}
        width={92}
        dragging={drag.active}
        onBegin={p.onBegin}
        onChange={p.onChange}
        onCommit={p.onCommit}
        onCancel={p.onCancel}
      />
    </div>
  );
}
