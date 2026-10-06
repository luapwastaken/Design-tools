import { useLayoutEffect, useRef, type KeyboardEvent } from 'react';
import type { Oklch } from '../../shared/color/index.ts';
import { planeAxis } from '../../shared/color/picker.ts';
import { planeArt, planeColour, planeFixed, planePoint, PLANES, planeScale, type PlaneArt } from '../../shared/color/plane.ts';
import { holdValue } from '../../shared/color/value.ts';
import type { PickerPlane as PlaneId } from '../../shared/types.ts';
import { useDrag } from './drag.ts';
import type { ColourGesture } from './Picker.tsx';
import { setPickerPlane, useHueLock, usePickerPlane } from './PickerStyles.tsx';
import { clamp, roundTo } from './scrub.ts';
import { Segmented } from './Segmented.tsx';
import { useSize } from './useSize.ts';
import s from './Picker.module.css';

// The plane (plan unit F, then oklch.com's model): one slice of OKLCH with the third value fixed,
// switched in the caption row: L by C at H, C by H at L, H by L at C. One component with the plane's
// spec in shared/color/plane.ts. Only the active plane is drawn, on the CPU, at device pixels, and
// cached by its fixed value, so a drag across it only moves the marker.

const KEEP = 32;

function memo<K, T>(cache: Map<K, T>, key: K, make: () => T, keep = KEEP): T {
  let v = cache.get(key);
  if (v === undefined) {
    v = make();
    if (cache.size >= keep) cache.delete(cache.keys().next().value!);
    cache.set(key, v);
  }
  return v;
}

type Art = { image: ImageData } & Pick<PlaneArt, 'srgb' | 'p3' | 'empty'>;
const axes = new Map<number, number>();
const arts = new Map<string, Art>();

/** the hue the plane is drawn at: the H field's 0.1 steps */
export const planeHue = (h: number) => Math.round(h * 10) / 10;
/** the chroma axis the L by C plane and the C track share */
export const axisAt = (h: number) => memo(axes, planeHue(h), () => planeAxis(planeHue(h)));

/** the value lock's iso-value line over the L by C plane: from the grey axis out to the most chroma sRGB has at this value */
const lcContour = (target: number, hue: number, w: number, rows: number, axis: number) => {
  const top = holdValue(target, 0.5, hue)[1];
  const pts = Array.from({ length: 49 }, (_, i) => {
    const c = (top * i) / 48;
    return `${((c / axis) * w).toFixed(1)} ${((1 - holdValue(target, c, hue)[0]) * rows).toFixed(1)}`;
  });
  return `M${pts.join('L')}`;
};
/** the same line on the H by L plane: the L that holds the value at each hue, at this chroma (chroma gives way where sRGB runs out) */
const hlContour = (target: number, c: number, w: number, rows: number) => {
  const pts = Array.from({ length: 91 }, (_, i) => `${((i / 90) * w).toFixed(1)} ${((1 - holdValue(target, c, i * 4)[0]) * rows).toFixed(1)}`);
  return `M${pts.join('L')}`;
};
const contours = new Map<string, string>();

const tick = (v: number) => (v === 0 ? '0' : v.toFixed(2).replace(/^0/, ''));
const HUE_TICKS = [0, 90, 180, 270, 360];
const Y_LABELS = { l: ['100', '50', '0'], c: ['.40', '.20', '0'] };
/** one arrow press, in each channel's own steps (the NumberFields': L 0.01, C 0.002, H 1; Shift ×10) */
const STEPS = { l: 0.01, c: 0.002, h: 1 };
/** the index of each channel in an Oklch */
const FIXED = { l: 0, c: 1, h: 2 };
const EMPTY = { ch: 'Only grey fits at this lightness', hl: 'No colours at this chroma', lc: '' } as const;

type PlaneProps = {
  value: Oklch;
  /** the value held (0..1) when the lock is on: a drag moves along the line that keeps it, and `onChange` is then the way to change the value */
  target?: number | null;
  /** the chroma the lock remembers, which the H by L plane's line is drawn at */
  chroma?: number | null;
  /** a move that keeps the value */
  onSlide?(o: Oklch): void;
} & ColourGesture;

export function PickerPlane({ value, target = null, chroma = null, onSlide, onBegin, onChange, onCommit, onCancel }: PlaneProps) {
  const [l, c, h] = value;
  const id = usePickerPlane();
  const hueLock = useHueLock();
  const box = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const size = useSize(box);
  const live = useRef(value);
  live.current = value;

  const spec = PLANES[id];
  const axis = axisAt(h);
  const scale = planeScale(id, axis);
  const w = size?.w ?? 0;
  const rows = size?.h ?? 0;
  // the canvas is drawn at device pixels; the edges are paths in those units, scaled by the svg's viewBox
  const dpr = Math.ceil(devicePixelRatio || 1);
  const [pw, ph] = [w * dpr, rows * dpr];
  // the value held replaces the fixed lightness of the C by H plane (L then follows each pixel); quantised, and it
  // doesn't depend on L, so a drag with the lock on never redraws it
  const held = id === 'ch' && target !== null ? Math.round(target * 500) / 500 : null;
  const fixed = held !== null ? 0 : id === 'lc' ? planeHue(h) : planeFixed(id, value);
  const art =
    w && rows
      ? memo(arts, `${id}|${fixed}|${held}|${axis}|${pw}|${ph}`, () => {
          const a = planeArt(id, fixed, pw, ph, axis, held);
          return { image: new ImageData(a.px, pw, ph), srgb: a.srgb, p3: a.p3, empty: a.empty };
        }, 16)
      : null;

  useLayoutEffect(() => {
    if (art) canvas.current?.getContext('2d')!.putImageData(art.image, 0, 0);
  }, [art]);

  // the iso-value line: drawn on the L by C and H by L planes; the C by H plane is the held value itself
  const line =
    target === null || !w || !rows || id === 'ch'
      ? null
      : memo(contours, `${id}|${id === 'lc' ? planeHue(h) : (chroma ?? c).toFixed(3)}|${target.toFixed(4)}|${w}|${rows}|${axis}`, () =>
          id === 'lc' ? lcContour(target, planeHue(h), w, rows, axis) : hlContour(target, chroma ?? c, w, rows),
        );
  // L carries the value on the planes with L on y: there the pointer's y has no say
  const carrier = target !== null && spec.y === 'l';

  const drag = useDrag({
    onBegin,
    onMove({ x, y }) {
      const o = live.current;
      const at = planeColour(id, x, 1 - y, o, axis);
      // the fixed channel stays exactly as it is; the others are the NumberFields' roundings
      const next = at.map((v, i) => (FIXED[spec.fixed] === i ? o[i] : roundTo(v, i === 2 ? 1 : 3))) as Oklch;
      if (hueLock) next[2] = o[2];
      if (carrier) next[0] = o[0];
      if (next[0] === o[0] && next[1] === o[1] && next[2] === o[2]) return;
      (target !== null ? onSlide : onChange)?.(next);
    },
    onCommit,
    onCancel,
  });

  // arrows nudge like a NumberField: one step, Shift ×10, each press its own (coalescing) step
  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const dx = ({ ArrowRight: 1, ArrowLeft: -1 } as Record<string, number>)[e.key] ?? 0;
    const dy = ({ ArrowUp: 1, ArrowDown: -1 } as Record<string, number>)[e.key] ?? 0;
    if (!dx && !dy) return;
    e.preventDefault();
    const k = e.shiftKey ? 10 : 1;
    const next: Oklch = [l, c, h];
    const move = (ch: 'l' | 'c' | 'h', d: number) => {
      if (!d || (ch === 'h' && hueLock)) return;
      const i = FIXED[ch];
      const v = next[i] + d * STEPS[ch] * k;
      next[i] = ch === 'h' ? roundTo(((v % 360) + 360) % 360, 1) : clamp(roundTo(v, 3), 0, ch === 'l' ? 1 : 0.4);
    };
    move(spec.x, dx);
    move(spec.y, dy);
    if (next[0] === l && next[1] === c && next[2] === h) return;
    onBegin?.();
    // held to a value, a move along the line keeps it; one along L (up and down) changes the value
    (target !== null && !(carrier && dy) ? onSlide : onChange)?.(next);
    onCommit?.(true);
  };

  // a chroma past the axis is outside P3 too; its marker waits at the edge
  const [u, v] = planePoint(id, value, axis);
  const x = clamp(u, 0, 1) * w;
  const y = (1 - clamp(v, 0, 1)) * rows;
  const step = axis > 0.25 && Math.round(axis * 100) % 10 === 0 ? 0.1 : 0.05;
  const xTicks = id === 'lc' ? Array.from({ length: Math.round(axis / step) + 1 }, (_, i) => i * step) : HUE_TICKS;
  const xAt = (t: number) => `${(t / (id === 'lc' ? axis : 360)) * 100}%`;
  const yLabels = Y_LABELS[spec.y];
  const fixedText = id === 'lc' ? `H ${h.toFixed(1)}` : id === 'ch' ? `L ${(l * 100).toFixed(1)}` : `C ${c.toFixed(3)}`;
  // what is held, in words: the value, or the fixed channel
  const caption = target !== null ? `${spec.name}${id === 'ch' ? '' : ` at ${fixedText}`}, holding value ${(target * 100).toFixed(1)}` : `${spec.name} at ${fixedText}`;

  return (
    <>
      <div className={s.planeWrap}>
        <div className={s.yAxis} aria-hidden="true">
          {yLabels.map((t) => (
            <span key={t}>{t}</span>
          ))}
        </div>
        <div
          ref={box}
          className={s.plane}
          data-lock={carrier ? '' : undefined}
          data-plane={id}
          tabIndex={0}
          role="slider"
          aria-label={spec.name}
          aria-valuemin={0}
          aria-valuemax={1}
          aria-valuenow={l}
          aria-valuetext={`L ${l.toFixed(3)}, C ${c.toFixed(3)}, H ${h.toFixed(1)}`}
          {...drag.handlers}
          onPointerDown={(e) => {
            e.currentTarget.focus({ preventScroll: true }); // so the arrows work next
            drag.handlers.onPointerDown(e);
          }}
          onKeyDown={onKeyDown}
        >
          <canvas ref={canvas} className={s.canvas} width={pw} height={ph} data-colour="" />
          {art && (
            <svg className={s.edges} viewBox={`0 0 ${pw} ${ph}`} preserveAspectRatio="none" aria-hidden="true">
              {art.p3 && <path className={s.p3Edge} d={art.p3} />}
              <path d={art.srgb} />
            </svg>
          )}
          {line && (
            <svg className={s.contour} width={w} height={rows} aria-hidden="true">
              <path className={s.halo} d={line} />
              <path className={s.mark} d={line} />
            </svg>
          )}
          {art?.empty && <p className={s.none}>{EMPTY[id as 'ch' | 'hl']}</p>}
          <i className={s.vline} style={{ transform: `translateX(${Math.floor(x)}px)` }} />
          {!carrier && <i className={s.hline} style={{ transform: `translateY(${Math.floor(y)}px)` }} />}
          <svg className={s.ring} style={{ transform: `translate(${x}px, ${y}px)` }} viewBox="-10 -10 20 20" aria-hidden="true">
            <circle className={s.halo} r="7" />
            <circle className={s.mark} r="7" />
          </svg>
        </div>
        <div className={s.xAxis} aria-hidden="true">
          {xTicks.map((t, i) => (
            <span key={i} style={{ left: xAt(t) }}>
              {id === 'lc' ? tick(t) : t}
            </span>
          ))}
        </div>
      </div>
      <div className={s.caption}>
        <Segmented
          mono
          fit
          options={[
            { value: 'lc', label: 'L×C', tip: 'Lightness by chroma, at the hue' },
            { value: 'ch', label: 'C×H', tip: 'Chroma by hue, at the lightness' },
            { value: 'hl', label: 'H×L', tip: 'Hue by lightness, at the chroma' },
          ]}
          value={id}
          onChange={setPickerPlane}
          className={s.planes}
        />
        <span className={s.legend} aria-hidden="true">
          {target !== null && (
            <span className="lbl">
              <i className={s.iso} />
              Value
            </span>
          )}
          <span className="lbl">
            <i />
            sRGB
          </span>
          {id !== 'ch' || target === null ? (
            <span className="lbl">
              <i className={s.dash} />
              P3
            </span>
          ) : null}
        </span>
      </div>
      <p className={s.what}>
        <span className="lbl">{caption}</span>
      </p>
    </>
  );
}
