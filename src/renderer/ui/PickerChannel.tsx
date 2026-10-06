import { useLayoutEffect, useMemo, useRef, type ReactNode } from 'react';
import type { StripArt } from '../../shared/color/plane.ts';
import { cx } from './cx.ts';
import { useDrag } from './drag.ts';
import { NumberField } from './NumberField.tsx';
import { clamp, decimalsOf, roundTo, type NumberGesture } from './scrub.ts';
import { Ticks } from './Ticks.tsx';
import { Tooltip } from './Tooltip.tsx';
import { useSize } from './useSize.ts';
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
  /** the value of the end of sRGB: a drag that comes within 4px of it lands on it (Alt skips this) */
  snap?: number;
  /** the track painted as a one-row canvas, `w` device pixels wide: the colours where sRGB has them, a tick where a run ends (`track` is then unused). `paintKey` names what it depends on */
  paint?(w: number): StripArt;
  paintKey?: string;
  /** a hint on the track (the H strip's floor chroma) */
  note?: string;
  /** a circular value (hue): typed and arrow values wrap round */
  wrap?: boolean;
  /** a Value or Hue lock: the track doesn't drag; the field still takes typing */
  locked?: boolean;
  /** what a number typed into the field does, where it differs from a drag */
  onType?(v: number): void;
  /** between the track and the field: a lock button, or a blank keeping the rows aligned */
  aside?: ReactNode;
  /** the track alone: its value is typed elsewhere (the Square's hue bar, in the number row) */
  bare?: boolean;
  className?: string;
} & NumberGesture;

/** One picker channel: a colour track with a needle, and its NumberField (hard rule 5). */
export function PickerChannel(p: PickerChannelProps) {
  const { label, value, min, max, step, unit, track, limit, snap, paint, paintKey, note, wrap, locked, aside, bare, className } = p;
  const [lo, hi] = p.span ?? [min, max];
  const precision = p.precision ?? decimalsOf(step);
  const live = useRef(p);
  live.current = p;

  const grad = useRef<HTMLElement>(null);
  const size = useSize(grad);
  const dpr = Math.ceil(devicePixelRatio || 1);
  const strip = useMemo(() => (size && size.w > 0 ? paint?.(size.w * dpr) : null), [paintKey, size?.w, dpr]);
  const canvas = useRef<HTMLCanvasElement>(null);
  useLayoutEffect(() => {
    if (strip) canvas.current?.getContext('2d')!.putImageData(new ImageData(strip.px, strip.px.length / 4, 1), 0, 0);
  }, [strip]);

  const drag = useDrag({
    disabled: locked,
    onBegin: () => live.current.onBegin?.(),
    onMove({ x, alt }) {
      let v = clamp(roundTo(lo + Math.round((x * (hi - lo)) / step) * step, precision), min, max);
      // near the end of sRGB the needle lands on it, just inside (Alt drags free)
      if (snap !== undefined && !alt && size && Math.abs(x - (snap - lo) / (hi - lo)) * size.w < 4) v = Math.min(max, Math.floor(snap * 1e4) / 1e4);
      if (v !== live.current.value) live.current.onChange(v);
    },
    onCommit: () => live.current.onCommit?.(),
    onCancel: () => live.current.onCancel?.(),
  });

  const at = hi > lo ? clamp((value - lo) / (hi - lo), 0, 1) : 0;
  const fit = limit === undefined ? undefined : `${limit * 100}% 100%`;
  const trk = (
    <div className={cx(s.trk, locked && s.locked, bare && className)} data-track={label} {...drag.handlers}>
      <i ref={grad} className={cx(s.grad, paint && s.painted)} data-colour="" style={paint ? undefined : { backgroundImage: track, backgroundSize: fit }}>
        {strip && <canvas ref={canvas} width={strip.px.length / 4} height={1} />}
      </i>
      {limit !== undefined && <i className={s.lim} style={{ left: `${limit * 100}%` }} />}
      {strip?.ends.map((e) => <i key={e} className={s.lim} style={{ left: `${e * 100}%` }} />)}
      <i className={s.ndl} style={{ left: `${at * 100}%` }} />
      <Ticks className={s.tk} />
    </div>
  );
  // always wrapped, so a hint coming and going doesn't remount the track (and lose what is observing its size)
  const tracked = (
    <Tooltip content={note} disabled={!note}>
      {trk}
    </Tooltip>
  );
  if (bare) return tracked;

  return (
    <div className={cx(s.chan, className)} data-aside={aside === undefined ? undefined : ''}>
      {tracked}
      {aside}
      <NumberField
        label={label}
        value={value}
        min={min}
        max={max}
        step={step}
        precision={precision}
        unit={unit}
        width={92}
        wrap={wrap}
        dragging={drag.active}
        onBegin={p.onBegin}
        onChange={p.onType ?? p.onChange}
        onCommit={p.onCommit}
        onCancel={p.onCancel}
      />
    </div>
  );
}
