// Light mode (spec §4): the lit object IS the canvas, big, with a sun you drag on its ring; the exact
// azimuth and elevation are typed in the bar above. Every ramp sits in a filmstrip under it (off while All ramps shows), on the
// same shape under the same light, one click each. Judged colour sits on the neutral surround.
import { memo, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import type { Oklch } from '../../../shared/color/index.ts';
import { cx } from '../../ui/cx.ts';
import { useDrag } from '../../ui/drag.ts';
import { EmptyState, Icon, InspectorGroup, NumberField, Segmented, Select, Tooltip } from '../../ui/index.ts';
import { OptionsBar, OptionsField } from '../common/OptionsBar.tsx';
import { SURROUNDS, surroundOf } from '../common/surround.ts';
import { baseOf, looseOf, rampName, stepsOf, type IllustrationDoc } from './doc.ts';
import { rampsFromLoose, select, selected, type Doc } from './actions.ts';
import { proofOf, PROOFS, type Proof } from './proof.ts';
import { rampLut, shade, surface, type Light, type Shape } from './shade.ts';
import { patchView, shaped, type IllustrationView } from './view-state.ts';
import s from './Light.module.css';

/** view state: the light, the shape, hard steps or blended, one ramp or all of them */
export type LitView = Light & { shape: Shape; banded: boolean; all: boolean };
export const LIT_VIEW: LitView = { azimuth: 320, elevation: 35, shape: 'sphere', banded: false, all: false };

const SHAPES = [
  { value: 'sphere', label: 'Sphere' },
  { value: 'cube', label: 'Cube' },
  { value: 'cloth', label: 'Cloth' },
] as const;
const SHAPE_NAME: Record<Shape, string> = { sphere: 'a sphere', cube: 'a cube', cloth: 'a cloth fold' };
const SHOWS = [
  { value: 'one', label: 'This ramp' },
  { value: 'all', label: 'All ramps' },
] as const;
const SHADINGS = [
  { value: 'smooth', label: 'Smooth' },
  { value: 'banded', label: 'Banded' },
] as const;
/** pixels drawn per shape; CSS scales them to the room there is */
const BIG = 560;
const SMALL = 160;

type LitRamp = { id: string; name: string; steps: Oklch[]; hero: boolean };

const RAD = Math.PI / 180;
/** the sun's ring around the object, as a share of the canvas the object is drawn in (the sphere fills 0.64 of it) */
const RX = 0.56;
const RY = 0.35;

export function LightMode({ doc, d, v }: { doc: Doc; d: IllustrationDoc; v: IllustrationView }) {
  const view = shaped(v.preview, LIT_VIEW);
  const onView = (patch: Partial<LitView>) => patchView({ preview: { ...view, ...patch } });
  const ramps: LitRamp[] = d.ramps.map((r) => ({ id: r.id, name: rampName(d, r), steps: stepsOf(d, r.id).map((w) => proofOf(w.oklch, v.proof)), hero: r.hero })).filter((r) => r.steps.length > 0);
  const sel = selected(d, v.selected);
  const ramp = ramps.find((r) => r.id === sel?.group) ?? ramps[0];
  const surround = surroundOf(v.surround, d.swatches);

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

  const loose = looseOf(d).length > 0;
  return (
    <div className={s.mode}>
      <OptionsBar>
        <OptionsField label="Surround">
          <Select className={s.sel} options={SURROUNDS.map((o) => ({ value: o.value, label: o.tip.replace(' surround', '').replace(/^The /, ''), swatch: surroundOf(o.value, d.swatches) }))} value={v.surround} onChange={(surround) => patchView({ surround })} />
        </OptionsField>
        <OptionsField label="Proof">
          <Select className={s.sel} options={PROOFS} value={v.proof} onChange={(proof: Proof) => patchView({ proof })} />
        </OptionsField>
        <span className={s.grow} />
        <OptionsField label="Light from">
          <NumberField label="Azimuth" value={light.azimuth} min={0} max={360} unit="°" width={104} className={s.num} onChange={(azimuth) => gesture.move({ azimuth })} onCommit={gesture.commit} onCancel={gesture.cancel} />
          <NumberField label="Elevation" value={light.elevation} min={0} max={90} unit="°" width={104} className={s.num} onChange={(elevation) => gesture.move({ elevation })} onCommit={gesture.commit} onCancel={gesture.cancel} />
        </OptionsField>
      </OptionsBar>
      <div className={s.stage} style={{ background: surround }}>
        {!ramp ? (
          <EmptyState
            icon="light_mode"
            problem
            title={loose ? 'These colours are in no ramp yet' : 'Nothing to light yet'}
            detail={loose ? 'Make ramps from them, and they show here on a sphere, a cube and a cloth fold under one light.' : 'Add a base colour, and its ramp shows here lit by the sun.'}
            action={loose ? { label: 'Make ramps', icon: 'auto_awesome_motion', onClick: () => rampsFromLoose(doc) } : undefined}
            className={s.empty}
          />
        ) : view.all ? (
          <Grid ramps={ramps} shape={view.shape} selected={ramp.id} light={light} banded={view.banded} onSelect={(id) => select(baseOf(d, id)?.id ?? null)} gesture={gesture} onKey={(l) => onView(l)} />
        ) : (
          <One ramp={ramp} shape={view.shape} light={light} banded={view.banded} gesture={gesture} onKey={(l) => onView(l)} />
        )}
      </div>
      {ramp && !view.all && (
        <Film ramps={ramps} selected={ramp.id} shape={view.shape} light={light} banded={view.banded} surround={surround} onSelect={(id) => select(baseOf(d, id)?.id ?? null)} />
      )}
    </div>
  );
}

/** the inspector's group for what the object is and how it is drawn: Shape, Show, Shading (the bar keeps the light, the surround and the proof) */
export function LightViewGroup({ v }: { v: IllustrationView }) {
  const view = shaped(v.preview, LIT_VIEW);
  const onView = (patch: Partial<LitView>) => patchView({ preview: { ...view, ...patch } });
  return (
    <InspectorGroup id="illustration.litview" title="Lit preview" sub={`${view.shape} · ${view.all ? 'all ramps' : 'this ramp'}`}>
      <Segmented label="Shape" options={[...SHAPES]} value={view.shape} onChange={(shape) => onView({ shape })} />
      <Segmented label="Show" options={[...SHOWS]} value={view.all ? 'all' : 'one'} onChange={(m) => onView({ all: m === 'all' })} />
      <Segmented label="Shading" options={[...SHADINGS]} value={view.banded ? 'banded' : 'smooth'} onChange={(m) => onView({ banded: m === 'banded' })} />
    </InspectorGroup>
  );
}

type Gesture = { move(p: Partial<Light>): void; commit(): void; cancel(): void };

/** a ramp's colours as 256 screen colours, rebuilt only when the colours themselves change */
function useLut(steps: Oklch[], banded: boolean) {
  const key = steps.map((c) => c.join(' ')).join('|');
  return useMemo(() => rampLut(steps, banded), [key, banded]);
}

/** the selected ramp on the shape, with the sun on its ring */
function One({ ramp, shape, light, banded, gesture, onKey }: { ramp: LitRamp; shape: Shape; light: Light; banded: boolean; gesture: Gesture; onKey(l: Light): void }) {
  const lut = useLut(ramp.steps, banded);
  const start = useRef<Light>(light);
  const drag = useDrag({
    onBegin: () => {
      start.current = light;
      gesture.move({});
    },
    onMove({ free, shift }) {
      // the box is the ring's bounding box: the rim is elevation 0, the centre is light from the viewer
      const u = (free.x - 0.5) * 2;
      const w = (0.5 - free.y) * 2;
      const r = Math.hypot(u, w);
      let azimuth = r < 0.02 ? start.current.azimuth : Math.round((Math.atan2(u, w) / RAD + 360) % 360);
      let elevation = Math.round(Math.acos(Math.min(1, r)) / RAD);
      if (shift) {
        // Shift keeps whichever of the two moved less where it was
        const turn = Math.abs(((azimuth - start.current.azimuth + 540) % 360) - 180);
        if (turn * 0.5 > Math.abs(elevation - start.current.elevation)) elevation = start.current.elevation;
        else azimuth = start.current.azimuth;
      }
      gesture.move({ azimuth, elevation });
    },
    onCommit: gesture.commit,
    onCancel: gesture.cancel,
  });
  const reach = Math.cos(light.elevation * RAD);
  const sx = 50 + reach * Math.sin(light.azimuth * RAD) * 50;
  const sy = 50 - reach * Math.cos(light.azimuth * RAD) * 50;
  const onKeyDown = (e: KeyboardEvent<HTMLElement>) => {
    const k = e.shiftKey ? 10 : 1;
    const da = { ArrowLeft: -k, ArrowRight: k }[e.key] ?? 0;
    const de = { ArrowDown: -k, ArrowUp: k }[e.key] ?? 0;
    if (!da && !de) return;
    e.preventDefault();
    e.stopPropagation();
    onKey({ azimuth: (light.azimuth + da + 360) % 360, elevation: Math.max(0, Math.min(90, light.elevation + de)) });
  };
  return (
    <div className={s.one}>
      <p className={s.caption}>
        <b>{ramp.name}</b> on {SHAPE_NAME[shape]}. Drag the sun to move the light; arrow keys nudge it.
      </p>
      <div className={s.rig} style={{ '--rx': RX, '--ry': RY } as React.CSSProperties}>
        <LitCanvas shape={shape} size={BIG} lut={lut} azimuth={light.azimuth} elevation={light.elevation} label={`${ramp.name} on ${SHAPE_NAME[shape]}`} className={s.object} />
        <div className={cx(s.ring, drag.active && s.dragging)} {...drag.handlers}>
          <svg viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
            <ellipse cx="50" cy="50" rx="50" ry="50" vectorEffect="non-scaling-stroke" className={s.ellipse} />
            <line x1={sx + (50 - sx) * 0.62} y1={sy + (50 - sy) * 0.62} x2={sx} y2={sy} vectorEffect="non-scaling-stroke" className={s.ray} />
          </svg>
          <span
            className={s.sun}
            style={{ left: `${sx}%`, top: `${sy}%` }}
            tabIndex={0}
            role="slider"
            aria-label="Light direction"
            aria-valuemin={0}
            aria-valuemax={360}
            aria-valuenow={light.azimuth}
            aria-valuetext={`Azimuth ${light.azimuth}°, elevation ${light.elevation}°`}
            onKeyDown={onKeyDown}
            onPointerDown={(e) => e.currentTarget.focus({ preventScroll: true })}
          >
            <Icon name="wb_sunny" size={18} fill />
          </span>
        </div>
      </div>
    </div>
  );
}

/** Show: All ramps: every ramp on the selected shape, a grid, with the dial in a corner for the light */
function Grid({ ramps, shape, selected, light, banded, onSelect, gesture, onKey }: { ramps: LitRamp[]; shape: Shape; selected: string; light: Light; banded: boolean; onSelect(id: string): void; gesture: Gesture; onKey(l: Light): void }) {
  const cols = ramps.length <= 2 ? ramps.length : ramps.length <= 4 ? 2 : ramps.length <= 9 ? 3 : 4;
  return (
    <div className={s.gridWrap}>
      <div className={s.grid} style={{ gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))` }} role="radiogroup" aria-label="Ramps under the light">
        {ramps.map((r) => (
          <GridCell key={r.id} ramp={r} shape={shape} on={r.id === selected} light={light} banded={banded} onSelect={onSelect} />
        ))}
      </div>
      <Dial light={light} gesture={gesture} onKey={onKey} />
    </div>
  );
}

function GridCell({ ramp, shape, on, light, banded, onSelect }: { ramp: LitRamp; shape: Shape; on: boolean; light: Light; banded: boolean; onSelect(id: string): void }) {
  const lut = useLut(ramp.steps, banded);
  return (
    <button type="button" role="radio" aria-checked={on} tabIndex={on ? 0 : -1} className={cx(s.gcell, on && s.on)} onClick={() => onSelect(ramp.id)}>
      <LitCanvas shape={shape} size={SMALL * 2} lut={lut} azimuth={light.azimuth} elevation={light.elevation} label={`${ramp.name} on ${SHAPE_NAME[shape]}`} className={s.gcanvas} />
      <span className={s.gname}>{ramp.name}</span>
    </button>
  );
}

/** the filmstrip: every ramp on the same shape under the same light; click selects; one Tab stop, arrows move */
function Film({ ramps, selected, shape, light, banded, surround, onSelect }: { ramps: LitRamp[]; selected: string; shape: Shape; light: Light; banded: boolean; surround: string; onSelect(id: string): void }) {
  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const step = { ArrowLeft: -1, ArrowUp: -1, ArrowRight: 1, ArrowDown: 1 }[e.key];
    if (!step) return;
    e.preventDefault();
    const i = (ramps.findIndex((r) => r.id === selected) + step + ramps.length) % ramps.length;
    onSelect(ramps[i].id);
    (e.currentTarget.children[i] as HTMLElement | undefined)?.focus();
  };
  return (
    <div className={s.film} style={{ '--surround': surround } as React.CSSProperties}>
      <span className={s.filmLabel}>All ramps under this light</span>
      <div className={s.cards} role="radiogroup" aria-label="Ramps under this light" onKeyDown={onKeyDown}>
        {ramps.map((r) => (
          <Card key={r.id} ramp={r} on={r.id === selected} shape={shape} light={light} banded={banded} onSelect={onSelect} />
        ))}
      </div>
    </div>
  );
}

function Card({ ramp, on, shape, light, banded, onSelect }: { ramp: LitRamp; on: boolean; shape: Shape; light: Light; banded: boolean; onSelect(id: string): void }) {
  const lut = useLut(ramp.steps, banded);
  return (
    <button type="button" role="radio" aria-checked={on} tabIndex={on ? 0 : -1} className={cx(s.card, on && s.on)} onClick={() => onSelect(ramp.id)}>
      <LitCanvas shape={shape} size={SMALL} lut={lut} azimuth={light.azimuth} elevation={light.elevation} label={`${ramp.name} on ${SHAPE_NAME[shape]}`} className={s.thumb} />
      <span className={s.cname}>
        {ramp.hero && <Icon name="star" size={14} className={s.hero} />}
        <Tooltip content={ramp.name} overflowOnly>
          <span>{ramp.name}</span>
        </Tooltip>
      </span>
    </button>
  );
}

const LitCanvas = memo(function LitCanvas(p: { shape: Shape; size: number; lut: Uint8ClampedArray; azimuth: number; elevation: number; label: string; className?: string }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const image = useRef<ImageData>(null);
  useLayoutEffect(() => {
    const ctx = ref.current?.getContext('2d');
    if (!ctx) return;
    image.current ??= new ImageData(p.size, p.size);
    shade(surface(p.shape, p.size), p.lut, p, image.current.data);
    ctx.putImageData(image.current, 0, 0);
  }, [p.shape, p.size, p.lut, p.azimuth, p.elevation]);
  return <canvas ref={ref} width={p.size} height={p.size} className={p.className} role="img" aria-label={p.label} />;
});

/** the small dial, for the all-ramps grid, where the sun's ring has no room: the rim is elevation 0 */
const HALF = 32;
const RIM = 29;
function Dial({ light, gesture, onKey }: { light: Light; gesture: Gesture; onKey(l: Light): void }) {
  const drag = useDrag({
    onBegin: () => gesture.move({}),
    onMove({ x, y }) {
      const [dx, dy] = [((x * 2 - 1) * HALF) / RIM, ((1 - y * 2) * HALF) / RIM];
      const r = Math.hypot(dx, dy);
      gesture.move({ azimuth: r < 0.02 ? light.azimuth : Math.round((Math.atan2(dx, dy) / RAD + 360) % 360), elevation: Math.round(Math.acos(Math.min(1, r)) / RAD) });
    },
    onCommit: gesture.commit,
    onCancel: gesture.cancel,
  });
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
      className={cx(s.dial, drag.active && s.dialDrag)}
      tabIndex={0}
      role="slider"
      aria-label="Light direction"
      aria-valuemin={0}
      aria-valuemax={360}
      aria-valuenow={light.azimuth}
      aria-valuetext={`Azimuth ${light.azimuth}°, elevation ${light.elevation}°`}
      {...drag.handlers}
      onPointerDown={(e) => {
        e.currentTarget.focus({ preventScroll: true });
        drag.handlers.onPointerDown(e);
      }}
      onKeyDown={onKeyDown}
    >
      <svg viewBox={`${-HALF} ${-HALF} ${HALF * 2} ${HALF * 2}`} aria-hidden="true">
        <circle className={s.disc} r={RIM} />
        <circle className={s.dring} r={RIM * Math.cos(30 * RAD)} />
        <circle className={s.dring} r={RIM * Math.cos(60 * RAD)} />
        <line className={s.dray} x2={lx} y2={ly} />
        <circle className={s.knob} cx={lx} cy={ly} r={4} />
      </svg>
    </div>
  );
}
