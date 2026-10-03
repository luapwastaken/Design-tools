// The lit preview (spec §2, plan unit P): the selected ramp on a sphere, a cube and a cloth fold
// under one light, or every ramp on a small sphere. The light is a dial and two typed numbers, in a
// foot under the shapes so they never cover each other.
import { memo, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { cssColor, toOklch, type Oklch } from '../../../shared/color/index.ts';
import { cx } from '../../ui/cx.ts';
import { useDrag } from '../../ui/drag.ts';
import { EmptyState, Icon, Module, NumberField, Segmented, Toggle, Tooltip, type EmptyStateProps } from '../../ui/index.ts';
import { useWidth } from '../common/useWidth.ts';
import { rampLut, shade, surface, type Light, type Shape } from './shade.ts';
import s from './LitPreview.module.css';

/** one ramp to show: its colours lightest first, as the ramp row runs */
export type LitRamp = { id: string; name: string; steps: Oklch[]; hero?: boolean };
/** view state: the light, hard steps or blended, and the shapes or every ramp */
export type LitView = Light & { banded: boolean; all: boolean };
export const LIT_VIEW: LitView = { azimuth: 320, elevation: 35, banded: false, all: false };

/** what a saved workspace holds, field by field; anything odd falls back to the default */
export function litView(raw: unknown): LitView {
  const r = typeof raw === 'object' && raw !== null ? (raw as Record<string, unknown>) : {};
  const deg = (v: unknown, max: number, def: number) => (typeof v === 'number' && v >= 0 && v <= max ? v : def);
  const bool = (v: unknown, def: boolean) => (typeof v === 'boolean' ? v : def);
  return {
    azimuth: deg(r.azimuth, 360, LIT_VIEW.azimuth),
    elevation: deg(r.elevation, 90, LIT_VIEW.elevation),
    banded: bool(r.banded, LIT_VIEW.banded),
    all: bool(r.all, LIT_VIEW.all),
  };
}

const SHAPES: { shape: Shape; name: string }[] = [
  { shape: 'sphere', name: 'sphere' },
  { shape: 'cube', name: 'cube' },
  { shape: 'cloth', name: 'cloth fold' },
];
/** pixels drawn per shape; CSS scales them to the room there is */
const BIG = 288;
const SMALL = 160;
const MODES = [
  { value: 'shapes', label: 'Shapes' },
  { value: 'all', label: 'All ramps' },
] as const;
/** 18% reflectance, as behind Design's swatches: the backdrop the shapes stand in front of */
const SURROUND = cssColor(toOklch({ mode: 'lrgb', r: 0.18, g: 0.18, b: 0.18 }));

type Props = {
  ramps: LitRamp[];
  /** the ramp on the shapes; the first when null or gone */
  selected: string | null;
  /** the view state as saved (the tool's `preview`); read through `litView` */
  view: unknown;
  /** the whole next view state, once per gesture (a drag's end, a typed value), never per pointer move */
  onView(next: LitView): void;
  /** a small sphere picked in the all-ramps strip */
  onSelect?(id: string): void;
  /** behind the Paint switch: draws nothing */
  hidden?: boolean;
  /** what shows while there is no ramp to light, with the way out */
  empty?: Omit<EmptyStateProps, 'icon'>;
};

const NOTHING = { title: 'Nothing to light yet', detail: 'Add a base colour, and its ramp shows here on a sphere, a cube and a cloth fold under one light.' };

export function LitPreview({ ramps: all, selected, view: raw, onView: onNext, onSelect, hidden, empty = NOTHING }: Props) {
  const ramps = all.filter((r) => r.steps.length > 0);
  const view = litView(raw);
  const onView = (patch: Partial<LitView>) => onNext({ ...view, ...patch });
  // the light while a drag or scrub is on; it reaches the view state when the gesture ends
  const [live, setLive] = useState<Light | null>(null);
  const liveRef = useRef<Light | null>(null);
  const light = live ?? { azimuth: view.azimuth, elevation: view.elevation };
  const gesture = {
    move(patch: Partial<Light>) {
      setLive((liveRef.current = { ...(liveRef.current ?? light), ...patch }));
    },
    commit() {
      if (liveRef.current) onView(liveRef.current);
      liveRef.current = null;
      setLive(null);
    },
    cancel() {
      liveRef.current = null;
      setLive(null);
    },
  };

  if (hidden) return null;
  const ramp = ramps.find((r) => r.id === selected) ?? ramps[0];
  return (
    <Module
      title="Lit preview"
      sub={!ramp ? undefined : view.all ? `${ramps.length} ramp${ramps.length === 1 ? '' : 's'}` : ramp.name}
      actions={
        ramp && (
          <span className={s.actions}>
            <Toggle label="Banded" checked={view.banded} onChange={(banded) => onView({ banded })} className={s.banded} />
            <Segmented options={[...MODES]} value={view.all ? 'all' : 'shapes'} onChange={(m) => onView({ all: m === 'all' })} fit className={s.modes} />
          </span>
        )
      }
      className={s.mod}
    >
      {!ramp ? (
        <EmptyState icon="light_mode" problem {...empty} className={s.empty} />
      ) : (
        <div className={s.body}>
          {view.all ? (
            <Strip ramps={ramps} selected={ramp.id} light={light} banded={view.banded} onSelect={onSelect} />
          ) : (
            <div className={s.stage} style={{ background: SURROUND }}>
              <Shapes ramp={ramp} light={light} banded={view.banded} />
            </div>
          )}
          <div className={s.light}>
            <Dial light={light} onBegin={() => gesture.move({})} onMove={gesture.move} onCommit={gesture.commit} onCancel={gesture.cancel} onKey={(l) => onView(l)} />
            <div className={s.fields}>
              <span className="lbl">Light from</span>
              <NumberField
                label="Azimuth"
                value={light.azimuth}
                min={0}
                max={360}
                unit="°"
                onChange={(azimuth) => gesture.move({ azimuth })}
                onCommit={gesture.commit}
                onCancel={gesture.cancel}
              />
              <NumberField
                label="Elevation"
                value={light.elevation}
                min={0}
                max={90}
                unit="°"
                onChange={(elevation) => gesture.move({ elevation })}
                onCommit={gesture.commit}
                onCancel={gesture.cancel}
              />
            </div>
          </div>
        </div>
      )}
    </Module>
  );
}

/** a ramp's colours as 256 screen colours, rebuilt only when the colours themselves change */
function useLut(steps: Oklch[], banded: boolean) {
  const key = steps.map((c) => c.join(' ')).join('|');
  return useMemo(() => rampLut(steps, banded), [key, banded]);
}

function Shapes({ ramp, light, banded }: { ramp: LitRamp; light: Light; banded: boolean }) {
  const lut = useLut(ramp.steps, banded);
  return (
    <div className={s.shapes}>
      {SHAPES.map(({ shape, name }) => (
        <LitCanvas key={shape} shape={shape} size={BIG} lut={lut} azimuth={light.azimuth} elevation={light.elevation} label={`${ramp.name} on a ${name}`} />
      ))}
    </div>
  );
}

/** below this a sphere is too small to judge: the strip goes to two rows */
const MIN_CARD = 88;

/** every ramp on a small sphere under the same light, in one row that shrinks to fit; one Tab stop, arrows move and pick */
function Strip({ ramps, selected, light, banded, onSelect }: { ramps: LitRamp[]; selected: string; light: Light; banded: boolean; onSelect?(id: string): void }) {
  const { ref, width } = useWidth<HTMLDivElement>();
  const cols = width && width / ramps.length < MIN_CARD ? Math.ceil(ramps.length / 2) : ramps.length;
  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const step = { ArrowLeft: -1, ArrowUp: -1, ArrowRight: 1, ArrowDown: 1 }[e.key];
    if (!step || !onSelect) return;
    e.preventDefault();
    const i = (ramps.findIndex((r) => r.id === selected) + step + ramps.length) % ramps.length;
    onSelect(ramps[i].id);
    (e.currentTarget.children[i] as HTMLElement | undefined)?.focus();
  };
  return (
    <div
      ref={ref}
      className={s.strip}
      style={{ gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))`, gridTemplateRows: `repeat(${Math.ceil(ramps.length / cols)}, minmax(0, 1fr))` }}
      role="radiogroup"
      aria-label="Ramps under the light"
      onKeyDown={onKeyDown}
    >
      {ramps.map((r) => (
        <SmallSphere key={r.id} ramp={r} on={r.id === selected} light={light} banded={banded} onSelect={onSelect} />
      ))}
    </div>
  );
}

function SmallSphere({ ramp, on, light, banded, onSelect }: { ramp: LitRamp; on: boolean; light: Light; banded: boolean; onSelect?(id: string): void }) {
  const lut = useLut(ramp.steps, banded);
  return (
    <button type="button" role="radio" aria-checked={on} tabIndex={on ? 0 : -1} className={cx(s.card, on && s.on)} onClick={() => onSelect?.(ramp.id)}>
      <span className={s.mat} style={{ background: SURROUND }}>
        <LitCanvas shape="sphere" size={SMALL} lut={lut} azimuth={light.azimuth} elevation={light.elevation} label={`${ramp.name} on a sphere`} />
      </span>
      <span className={s.meta}>
        {ramp.hero && <Icon name="star" size={14} className={s.hero} />}
        <Tooltip content={ramp.name} overflowOnly>
          <span className={s.name}>{ramp.name}</span>
        </Tooltip>
      </span>
    </button>
  );
}

const LitCanvas = memo(function LitCanvas(p: { shape: Shape; size: number; lut: Uint8ClampedArray; azimuth: number; elevation: number; label: string }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const image = useRef<ImageData>(null);
  useLayoutEffect(() => {
    const ctx = ref.current?.getContext('2d');
    if (!ctx) return;
    image.current ??= new ImageData(p.size, p.size);
    shade(surface(p.shape, p.size), p.lut, p, image.current.data);
    ctx.putImageData(image.current, 0, 0);
  }, [p.shape, p.size, p.lut, p.azimuth, p.elevation]);
  return <canvas ref={ref} width={p.size} height={p.size} className={s.canvas} role="img" aria-label={p.label} />;
});

const RAD = Math.PI / 180;
/** the dial in its own pixels: the rim is elevation 0, the centre light straight from the viewer */
const HALF = 32;
const RIM = 29;

function Dial({ light, onBegin, onMove, onCommit, onCancel, onKey }: {
  light: Light;
  onBegin(): void;
  onMove(l: Light): void;
  onCommit(): void;
  onCancel(): void;
  /** an arrow key: its own finished step */
  onKey(l: Light): void;
}) {
  const drag = useDrag({
    onBegin,
    onMove({ x, y }) {
      const [dx, dy] = [((x * 2 - 1) * HALF) / RIM, ((1 - y * 2) * HALF) / RIM]; // the box runs a little past the rim
      const r = Math.hypot(dx, dy);
      onMove({
        // dead centre has no direction: keep the one there was
        azimuth: r < 0.02 ? light.azimuth : Math.round((Math.atan2(dx, dy) / RAD + 360) % 360),
        elevation: Math.round(Math.acos(Math.min(1, r)) / RAD),
      });
    },
    onCommit,
    onCancel,
  });

  // arrows turn the light round (left, right) and up or down (Shift ×10), like two NumberFields
  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const k = e.shiftKey ? 10 : 1;
    const da = { ArrowLeft: -k, ArrowRight: k }[e.key] ?? 0;
    const de = { ArrowDown: -k, ArrowUp: k }[e.key] ?? 0;
    if (!da && !de) return;
    e.preventDefault();
    onKey({ azimuth: (light.azimuth + da + 360) % 360, elevation: Math.max(0, Math.min(90, light.elevation + de)) });
  };

  const reach = RIM * Math.cos(light.elevation * RAD);
  const [lx, ly] = [reach * Math.sin(light.azimuth * RAD), -reach * Math.cos(light.azimuth * RAD)];
  return (
    <div
      className={cx(s.dial, drag.active && s.dragging)}
      tabIndex={0}
      role="slider"
      aria-label="Light direction"
      aria-valuemin={0}
      aria-valuemax={360}
      aria-valuenow={light.azimuth}
      aria-valuetext={`Azimuth ${light.azimuth}°, elevation ${light.elevation}°`}
      {...drag.handlers}
      onPointerDown={(e) => {
        e.currentTarget.focus({ preventScroll: true }); // so the arrows work next
        drag.handlers.onPointerDown(e);
      }}
      onKeyDown={onKeyDown}
    >
      <svg viewBox={`${-HALF} ${-HALF} ${HALF * 2} ${HALF * 2}`} aria-hidden="true">
        <circle className={s.disc} r={RIM} />
        <circle className={s.ring} r={RIM * Math.cos(30 * RAD)} />
        <circle className={s.ring} r={RIM * Math.cos(60 * RAD)} />
        <path className={s.cross} d={`M${-RIM} 0H${RIM}M0 ${-RIM}V${RIM}`} />
        {Array.from({ length: 12 }, (_, i) => (
          <line key={i} className={i % 3 ? s.tick : s.major} y1={-RIM} y2={-RIM + (i % 3 ? 2.5 : 4)} transform={`rotate(${i * 30})`} />
        ))}
        <line className={s.ray} x2={lx} y2={ly} />
        <circle className={s.knob} cx={lx} cy={ly} r={4} />
      </svg>
    </div>
  );
}
