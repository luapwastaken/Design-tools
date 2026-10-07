import { useLayoutEffect, useRef, type CSSProperties, type KeyboardEvent, type PointerEvent } from 'react';
import { cx } from './cx.ts';
import { useDrag } from './drag.ts';
import type { Gesture } from './Picker.tsx';
import { PickerChannel, channelProps } from './PickerChannel.tsx';
import { HUE_HELD } from './PickerHold.tsx';
import { axisAt, planeImage } from './PickerPlane.tsx';
import type { Area } from './pickerModels.ts';
import { useHueLock } from './PickerStyles.tsx';
import { useSize } from './useSize.ts';
import s from './Picker.module.css';

// Square: two components of the model across and up, the third on the bar below, as in Photoshop
// (see Area in pickerModels.ts for each model's). HSB is saturation by brightness with the hue on the bar,
// and the gradients are two sRGB ramps multiplied: white to the pure hue across, times black to white up.

export type AreaProps = {
  area: Area;
} & Gesture;

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

/** the OKLCH model's area: the lightness by chroma plane at the hue (drawn once per hue, at device pixels, with its sRGB and P3 edges) */
function LcPlane({ hue }: { hue: number }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const size = useSize(canvas);
  const dpr = Math.ceil(devicePixelRatio || 1);
  const [pw, ph] = [(size?.w ?? 0) * dpr, (size?.h ?? 0) * dpr];
  const art = pw && ph ? planeImage('lc', hue, pw, ph, axisAt(hue), null) : null;
  useLayoutEffect(() => {
    if (art) canvas.current?.getContext('2d')!.putImageData(art.image, 0, 0);
  }, [art]);
  return (
    <>
      <canvas ref={canvas} className={s.canvas} width={pw} height={ph} />
      {art && (
        <svg className={s.edges} viewBox={`0 0 ${pw} ${ph}`} preserveAspectRatio="none" aria-hidden="true">
          {art.p3 && <path className={s.p3Edge} d={art.p3} />}
          <path d={art.srgb} />
        </svg>
      )}
    </>
  );
}

/** The model's area (the Square's, and HSB's or HSL's inside the Wheel). */
export function PickerArea({ area, className, ...g }: AreaProps & { className?: string }) {
  const drag = useDrag({
    onBegin: g.onBegin,
    onMove: ({ x, y }) => area.move(x, 1 - y),
    onCommit: g.onCommit,
    onCancel: g.onCancel,
  });
  const onKeyDown = (e: KeyboardEvent) => {
    const d = arrow(e);
    const change = d && area.key(...d);
    if (change) keyStep(g, change);
  };

  return (
    <div
      className={cx(s.sb, !area.paint && s.sbCanvas, className)}
      style={area.paint ? { backgroundImage: area.paint.image, backgroundBlendMode: area.paint.blend } : undefined}
      data-plane=""
      data-area={area.kind}
      data-lock={area.contour ? '' : undefined}
      tabIndex={0}
      role="slider"
      aria-label={area.name}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={area.now}
      aria-valuetext={area.text}
      {...drag.handlers}
      onPointerDown={focusThen(drag.handlers.onPointerDown)}
      onKeyDown={onKeyDown}
    >
      {!area.paint && <LcPlane hue={area.hue} />}
      {area.contour && (
        <svg className={s.contour} viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
          <path className={s.halo} d={area.contour} />
          <path className={s.mark} d={area.contour} />
        </svg>
      )}
      <Mark style={{ left: `${area.u * 100}%`, top: `${(1 - area.v) * 100}%` }} />
    </div>
  );
}

/** The Square style: the model's area, then the bar of its third component (its value is typed in the number row below). */
export function PickerSquare({ area, ...g }: AreaProps) {
  const hueHeld = useHueLock();
  const { bar } = area;
  return (
    <>
      <PickerArea area={area} {...g} />
      <PickerChannel
        bare
        {...channelProps(bar)}
        className={s.hueBar}
        locked={bar.label === 'H' && hueHeld ? HUE_HELD : undefined}
        {...g}
      />
    </>
  );
}
