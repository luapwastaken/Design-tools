import { useRef, useState } from 'react';
import { cmykEstimate, cssColor, rgb255, type Oklch } from '../../shared/color/index.ts';
import { canHold, capture, hsbMove, hslMove, oklchMove, projectMove, resolve, type Hold, type Move } from '../../shared/color/hold.ts';
import { hslLine, rgbLine, rgbOnLine } from '../../shared/color/area.ts';
import { fromCmyk, fromHsb, fromHsl, fromRgb255, hsbOf, hslOf, maxChroma, sameColour, type Cmyk, type Hsb } from '../../shared/color/picker.ts';
import { GREY_STRIP, FLOOR, hStrip, lStrip, planeColour, planePoint, type StripArt } from '../../shared/color/plane.ts';
import { holdValue, hsbHold } from '../../shared/color/value.ts';
import type { PickerModel } from '../../shared/types.ts';
import { useValueLock } from './PickerStyles.tsx';
import { axisAt, lcContour, planeHue } from './PickerPlane.tsx';
import { clamp, roundTo } from './scrub.ts';
import { toast } from './toast.ts';

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
  /** the value of the end of sRGB: the needle lands on it when dragged near */
  snap?: number;
  /** the track painted as a canvas that shows where sRGB ends (L and H), named by `paintKey`; `track()` is then ''. */
  paint?(w: number): StripArt;
  paintKey?: string;
  note?: string;
  /** a circular value: typed and arrow values wrap round (hue) */
  wrap?: boolean;
  /** its track's CSS background: this channel's colours with the others held */
  track(): string;
  /** a drag, an arrow or a scrub: with the value lock on, the colour keeps its value */
  set(v: number): void;
  /** a number typed into its field; differs from `set` only where the channel has no carrier of the value (RGB, ≈CMYK) */
  type?(v: number): void;
  /** the value hold's carrier (L, B, HSL L): its track doesn't drag (VALUE_HELD says why); the way to change the value is the Value field or its own number */
  carrier?: boolean;
};

/** the pure hues 60° apart: between them the hue runs linearly in sRGB */
const pure = (h: number) => cssColor(fromHsb([h, 100, 100]));
export const HUES = [0, 60, 120, 180, 240, 300, 360].map(pure).join(', ');
const WHITE = cssColor([1, 0, 0]);
const BLACK = cssColor([0, 0, 0]);
/** an sRGB colour (0-255 each) as CSS */
const srgb = (r: number, g: number, b: number) => cssColor(fromRgb255([r, g, b], 0));

/**
 * One area of the Square (the Wheel's inner square too), as Photoshop's picker has one per model: the
 * area shows two components of the model, `bar` the third. Positions are 0..1, y up.
 */
export type Area = {
  kind: 'hsb' | 'hsl' | 'rgb' | 'oklch';
  name: string;
  text: string;
  /** the number aria-valuenow carries */
  now: number;
  /** the area's CSS backgrounds and how they blend; null where the area is a canvas (OKLCH's plane, drawn at `hue`) */
  paint: { image: string; blend: string } | null;
  hue: number;
  /** where the colour is */
  u: number;
  v: number;
  /** the value lock's iso-value line in a 0-100 box: null with the lock off (or where there is none) */
  contour: string | null;
  /** the pointer at (x, y); with the lock on, the move rides the iso-value line */
  move(x: number, y: number): void;
  /** an arrow (a step across and up): the change it makes, or null when it changes nothing */
  key(dx: number, dy: number): (() => void) | null;
  /** the third component: the hue, red for RGB */
  bar: Channel;
  /** the Wheel's ring: the hue, for the models whose third component it is */
  ring: { h: number; set(h: number): void } | null;
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
      wrap: label === 'H',
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

  /** a chroma or hue move on the OKLCH plane or its tracks; the colour it made */
  const slide = (next: Oklch): Oklch => {
    const m = on ? oklchMove(on, value, next) : null;
    emit(m ? m.v : next, m ? m.hold : free(next));
    return m ? m.v : next;
  };
  /**
   * The colour's value set outright (0..1), at its hue and the chroma last asked of it (which gives
   * way where sRGB runs out): the Value field and Match. With the lock on, that value is the one held.
   */
  const setValue = (t: number) => {
    const o = holdValue(t, on ? on.c : c, h);
    emit(o, locked ? { ...(on ?? capture(o)), target: t, last: o } : null);
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
        // where sRGB has no colour at this chroma the strip is clear, with a tick at each end
        track: () => '',
        paint: (w) => lStrip(c, h, w),
        paintKey: `L|${c.toFixed(4)}|${h.toFixed(3)}`,
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
        snap: edge,
        track: () => (on ? gradient('oklch', LOCKED_STOPS, (t) => holdValue(on.target, t * edge, h)) : gradient('oklch', 8, (t) => [l, t * edge, h])),
        set: set(1),
        // typed past what sRGB has at the held value, chroma stops there: say so
        type: (x) => {
          const made = slide(put(value, 1, x));
          if (on && made[1] < x - 1e-3) toast.show({ icon: 'info', message: `Capped at ${made[1].toFixed(3)}, the most sRGB has at this value` });
        },
      },
      {
        label: 'H',
        value: h,
        min: 0,
        max: 360,
        step: 1,
        precision: 1,
        unit: '°',
        // held to a value every hue has a colour (chroma gives way): the strip is that; otherwise it is clear where sRGB has none
        track: () => (on ? gradient('oklch', LOCKED_STOPS, (t) => holdValue(on.target, on.c, t * 360)) : ''),
        ...(on ? {} : { paint: (w: number) => hStrip(l, c, w), paintKey: `H|${l.toFixed(4)}|${c.toFixed(4)}` }),
        note: !on && c < GREY_STRIP ? `Shown at chroma ${FLOOR.toFixed(2)}: this colour is too grey for its hue to show` : undefined,
        wrap: true,
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

  /** the path through points of the 0-100 box (y up) */
  const path = (pts: [number, number][]) => `M${pts.map(([x, y]) => `${x.toFixed(2)} ${(100 - y).toFixed(2)}`).join('L')}`;
  /** the hue bar: every hue at full saturation (at the held value with the lock on) */
  const hueBar = (ch: Channel): Channel => (on ? ch : { ...ch, track: () => `linear-gradient(90deg in srgb, ${HUES})` });

  /** HSB's and HSL's areas: saturation across, the third component up, the hue on the bar. Held to a value, x picks saturation and the third follows the iso-value line. */
  function satArea(kind: 'hsb' | 'hsl', third: string, paint: Area['paint'], line: (hue: number) => [number, number][]): Area {
    const k = kind === 'hsb' ? hsb : hsl;
    const [hu, sat, up] = k.v;
    const to = (s: number, t: number) => (s !== sat || t !== up) && k.set([hu, s, t]);
    return {
      kind,
      name: `Saturation and ${third}`,
      text: `Saturation ${Math.round(sat)}%, ${third} ${Math.round(up)}%`,
      now: Math.round(sat),
      paint,
      hue: hu,
      u: sat / 100,
      v: up / 100,
      contour: on ? path(line(hu)) : null,
      move: (x, y) => void to(roundTo(x * 100, 1), on ? up : roundTo(y * 100, 1)),
      // held to a value, Up and Down change it (they move the third); Left and Right leave it to the line
      key(dx, dy) {
        const s = clamp(Math.round(sat) + dx, 0, 100);
        const t = on && !dy ? up : clamp(Math.round(up) + dy, 0, 100);
        return s !== sat || t !== up ? () => void to(s, t) : null;
      },
      bar: hueBar(channels(kind)[0]),
      ring: { h: hu, set: (x) => k.set([x, sat, up]) },
    };
  }
  const hsbArea = () =>
    satArea('hsb', 'brightness', { image: `linear-gradient(0deg in srgb, ${BLACK}, ${WHITE}), linear-gradient(90deg in srgb, ${WHITE}, ${pure(hsb.v[0])})`, blend: 'multiply' }, (hue) => {
      const top = hsbHold(on!.target, hue, 100)[0];
      return Array.from({ length: 25 }, (_, i) => [(top * i) / 24, hsbHold(on!.target, hue, (top * i) / 24)[1]]);
    });
  // HSL: a grey-to-hue ramp across (the grey at S 0, the hue at S 100) under white at the top fading out at the middle and black at the bottom, which is HSL exactly
  const hslArea = () =>
    satArea(
      'hsl',
      'lightness',
      { image: `linear-gradient(180deg in srgb, ${WHITE}, transparent 50%, transparent 50%, ${BLACK}), linear-gradient(90deg in srgb, ${srgb(128, 128, 128)}, ${pure(hsl.v[0])})`, blend: 'normal' },
      (hue) => hslLine(on!.target, hue),
    );

  /** RGB's area at the red on the bar: blue across, green up; the two ramps screen to the four corners' bilinear blend exactly */
  function rgbArea(): Area {
    const [r, g, b] = rgb255(value);
    const line = on && rgbLine(on.target, r);
    // held to a value the pointer rides that value's straight line: blue from the pointer, green solved
    const ride = (c: number[]) => {
      const o = rgb(c);
      emit(o, { ...on!, last: o });
    };
    return {
      kind: 'rgb',
      name: 'Blue and green',
      text: `Blue ${b}, green ${g}`,
      now: b,
      paint: { image: `linear-gradient(0deg in srgb, ${BLACK}, ${srgb(0, 255, 0)}), linear-gradient(90deg in srgb, ${srgb(r, 0, 0)}, ${srgb(r, 0, 255)})`, blend: 'screen' },
      hue: h,
      u: b / 255,
      v: g / 255,
      contour: line ? path(line.map(([x, y]) => [x * 100, y * 100])) : null,
      move(x, y) {
        const c = on ? rgbOnLine(on.target, r, x) : [r, Math.round(y * 255), Math.round(x * 255)];
        if (!c || (c[1] === g && c[2] === b)) return;
        if (on) ride(c);
        else retarget(rgb(c));
      },
      // held to a value, Up and Down change it (green); Left and Right slide blue along the line
      key(dx, dy) {
        const next = on && !dy ? rgbOnLine(on.target, r, (b + dx) / 255) : [r, clamp(g + dy, 0, 255), clamp(b + dx, 0, 255)];
        if (!next || (next[1] === g && next[2] === b)) return null;
        return () => (on && !dy ? ride(next) : retarget(rgb(next)));
      },
      bar: channels('rgb')[0],
      ring: null,
    };
  }

  /** the OKLCH model's area: lightness by chroma at the hue, with the plane's gamut edges; hue on the bar. L carries the value, so held, the pointer's y has no say. */
  function oklchArea(): Area {
    const axis = axisAt(h);
    const [u, v] = planePoint('lc', value, axis);
    const to = (next: Oklch, held: boolean) => (next[0] !== l || next[1] !== c) && (held ? slide(next) : retarget(next));
    return {
      kind: 'oklch',
      name: 'Chroma and lightness',
      text: `L ${(l * 100).toFixed(1)}, C ${c.toFixed(3)}`,
      now: Math.round(l * 100),
      paint: null,
      hue: planeHue(h),
      u: clamp(u, 0, 1),
      v: clamp(v, 0, 1),
      contour: on ? lcContour(on.target, planeHue(h), 100, 100, axis) : null,
      move(x, y) {
        const at = planeColour('lc', x, y, value, axis);
        void to([on ? l : roundTo(at[0], 3), roundTo(at[1], 3), h], !!on);
      },
      key(dx, dy) {
        const next: Oklch = [clamp(roundTo(l + dy * 0.01, 3), 0, 1), clamp(roundTo(c + dx * 0.002, 3), 0, 0.4), h];
        return next[0] !== l || next[1] !== c ? () => void to(next, !!on && !dy) : null;
      },
      bar: channels('oklch')[2],
      ring: null,
    };
  }

  /** the Square's area for the model; the Wheel's inner square is HSB's or HSL's (RGB, ≈CMYK and OKLCH have no matching hue ring, so it stays HSB's) */
  const area = (model: PickerModel, wheel = false): Area => {
    if (wheel) return model === 'hsl' ? hslArea() : hsbArea();
    // ≈CMYK has four inks and no honest flat plane: it keeps the saturation by brightness area
    return { hsb: hsbArea, hsl: hslArea, rgb: rgbArea, cmyk: hsbArea, oklch: oklchArea }[model]();
  };

  /** the most chroma sRGB has at this lightness and hue (at the held value, with the lock on): one move */
  const max = () => {
    const edge = on ? holdValue(on.target, 0.5, h)[1] : maxChroma(l, h, 'srgb');
    slide([l, Math.floor(edge * 1e4) / 1e4, h]);
  };

  return {
    area,
    channels,
    /** the value held, 0..1, when the lock has something to hold; null when it is off, or at black or white */
    target: on?.target ?? null,
    /** the lock is on (at black or white it holds nothing but the readout still shows) */
    locked,
    slide,
    setValue,
    max,
    /** the chroma the lock remembers, which the H by L plane draws its line at */
    chroma: on?.c ?? null,
    retarget,
    begin,
  };
}
