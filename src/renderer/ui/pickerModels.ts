import { useRef, useState } from 'react';
import { cmykEstimate, cssColor, rgb255, type Oklch } from '../../shared/color/index.ts';
import { canHold, hsbMove, hslMove, oklchMove, projectMove, resolve, type Hold, type Move } from '../../shared/color/hold.ts';
import { fromCmyk, fromHsb, fromHsl, fromRgb255, hsbOf, hslOf, maxChroma, sameColour, type Cmyk, type Hsb } from '../../shared/color/picker.ts';
import { holdValue, hsbHold } from '../../shared/color/value.ts';
import type { PickerModel } from '../../shared/types.ts';
import { useValueLock } from './PickerStyles.tsx';
import { axisAt } from './PickerPlane.tsx';

/** One number of a colour model: its field, its track, and what setting it does to the colour. */
export type Channel = {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  precision?: number;
  unit?: string;
  /** the track's range when it differs from the field's (chroma runs to the plane's axis) */
  span?: [number, number];
  /** fraction of the track where sRGB ends */
  limit?: number;
  /** its track's CSS background: this channel's colours with the others held */
  track(): string;
  /** a drag, an arrow or a scrub: with the value lock on, the colour keeps its value */
  set(v: number): void;
  /** a number typed into its field; differs from `set` only where the channel has no carrier of the value (RGB, ≈CMYK) */
  type?(v: number): void;
  /** the value lock's carrier (L, B, HSL L): moving it is the way to change the value, so its track doesn't drag */
  carrier?: boolean;
};

const stops = (n: number, at: (t: number) => Oklch) => Array.from({ length: n }, (_, i) => cssColor(at(i / (n - 1)))).join(', ');
const gradient = (space: 'srgb' | 'oklch', n: number, at: (t: number) => Oklch) => `linear-gradient(90deg in ${space}, ${stops(n, at)})`;
const put = <T extends number[]>(v: T, i: number, x: number) => v.map((y, j) => (j === i ? x : y)) as T;

/** label, max, unit, and the stops its track needs: the sRGB models are piecewise linear in sRGB */
type Spec = [label: string, max: number, unit: string | undefined, corners: number];
const HSB: Spec[] = [['H', 360, '°', 7], ['S', 100, '%', 2], ['B', 100, '%', 2]];
const HSL: Spec[] = [['H', 360, '°', 7], ['S', 100, '%', 2], ['L', 100, '%', 3]];
const RGB: Spec[] = [['R', 255, undefined, 2], ['G', 255, undefined, 2], ['B', 255, undefined, 2]];
const CMYK: Spec[] = [['C', 100, '%', 2], ['M', 100, '%', 2], ['Y', 100, '%', 2], ['K', 100, '%', 2]];

/** what the lock does to a model's tuple: `view` is the tuple a track stop shows, `carrier` the channel whose track stays plain */
type Lock<T> = { view(v: T): T; carrier?: number; type?(v: T): void };

function srgbChannels<T extends number[]>(v: T, set: (v: T) => void, make: (v: T) => Oklch, spec: Spec[], lock?: Lock<T>): Channel[] {
  return spec.map(([label, max, unit, corners], i) => {
    const held = lock && lock.carrier !== i;
    return {
      label,
      value: v[i],
      min: 0,
      max,
      step: 1,
      unit,
      // the lock bends the colours a track shows, so they are no longer piecewise linear
      track: () => gradient('srgb', held ? LOCKED_STOPS : corners, (t) => make(held ? lock.view(put(v, i, t * max)) : put(v, i, t * max))),
      set: (x) => set(put(v, i, x)),
      type: lock?.type && ((x) => lock.type!(put(v, i, x))),
      carrier: lock?.carrier === i,
    };
  });
}

const LOCKED_STOPS = 25;

type Held = { model: 'hsb' | 'hsl' | 'cmyk'; v: number[] };

/**
 * The colour in each model the pickers show. HSB, HSL and ≈CMYK don't survive a trip through the
 * colour (a grey has no hue, black no saturation, ≈CMYK no grey component), so what was last set in
 * one of them is held while it still is the colour (an undo can change a grey's hue and not its hex),
 * and the fields show what you set.
 *
 * With the value lock on, every move that isn't the value itself (hue, saturation, chroma, a drag or
 * an arrow or a typed H, S or C) is solved to the value the colour had when the lock first saw it;
 * `hold` remembers that value while the colour is the one the lock last made. Anything else that
 * lands on the colour (another swatch, an undo, a typed L, B or hex, the eyedropper) is a new colour
 * and the lock holds its value from then on.
 */
export function usePickerColour(value: Oklch, onChange: (o: Oklch) => void) {
  const [kept, setKept] = useState<Held | null>(null);
  const locked = useValueLock();
  const hold = useRef<Hold | null>(null);
  const [l, c, h] = value;
  // a hold with something to do: the colour near black or white has one value to give
  const lock = locked ? resolve(hold.current, value) : null;
  const on = lock && canHold(lock.target) ? lock : null;

  /** a colour the pickers made, with the hold it leaves (null: it was set outright) */
  const emit = (o: Oklch, next: Hold | null) => {
    hold.current = next;
    onChange(o);
  };
  /** the hold for a colour set outright: at black or white the lock holds nothing for the whole gesture, even once the drag has left it */
  const free = (o: Oklch) => (lock && !on ? { ...lock, last: o } : null);
  /** a gesture begins: a colour that had nothing to hold is looked at afresh */
  const begin = () => {
    if (hold.current && !canHold(hold.current.target)) hold.current = null;
  };

  function keep<T extends number[]>(
    model: Held['model'],
    read: (o: Oklch) => T,
    make: (v: T) => Oklch,
    move?: (hold: Hold, cur: T, next: T) => Move<T>,
  ) {
    const v = kept?.model === model && sameColour(make(kept.v as T), value) ? (kept.v as T) : read(value);
    const apply = (next: T, r: Move<T> | null) => {
      setKept({ model, v: r ? r.v : next });
      const o = r?.o ?? make(r ? r.v : next);
      emit(o, r ? r.hold : free(o));
    };
    const set = (next: T) => apply(next, on && move ? move(on, v, next) : null);
    const type = (next: T) => apply(next, null);
    return { v, set, type, make, view: (next: T) => (on && move ? move(on, v, next).v : next) };
  }
  const hsb = keep<Hsb>('hsb', hsbOf, fromHsb, hsbMove);
  const hsl = keep('hsl', hslOf, fromHsl, hslMove);
  const toCmyk = (k: Cmyk) => fromCmyk(k, h);
  const cmyk = keep<Cmyk>('cmyk', cmykEstimate, toCmyk, (hd, _cur, next) => {
    const m = projectMove(hd, toCmyk(next));
    return { v: cmykEstimate(m.v), o: m.v, hold: m.hold };
  });
  const rgb = (v: number[]) => fromRgb255(v as [number, number, number], h);

  /** a chroma or hue move on the OKLCH plane or its tracks */
  const slide = (next: Oklch) => {
    const m = on ? oklchMove(on, value, next) : null;
    emit(m ? m.v : next, m ? m.hold : free(next));
  };
  /** a colour typed or chosen outright */
  const retarget = (o: Oklch) => emit(o, free(o));

  function oklch(): Channel[] {
    const edge = on ? holdValue(on.target, 0.5, h)[1] : maxChroma(l, h, 'srgb');
    const axis = axisAt(h);
    const set = (i: number) => (x: number) => slide(put(value, i, x));
    return [
      // L reads 0-100, as the chips, the checks and their fixes name it ("Lift to L 59.6")
      {
        label: 'L',
        value: l * 100,
        min: 0,
        max: 100,
        step: 0.5,
        precision: 1,
        track: () => gradient('oklch', 21, (t) => [t, c, h]),
        set: (x) => retarget(put(value, 0, x / 100)),
        carrier: !!on,
      },
      {
        label: 'C',
        value: c,
        min: 0,
        max: 0.4,
        step: 0.001,
        span: [0, axis],
        limit: edge / axis,
        track: () => (on ? gradient('oklch', LOCKED_STOPS, (t) => holdValue(on.target, t * edge, h)) : gradient('oklch', 8, (t) => [l, t * edge, h])),
        set: set(1),
      },
      {
        label: 'H',
        value: h,
        min: 0,
        max: 360,
        step: 1,
        precision: 1,
        unit: '°',
        track: () => (on ? gradient('oklch', LOCKED_STOPS, (t) => holdValue(on.target, on.c, t * 360)) : gradient('oklch', 25, (t) => [l, c, t * 360])),
        set: set(2),
      },
    ];
  }

  const rgbChannels = () => {
    const set = (v: number[]) => {
      const m = on && projectMove(on, rgb(v));
      if (m) emit(m.v, m.hold);
      else retarget(rgb(v));
    };
    const lock: Lock<number[]> | undefined = on ? { view: (v) => rgb255(projectMove(on, rgb(v)).v), type: (v) => retarget(rgb(v)) } : undefined;
    return srgbChannels(rgb255(value), set, rgb, RGB, lock);
  };

  const channels = (model: PickerModel): Channel[] => {
    switch (model) {
      case 'hsb':
        return srgbChannels(hsb.v, hsb.set, hsb.make, HSB, on ? { view: hsb.view, carrier: 2 } : undefined);
      case 'hsl':
        return srgbChannels(hsl.v, hsl.set, hsl.make, HSL, on ? { view: hsl.view, carrier: 2 } : undefined);
      case 'rgb':
        return rgbChannels();
      case 'cmyk':
        return srgbChannels(cmyk.v, cmyk.set, cmyk.make, CMYK, on ? { view: cmyk.view, type: cmyk.type } : undefined);
      case 'oklch':
        return oklch();
    }
  };

  /** the Square's hue bar: each hue at the held value and the saturation last set */
  const hueTrack = () => (on ? gradient('srgb', LOCKED_STOPS, (t) => fromHsb([t * 360, ...hsbHold(on.target, t * 360, on.s)])) : null);

  /** the iso-value line over the saturation-by-brightness area, in its 0-100 box: from the grey at S 0 to where saturation runs out */
  const contour = () => {
    if (!on) return null;
    const hue = hsb.v[0];
    const top = hsbHold(on.target, hue, 100)[0];
    const pts = Array.from({ length: 25 }, (_, i) => {
      const s = (top * i) / 24;
      return `${s.toFixed(2)} ${(100 - hsbHold(on.target, hue, s)[1]).toFixed(2)}`;
    });
    return `M${pts.join('L')}`;
  };

  return {
    hsb: hsb.v,
    setHsb: hsb.set,
    channels,
    /** the value held, 0..1, when the lock has something to hold; null when it is off, or at black or white */
    target: on?.target ?? null,
    /** the lock is on (at black or white it holds nothing but the readout still shows) */
    locked,
    slide,
    retarget,
    begin,
    hueTrack,
    contour,
  };
}
