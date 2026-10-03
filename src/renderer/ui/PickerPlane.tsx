import { useLayoutEffect, useRef, useState, type KeyboardEvent, type RefObject } from 'react';
import type { Oklch } from '../../shared/color/index.ts';
import { gamutEdges, planeAxis, planePixels, type Edges } from '../../shared/color/picker.ts';
import { useDrag } from './drag.ts';
import type { ColourGesture } from './Picker.tsx';
import { clamp, roundTo } from './scrub.ts';
import s from './Picker.module.css';

// The L-by-C plane at the current hue (plan unit F). Its pixels are one small ImageData per hue and
// size, cached, so a plane drag only moves the crosshair and a hue drag redraws about 5ms of pixels.

const KEEP = 32;

function memo<K, T>(cache: Map<K, T>, key: K, make: () => T): T {
  let v = cache.get(key);
  if (v === undefined) {
    v = make();
    if (cache.size >= KEEP) cache.delete(cache.keys().next().value!);
    cache.set(key, v);
  }
  return v;
}

type Plane = { image: ImageData; srgb: string; p3: string };
const axes = new Map<number, number>();
const edgeCache = new Map<string, Edges>();
const planes = new Map<string, Plane>();

/** the hue the plane is drawn at: the H field's 0.1 steps */
export const planeHue = (h: number) => Math.round(h * 10) / 10;
/** the chroma axis the plane and the C track share */
export const axisAt = (h: number) => memo(axes, planeHue(h), () => planeAxis(planeHue(h)));

const edgePath = (edge: Float64Array, w: number, axis: number) => {
  let d = 'M0 0';
  edge.forEach((c, y) => (d += `L${((c / axis) * w).toFixed(1)} ${y + 0.5}`));
  return `${d}L0 ${edge.length}`;
};

function useSize(ref: RefObject<HTMLElement | null>) {
  const [size, setSize] = useState<{ w: number; h: number } | null>(null);
  useLayoutEffect(() => {
    const el = ref.current!;
    const take = () => {
      const w = el.clientWidth;
      const h = el.clientHeight;
      setSize((s) => (s && s.w === w && s.h === h ? s : { w, h }));
    };
    take(); // now, so the first paint already has pixels
    const ro = new ResizeObserver(take);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return size;
}

const tick = (v: number) => (v === 0 ? '0' : v.toFixed(2).replace(/^0/, ''));

export function PickerPlane({ value, lockL, onBegin, onChange, onCommit, onCancel }: { value: Oklch; lockL?: boolean } & ColourGesture) {
  const [l, c, h] = value;
  const box = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const size = useSize(box);
  const live = useRef(value);
  live.current = value;

  const hue = planeHue(h);
  const axis = axisAt(h);
  const w = size?.w ?? 0;
  const rows = size?.h ?? 0;
  const plane =
    w && rows
      ? memo(planes, `${hue}|${w}|${rows}`, () => {
          const edges = memo(edgeCache, `${hue}|${rows}`, () => gamutEdges(hue, rows));
          return {
            image: new ImageData(planePixels(hue, w, rows, axis, edges), w, rows),
            srgb: edgePath(edges.srgb, w, axis),
            p3: edgePath(edges.p3, w, axis),
          };
        })
      : null;

  useLayoutEffect(() => {
    if (plane) canvas.current?.getContext('2d')!.putImageData(plane.image, 0, 0);
  }, [plane]);

  const drag = useDrag({
    onBegin,
    onMove({ x, y }) {
      const [l0, c0, h0] = live.current;
      const next: Oklch = [lockL ? l0 : roundTo(1 - y, 3), roundTo(x * axis, 3), h0];
      if (next[0] !== l0 || next[1] !== c0) onChange(next);
    },
    onCommit,
    onCancel,
  });

  // arrows nudge like a NumberField: one step, Shift ×10, each press its own (coalescing) step
  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const dl = ({ ArrowUp: 0.01, ArrowDown: -0.01 } as Record<string, number>)[e.key] ?? 0;
    const dc = ({ ArrowRight: 0.002, ArrowLeft: -0.002 } as Record<string, number>)[e.key] ?? 0;
    if (!dl && !dc) return;
    e.preventDefault();
    const k = e.shiftKey ? 10 : 1;
    const next: Oklch = [lockL ? l : clamp(roundTo(l + dl * k, 3), 0, 1), clamp(roundTo(c + dc * k, 3), 0, 0.4), h];
    if (next[0] === l && next[1] === c) return;
    onBegin?.();
    onChange(next);
    onCommit?.(true);
  };

  // a chroma past the axis is outside P3 too; its marker waits at the edge
  const x = clamp(c / axis, 0, 1) * w;
  const y = (1 - l) * rows;
  const step = axis > 0.25 && Math.round(axis * 100) % 10 === 0 ? 0.1 : 0.05;
  const ticks = Array.from({ length: Math.round(axis / step) + 1 }, (_, i) => i * step);

  return (
    <>
      <div className={s.planeWrap}>
        <div className={s.yAxis} aria-hidden="true">
          <span>100</span>
          <span>50</span>
          <span>0</span>
        </div>
        <div
          ref={box}
          className={s.plane}
          data-lock={lockL ? '' : undefined}
          data-plane=""
          tabIndex={0}
          role="slider"
          aria-label="Lightness by chroma"
          aria-valuemin={0}
          aria-valuemax={1}
          aria-valuenow={l}
          aria-valuetext={`L ${l.toFixed(3)}, C ${c.toFixed(3)}`}
          {...drag.handlers}
          onPointerDown={(e) => {
            e.currentTarget.focus({ preventScroll: true }); // so the arrows work next
            drag.handlers.onPointerDown(e);
          }}
          onKeyDown={onKeyDown}
        >
          <canvas ref={canvas} className={s.canvas} width={w} height={rows} />
          {plane && (
            <svg className={s.edges} width={w} height={rows} aria-hidden="true">
              <path className={s.p3Edge} d={plane.p3} />
              <path d={plane.srgb} />
            </svg>
          )}
          <i className={s.vline} style={{ transform: `translateX(${Math.floor(x)}px)` }} />
          <i className={s.hline} style={{ transform: `translateY(${Math.floor(y)}px)` }} />
          <svg className={s.ring} style={{ transform: `translate(${x}px, ${y}px)` }} viewBox="-10 -10 20 20" aria-hidden="true">
            <circle className={s.halo} r="7" />
            <circle className={s.mark} r="7" />
          </svg>
        </div>
        <div className={s.xAxis} aria-hidden="true">
          {ticks.map((t, i) => (
            <span key={i} style={{ left: `${(t / axis) * 100}%` }}>
              {tick(t)}
            </span>
          ))}
        </div>
      </div>
      <div className={s.caption}>
        <span className="lbl">Lightness by chroma at H {h.toFixed(1)}</span>
        <span className={s.legend} aria-hidden="true">
          <span className="lbl">
            <i />
            sRGB
          </span>
          <span className="lbl">
            <i className={s.dash} />
            P3
          </span>
        </span>
      </div>
    </>
  );
}
