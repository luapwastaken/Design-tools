import { useState } from 'react';
import { cmykEstimate, cssColor, rgb255, type Oklch } from '../../shared/color/index.ts';
import { fromCmyk, fromHsb, fromHsl, fromRgb255, hsbOf, hslOf, maxChroma, sameColour, type Cmyk, type Hsb } from '../../shared/color/picker.ts';
import type { PickerModel } from '../../shared/types.ts';
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
  set(v: number): void;
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

function srgbChannels<T extends number[]>(v: T, set: (v: T) => void, make: (v: T) => Oklch, spec: Spec[]): Channel[] {
  return spec.map(([label, max, unit, corners], i) => ({
    label,
    value: v[i],
    min: 0,
    max,
    step: 1,
    unit,
    track: () => gradient('srgb', corners, (t) => make(put(v, i, t * max))),
    set: (x) => set(put(v, i, x)),
  }));
}

type Held = { model: 'hsb' | 'hsl' | 'cmyk'; v: number[] };

/**
 * The colour in each model the pickers show. HSB, HSL and ≈CMYK don't survive a trip through the
 * colour (a grey has no hue, black no saturation, ≈CMYK no grey component), so what was last set in
 * one of them is held while it still is the colour (an undo can change a grey's hue and not its hex),
 * and the fields show what you set.
 */
export function usePickerColour(value: Oklch, onChange: (o: Oklch) => void) {
  const [held, setHeld] = useState<Held | null>(null);
  const [l, c, h] = value;

  function keep<T extends number[]>(model: Held['model'], read: (o: Oklch) => T, make: (v: T) => Oklch) {
    const v = held?.model === model && sameColour(make(held.v as T), value) ? (held.v as T) : read(value);
    const set = (next: T) => {
      setHeld({ model, v: next });
      onChange(make(next));
    };
    return [v, set, make] as const;
  }
  const hsb = keep<Hsb>('hsb', hsbOf, fromHsb);
  const hsl = keep('hsl', hslOf, fromHsl);
  const cmyk = keep<Cmyk>('cmyk', cmykEstimate, (k) => fromCmyk(k, h));
  const rgb = (v: number[]) => fromRgb255(v as [number, number, number], h);

  function oklch(): Channel[] {
    const edge = maxChroma(l, h, 'srgb');
    const axis = axisAt(h);
    const set = (i: number) => (x: number) => onChange(put(value, i, x));
    return [
      // L reads 0-100, as the chips, the checks and their fixes name it ("Lift to L 59.6")
      { label: 'L', value: l * 100, min: 0, max: 100, step: 0.5, precision: 1, track: () => gradient('oklch', 21, (t) => [t, c, h]), set: (x) => set(0)(x / 100) },
      {
        label: 'C',
        value: c,
        min: 0,
        max: 0.4,
        step: 0.001,
        span: [0, axis],
        limit: edge / axis,
        track: () => gradient('oklch', 8, (t) => [l, t * edge, h]),
        set: set(1),
      },
      { label: 'H', value: h, min: 0, max: 360, step: 1, precision: 1, unit: '°', track: () => gradient('oklch', 25, (t) => [l, c, t * 360]), set: set(2) },
    ];
  }

  const channels = (model: PickerModel): Channel[] => {
    switch (model) {
      case 'hsb':
        return srgbChannels(hsb[0], hsb[1], hsb[2], HSB);
      case 'hsl':
        return srgbChannels(hsl[0], hsl[1], hsl[2], HSL);
      case 'rgb':
        return srgbChannels(rgb255(value), (v) => onChange(rgb(v)), rgb, RGB);
      case 'cmyk':
        return srgbChannels(cmyk[0], cmyk[1], cmyk[2], CMYK);
      case 'oklch':
        return oklch();
    }
  };

  return { hsb: hsb[0], setHsb: hsb[1], channels };
}
