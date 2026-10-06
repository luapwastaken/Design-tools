// Tab 2, Light & preview: the lit object large on the left with a sun you drag on its ring, what is
// under the pointer and how much of the object each step has, the shape and view options under it;
// on the right the controls in groups: Light (direction, height, presets, light and shadow colours),
// Look of <ramp> (the same rows as Ramp settings, relighting every tick), Surface (how the material
// is lit), the colours the light needs that the ramp lacks, and how it is seen. Show: All ramps puts
// every ramp on the shape under the one light. Judged colour sits on the neutral surround.
import { memo, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent, type PointerEvent } from 'react';
import { cssColor, toHex, type Oklch } from '../../../shared/color/index.ts';
import type { RampSpec, Swatch } from '../../../shared/types.ts';
import { cx } from '../../ui/cx.ts';
import { useDrag } from '../../ui/drag.ts';
import { Button, ColorField, EmptyState, Icon, InspectorGroup, InspectorRow, NumberField, Segmented, Select, Slider, useDocColour, useDocNumber } from '../../ui/index.ts';
import { displayName, fmtL } from '../common/names.ts';
import { createStore } from '../common/store.ts';
import { SURROUNDS, surroundColour, surroundOf, type Surround } from '../common/surround.ts';
import { looseOf, rampName, rampOf, setSpec, stepsOf, stepWord, type IllustrationDoc } from './doc.ts';
import { lightEveryRamp, rampsFromLoose, selected, type Doc } from './actions.ts';
import { FOLDS, type Fold } from './cloth.ts';
import { finishOf, hasOverrides, SURFACE_SLIDERS } from './finish.ts';
import { glowColour, neededColours, type Needed } from './needed.ts';
import { proofOf, PROOFS, type Proof } from './proof.ts';
import { RampLook } from './RampLook.tsx';
import { lookOf, newStats, read, shade, surface, type Light, type Look, type Reading, type Shape, type Stats } from './shade.ts';
import { lightAt, lightWords, nudge, PRESETS, presetOf, sunAt, type Arrow } from './sun.ts';
import { patchView, shaped, type IllustrationView } from './view-state.ts';
import s from './Light.module.css';

/** view state: the light, the shape, the cloth's drape, hard steps or blended, one ramp or all of them, and the ramp picked from All ramps */
export type LitView = Light & { shape: Shape | 'all'; banded: boolean; all: boolean; fold: Fold; ramp: string; rampFor: string };
export const LIT_VIEW: LitView = { azimuth: 320, elevation: 35, shape: 'sphere', banded: false, all: false, fold: 'curtain', ramp: '', rampFor: '' };

const SHAPES = [
  { value: 'sphere', label: 'Sphere' },
  { value: 'cube', label: 'Cube' },
  { value: 'cloth', label: 'Cloth' },
  { value: 'all', label: 'All three' },
] as const;
const ALL_SHAPES: Shape[] = ['sphere', 'cube', 'cloth'];
export const SHAPE_NAME: Record<Shape, string> = { sphere: 'a sphere', cube: 'a cube', cloth: 'a cloth fold' };
const SHOWS = [
  { value: 'one', label: 'This ramp' },
  { value: 'all', label: 'All ramps' },
] as const;
const SHADINGS = [
  { value: 'smooth', label: 'Smooth' },
  { value: 'banded', label: 'Banded' },
] as const;
const SURROUND_NAME: Record<Surround, string> = { grey: '18% grey', ground: 'Palette background', plain: 'Plain' };
/** pixels drawn per shape; CSS scales them to the room there is. While the light is being dragged half as many, so the drag stays smooth */
const BIG = 560;
const SMALL = 320;
const DRAGGING = 0.5;

/** a ramp as the tab lights it: its steps as the lens shows them, its real swatches (for the readout), its settings */
export type LitRamp = { id: string; name: string; steps: Oklch[]; swatches: Swatch[]; hero: boolean; spec: RampSpec };

/** what the pointer is over, as words: set by the canvases, shown above the stage */
const hover = createStore<string | null>(null);

const wrap = (a: number) => ((a % 360) + 360) % 360;

export function LightTab({ doc, d, v }: { doc: Doc; d: IllustrationDoc; v: IllustrationView }) {
  const view = shaped(v.preview, LIT_VIEW);
  if (view.shape !== 'all' && !ALL_SHAPES.includes(view.shape)) view.shape = 'sphere';
  if (!FOLDS.some((f) => f.value === view.fold)) view.fold = 'curtain';
  // Show: All ramps draws one shape for each ramp, so "All three" is not one of its shapes
  const shape = view.all && view.shape === 'all' ? 'sphere' : view.shape;
  const onView = (patch: Partial<LitView>) => patchView({ preview: { ...view, ...patch } });
  const ramps: LitRamp[] = d.ramps
    .map((spec) => {
      const swatches = stepsOf(d, spec.id);
      return { id: spec.id, name: rampName(d, spec), steps: swatches.map((w) => proofOf(w.oklch, v.proof)), swatches, hero: spec.hero, spec };
    })
    .filter((r) => r.steps.length > 0);
  const sel = selected(d, v.selected);
  // a ramp picked from All ramps is the one the controls edit, until the selection moves somewhere else
  const picked = view.ramp && view.rampFor === (sel?.id ?? '') ? ramps.find((r) => r.id === view.ramp) : undefined;
  const ramp = picked ?? ramps.find((r) => r.id === sel?.group) ?? ramps[0];
  const strayed = !!sel && !!ramp && !picked && sel.group !== ramp.id;
  const surround = surroundOf(v.surround, d.swatches);
  const ground = surroundColour(v.surround, d.swatches);

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
  // the light or one of the sliders is mid-gesture: draw at drag size
  const dragging = live !== null || doc.inGesture();
  const k = dragging ? DRAGGING : 1;

  const loose = looseOf(d).length > 0;
  const spec = ramp?.spec;
  return (
    <div className={s.tab}>
      <div className={s.main}>
        <div className={s.head}>
          {ramp && (
            <>
              <span className={s.caption}>
                <b>{ramp.name}</b> on {view.all ? 'every ramp' : shape === 'all' ? 'all three shapes' : SHAPE_NAME[shape]}, lit {lightWords(light)}.{strayed && ' The selected colour is in no ramp, so this is the first ramp.'}
              </span>
              <Readout />
            </>
          )}
        </div>
        <div className={s.stage}>
          <div className={s.ground} style={{ background: surround }} data-colour="" />
          {!ramp ? (
            <EmptyState
              icon="light_mode"
              problem
              title={loose ? 'These colours are in no ramp yet' : 'Nothing to light yet'}
              detail={loose ? 'Make ramps from them, and they show here on a sphere, a cube and a cloth fold under one light.' : 'Add a base colour, and its ramp shows here lit by the sun.'}
              action={loose ? { label: 'Make ramps', icon: 'auto_awesome_motion', onClick: () => rampsFromLoose(doc) } : undefined}
              className={s.empty}
            />
          ) : (
            <>
              {view.all ? (
                <Grid ramps={ramps} shape={shape as Shape} fold={view.fold} selected={ramp.id} light={light} banded={view.banded} ground={ground} scale={k} onSelect={(id) => onView({ ramp: id, rampFor: sel?.id ?? '' })} />
              ) : shape === 'all' ? (
                <Three ramp={ramp} fold={view.fold} light={light} banded={view.banded} ground={ground} scale={k} />
              ) : (
                <One ramp={ramp} shape={shape} fold={view.fold} light={light} banded={view.banded} ground={ground} scale={k} />
              )}
              <SunRing light={light} gesture={gesture} onKey={(l) => onView(l)} />
            </>
          )}
        </div>
        {ramp && !view.all && <StepUse ramp={ramp} shapes={shape === 'all' ? ALL_SHAPES : [shape]} fold={view.fold} light={light} banded={view.banded} ground={ground} />}
        <div className={s.options}>
          <Segmented
            label="Shape"
            options={SHAPES.map((o) => (o.value === 'all' && view.all ? { ...o, disabled: true, tip: 'All ramps shows one shape for each ramp' } : o))}
            value={shape}
            onChange={(next) => onView({ shape: next })}
          />
          <Segmented label="Show" options={[...SHOWS]} value={view.all ? 'all' : 'one'} onChange={(m) => onView({ all: m === 'all' })} />
          {(shape === 'cloth' || shape === 'all') && <Segmented label="Drape" options={FOLDS.map((f) => ({ value: f.value, label: f.label, tip: f.tip }))} value={view.fold} onChange={(fold) => onView({ fold })} />}
          <Segmented label="Shading" options={[...SHADINGS]} value={view.banded ? 'banded' : 'smooth'} onChange={(m) => onView({ banded: m === 'banded' })} />
        </div>
      </div>
      <div className={s.controls}>
        <InspectorGroup title="Light" id="illustration.light.light">
          <InspectorRow label="Direction" info="Where the light comes from, in degrees clockwise from straight up: 0 is above, 90 the right, 180 below, 270 the left.">
            <NumberField label="Direction" hideLabel value={Math.round(light.azimuth)} min={0} max={360} unit="°" onChange={(azimuth) => gesture.move({ azimuth: wrap(azimuth) })} onCommit={gesture.commit} onCancel={gesture.cancel} />
          </InspectorRow>
          <InspectorRow label="Height" info="How far round toward you or behind: 0 lights from the side, 90 from where you stand, and below 0 from behind the object (the sun is drawn hollow).">
            <NumberField label="Height" hideLabel value={Math.round(light.elevation)} min={-90} max={90} unit="°" onChange={(elevation) => gesture.move({ elevation })} onCommit={gesture.commit} onCancel={gesture.cancel} />
          </InspectorRow>
          <Presets light={light} onPick={(l) => onView(l)} />
          {spec && <LightColours key={spec.id} doc={doc} d={d} r={spec} />}
          {spec && d.ramps.length > 1 && <EveryRamp doc={doc} d={d} r={spec} />}
        </InspectorGroup>
        {spec && ramp && (
          <>
            <InspectorGroup title={`Look of ${ramp.name}`} id="illustration.light.look">
              <RampLook key={spec.id} doc={doc} d={d} r={spec} />
              {ramp.swatches.some((w) => w.edited) && <p className={s.hint}>{ramp.swatches.filter((w) => w.edited).length} edited steps keep their colour.</p>}
            </InspectorGroup>
            <Surface key={`surface-${spec.id}`} doc={doc} d={d} r={spec} />
            {!view.all && <Needs doc={doc} d={d} ramp={ramp} shapes={shape === 'all' ? ALL_SHAPES : [shape]} fold={view.fold} light={light} banded={view.banded} ground={ground} />}
          </>
        )}
        <InspectorGroup title="Seen" id="illustration.light.seen">
          <InspectorRow label="Surround" info="What the object sits on. It also colours the light bounced back into the shadows.">
            <Select options={SURROUNDS.map((o) => ({ value: o.value, label: SURROUND_NAME[o.value], swatch: surroundOf(o.value, d.swatches) }))} value={v.surround} onChange={(next) => patchView({ surround: next })} />
          </InspectorRow>
          <InspectorRow label="Seen as">
            <Select options={PROOFS} value={v.proof} onChange={(proof: Proof) => patchView({ proof })} />
          </InspectorRow>
        </InspectorGroup>
      </div>
    </div>
  );
}

/** what the pointer is over, in the head of the tab */
function Readout() {
  const text = hover.use();
  return <span className={s.readout}>{text ?? 'Point at the object to read its step'}</span>;
}

/** the six classic set-ups, two rows of three: the one the light is on is the raised key */
function Presets({ light, onPick }: { light: Light; onPick(l: Light): void }) {
  const now = presetOf(light);
  const row = (ids: string[]) => (
    <Segmented
      label={undefined}
      options={PRESETS.filter((p) => ids.includes(p.id)).map((p) => ({ value: p.id, label: p.label, tip: p.tip }))}
      value={now && ids.includes(now) ? now : ''}
      onChange={(id) => onPick(PRESETS.find((p) => p.id === id)!.light)}
    />
  );
  return (
    <div className={s.presets} role="group" aria-label="Light presets">
      {row(['upper-left', 'top', 'side'])}
      {row(['rim', 'back', 'front'])}
    </div>
  );
}

const same = (a: number[], b: number[]) => a.every((x, i) => x === b[i]);

/** the light and shadow colours the ramp's lighter and darker steps lean toward: per ramp */
function LightColours({ doc, d, r }: { doc: Doc; d: IllustrationDoc; r: RampSpec }) {
  const name = rampName(d, r);
  const get = (x: IllustrationDoc) => rampOf(x, r.id) ?? r;
  const light = useDocColour(doc, { label: `Change the light of ${name}`, key: `${r.id}:light`, get: (x) => get(x).light, set: (x, o) => setSpec(x, r.id, { light: o }) });
  const shadow = useDocColour(doc, { label: `Change the shadow of ${name}`, key: `${r.id}:shadow`, get: (x) => get(x).shadow, set: (x, o) => setSpec(x, r.id, { shadow: o }) });
  return (
    <>
      <InspectorRow label="Light" info="Lighter steps lean toward this colour.">
        <ColorField {...light} name={displayName({ name: '', oklch: light.value })} />
      </InspectorRow>
      <InspectorRow label="Shadow" info="Darker steps lean toward this colour.">
        <ColorField {...shadow} name={displayName({ name: '', oklch: shadow.value })} />
      </InspectorRow>
    </>
  );
}

function EveryRamp({ doc, d, r }: { doc: Doc; d: IllustrationDoc; r: RampSpec }) {
  const shared = d.ramps.every((x) => same(x.light, r.light) && same(x.shadow, r.shadow));
  return (
    <Button size="xs" variant="ghost" icon="wb_sunny" disabled={shared} onClick={() => lightEveryRamp(doc, r.id)} tooltip={shared ? 'Every ramp is lit this way already' : 'One scene, one light: every ramp takes this light and shadow colour'} className={s.every}>
      Use for every ramp
    </Button>
  );
}

/** how the material is lit: sliders that start at the material's own numbers, saved with the ramp */
function Surface({ doc, d, r }: { doc: Doc; d: IllustrationDoc; r: RampSpec }) {
  const name = rampName(d, r);
  const spec = (x: IllustrationDoc) => rampOf(x, r.id) ?? r;
  const finish = finishOf(r.material, r.surface);
  const reset = () => doc.transact(`Reset the surface of ${name} to its material`, (x) => setSpec(x, r.id, { surface: undefined }));
  return (
    <InspectorGroup
      title="Surface"
      id="illustration.light.surface"
      actions={
        <Button size="xs" variant="ghost" icon="restart_alt" disabled={!hasOverrides(r.surface)} onClick={reset} tooltip={hasOverrides(r.surface) ? 'Back to what the material does' : 'These are what the material does'}>
          Reset to material
        </Button>
      }
    >
      {SURFACE_SLIDERS.map((o) => (
        <SurfaceSlider key={o.key} doc={doc} r={r} name={name} spec={spec} item={o} />
      ))}
      <Segmented
        label="Streak"
        info="Which way the grain stretches the highlight: along the folds, or across them."
        options={[
          { value: 'along', label: 'Along folds' },
          { value: 'across', label: 'Across folds' },
        ]}
        value={finish.across ? 'across' : 'along'}
        disabled={finish.grain < 0.01}
        onChange={(m) => doc.transact(`Change the grain of ${name}`, (x) => setSpec(x, r.id, { surface: { ...spec(x).surface, across: m === 'across' } }))}
      />
    </InspectorGroup>
  );
}

function SurfaceSlider({ doc, r, name, spec, item }: { doc: Doc; r: RampSpec; name: string; spec(x: IllustrationDoc): RampSpec; item: (typeof SURFACE_SLIDERS)[number] }) {
  const bound = useDocNumber(doc, {
    label: `Change the ${item.label.toLowerCase()} of ${name}`,
    key: `${r.id}:surface:${item.key}`,
    get: (x) => Math.round(finishOf(spec(x).material, spec(x).surface)[item.key] * 100),
    set: (x, n) => setSpec(x, r.id, { surface: { ...spec(x).surface, [item.key]: n / 100 } }),
  });
  return <Slider label={item.label} info={item.info} min={0} max={100} step={1} unit="%" fieldWidth={70} {...bound} />;
}

type Gesture = { move(p: Partial<Light>): void; commit(): void; cancel(): void };

/** the sun on its ring over the stage: drag the sun (Alt flips it behind the object), or the thin ring; arrows move it on the screen */
function SunRing({ light, gesture, onKey }: { light: Light; gesture: Gesture; onKey(l: Light): void }) {
  const start = useRef<Light>(light);
  const flip = useRef(false);
  const behindRef = useRef(false);
  const drag = useDrag({
    onBegin: () => {
      start.current = light;
      behindRef.current = light.elevation < 0 !== flip.current;
      gesture.move({});
    },
    onMove({ free, shift }) {
      // the box is the ring's bounding box: the rim is height 0, the centre is light from the viewer
      let next = lightAt((free.x - 0.5) * 2, (0.5 - free.y) * 2, behindRef.current, start.current);
      if (shift) {
        // Shift keeps whichever of the two moved less where it was
        const turn = Math.abs(((next.azimuth - start.current.azimuth + 540) % 360) - 180);
        next = turn * 0.5 > Math.abs(Math.abs(next.elevation) - Math.abs(start.current.elevation)) ? { ...next, elevation: start.current.elevation } : { ...next, azimuth: start.current.azimuth };
      }
      gesture.move(next);
    },
    onCommit: gesture.commit,
    onCancel: gesture.cancel,
  });
  const at = sunAt(light);
  const behind = light.elevation < 0;
  const ARROWS: Record<string, Arrow> = { ArrowLeft: 'left', ArrowRight: 'right', ArrowUp: 'up', ArrowDown: 'down' };
  const onKeyDown = (e: KeyboardEvent<HTMLElement>) => {
    const arrow = ARROWS[e.key];
    if (!arrow) return;
    e.preventDefault();
    e.stopPropagation();
    onKey(nudge(light, arrow, e.shiftKey ? 10 : 1));
  };
  return (
    <div
      className={cx(s.ringbox, drag.active && s.dragging)}
      {...drag.handlers}
      onPointerDown={(e: PointerEvent<HTMLElement>) => {
        flip.current = e.altKey;
        drag.handlers.onPointerDown(e);
      }}
    >
      <svg viewBox="-1 -1 2 2" preserveAspectRatio="none" aria-hidden="true">
        <circle r="1" vectorEffect="non-scaling-stroke" className={s.ring} />
        <circle r="1" vectorEffect="non-scaling-stroke" className={s.track} />
        <line x1={at.x * 0.55} y1={-at.y * 0.55} x2={at.x} y2={-at.y} vectorEffect="non-scaling-stroke" className={s.ray} />
      </svg>
      <span
        className={cx(s.sun, behind && s.behind)}
        style={{ left: `${50 + at.x * 50}%`, top: `${50 - at.y * 50}%` }}
        tabIndex={0}
        role="slider"
        aria-label="Light direction"
        aria-valuemin={0}
        aria-valuemax={360}
        aria-valuenow={Math.round(light.azimuth)}
        aria-valuetext={`Direction ${Math.round(light.azimuth)}°, height ${Math.round(light.elevation)}°${behind ? ', behind the object' : ''}`}
        onKeyDown={onKeyDown}
        onPointerDown={(e) => e.currentTarget.focus({ preventScroll: true })}
        onDoubleClick={() => onKey(PRESETS[0].light)}
      >
        <Icon name="wb_sunny" size={18} fill={!behind} />
      </span>
    </div>
  );
}

/** the colours the ramp's look needs, as a Look: rebuilt only when the colours or the settings change */
export function useLook(ramp: { steps: Oklch[]; spec: RampSpec }, banded: boolean, ground: Oklch | null): Look {
  const { steps, spec } = ramp;
  const key = [steps.map((c) => c.join(' ')).join('|'), spec.material, spec.light.join(' '), JSON.stringify(spec.surface ?? null), banded, ground?.join(' ')].join('#');
  return useMemo(() => lookOf({ steps, material: spec.material, light: spec.light, surface: spec.surface, banded, surround: ground }), [key]);
}

/** what the pointer reads from each step, in words, lightest first */
function stepWords(swatches: Swatch[]): string[] {
  const at = swatches.map((w) => w.step ?? 0);
  return swatches.map((w, i) => {
    const word = stepWord(w.step ?? 0, Math.min(...at), Math.max(...at));
    return `${word[0].toUpperCase()}${word.slice(1)}, step ${i + 1} of ${swatches.length}, L ${fmtL(w.oklch[0])}`;
  });
}

/** the selected ramp on the shape; the sun's ring is over the stage */
function One({ ramp, shape, fold, light, banded, ground, scale }: { ramp: LitRamp; shape: Shape; fold: Fold; light: Light; banded: boolean; ground: Oklch | null; scale: number }) {
  const look = useLook(ramp, banded, ground);
  const words = useMemo(() => stepWords(ramp.swatches), [ramp.swatches]);
  return (
    <div className={s.one}>
      <LitCanvas shape={shape} fold={fold} size={BIG * scale} look={look} azimuth={light.azimuth} elevation={light.elevation} label={`${ramp.name} on ${SHAPE_NAME[shape]}`} words={words} className={s.object} />
    </div>
  );
}

/** Shape: All three: the selected ramp on a sphere, a cube and a cloth fold together */
function Three({ ramp, fold, light, banded, ground, scale }: { ramp: LitRamp; fold: Fold; light: Light; banded: boolean; ground: Oklch | null; scale: number }) {
  const look = useLook(ramp, banded, ground);
  const words = useMemo(() => stepWords(ramp.swatches), [ramp.swatches]);
  return (
    <div className={s.gridWrap}>
      <div className={s.three} data-three="">
        {ALL_SHAPES.map((shape) => (
          <LitCanvas key={shape} shape={shape} fold={fold} size={BIG * scale} look={look} azimuth={light.azimuth} elevation={light.elevation} label={`${ramp.name} on ${SHAPE_NAME[shape]}`} words={words} className={s.tcanvas} />
        ))}
      </div>
    </div>
  );
}

/** Show: All ramps: every ramp on the selected shape, a grid; picking one makes it the ramp the controls edit */
function Grid({ ramps, shape, fold, selected, light, banded, ground, scale, onSelect }: { ramps: LitRamp[]; shape: Shape; fold: Fold; selected: string; light: Light; banded: boolean; ground: Oklch | null; scale: number; onSelect(id: string): void }) {
  // one Tab stop; arrows move between the ramps and pick
  const onArrows = (e: KeyboardEvent<HTMLDivElement>) => {
    const step = { ArrowLeft: -1, ArrowUp: -1, ArrowRight: 1, ArrowDown: 1 }[e.key];
    if (!step) return;
    e.preventDefault();
    const i = (ramps.findIndex((r) => r.id === selected) + step + ramps.length) % ramps.length;
    onSelect(ramps[i].id);
    (e.currentTarget.children[i] as HTMLElement | undefined)?.focus();
  };
  const cols = ramps.length <= 2 ? ramps.length : ramps.length <= 4 ? 2 : ramps.length <= 9 ? 3 : 4;
  return (
    <div className={s.gridWrap}>
      <div className={s.grid} style={{ gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))`, '--rows': Math.ceil(ramps.length / cols) } as React.CSSProperties} role="radiogroup" aria-label="Ramps under the light" onKeyDown={onArrows}>
        {ramps.map((r) => (
          <GridCell key={r.id} ramp={r} shape={shape} fold={fold} on={r.id === selected} light={light} banded={banded} ground={ground} scale={scale} onSelect={onSelect} />
        ))}
      </div>
    </div>
  );
}

function GridCell({ ramp, shape, fold, on, light, banded, ground, scale, onSelect }: { ramp: LitRamp; shape: Shape; fold: Fold; on: boolean; light: Light; banded: boolean; ground: Oklch | null; scale: number; onSelect(id: string): void }) {
  const look = useLook(ramp, banded, ground);
  const words = useMemo(() => stepWords(ramp.swatches).map((w) => `${ramp.name}: ${w}`), [ramp.swatches, ramp.name]);
  return (
    <button type="button" role="radio" aria-checked={on} tabIndex={on ? 0 : -1} className={cx(s.gcell, on && s.on)} onClick={() => onSelect(ramp.id)}>
      <LitCanvas shape={shape} fold={fold} size={SMALL * scale} look={look} azimuth={light.azimuth} elevation={light.elevation} label={`${ramp.name} on ${SHAPE_NAME[shape]}`} words={words} className={s.gcanvas} />
      <span className={s.gname}>
        {ramp.hero && <Icon name="star" size={14} className={s.hero} />}
        {ramp.name}
      </span>
    </button>
  );
}

/** the pixels the lit canvas counts for stats: a small frame is enough to share out an object by step */
const STAT_SIZE = 160;

/** what a frame of the ramp on these shapes used: each step's area, the glow, the bounce */
function useStats(ramp: LitRamp, shapes: Shape[], fold: Fold, light: Light, banded: boolean, ground: Oklch | null): { stats: Stats; look: Look } {
  const look = useLook(ramp, banded, ground);
  const stats = useMemo(() => {
    const sum = newStats();
    const px = new Uint8ClampedArray(STAT_SIZE * STAT_SIZE * 4);
    for (const shape of shapes) {
      const one = newStats();
      shade(surface(shape, STAT_SIZE, fold), look, light, px, one);
      sum.total += one.total;
      sum.shine += one.shine;
      for (const k of ['steps', 'glow', 'bounce'] as const) one[k].forEach((x, i) => (sum[k][i] += x));
    }
    return sum;
  }, [look, shapes.join(), fold, light.azimuth, light.elevation]);
  return { stats, look };
}

/** how much of the object each step has under this light: a bar of the ramp's own steps, widths by share */
function StepUse({ ramp, shapes, fold, light, banded, ground }: { ramp: LitRamp; shapes: Shape[]; fold: Fold; light: Light; banded: boolean; ground: Oklch | null }) {
  const { stats, look } = useStats(ramp, shapes, fold, light, banded, ground);
  const n = ramp.steps.length;
  const glow = stats.glow.reduce((a, b) => a + b, 0);
  const glowing = glowColour(stats, look);
  const share = (x: number) => (stats.total ? x / stats.total : 0);
  return (
    <div className={s.use} aria-label="How much of the object each step has">
      <span className={s.useTitle}>Step use</span>
      <div className={s.useBar} data-step-use="">
        {ramp.steps.map((c, i) => (
          <i key={i} data-colour="" style={{ flexGrow: Math.max(share(stats.steps[i]), 0.0001), background: cssColor(c) }} />
        ))}
        {glowing && <i data-colour="" style={{ flexGrow: Math.max(share(glow), 0.0001), background: cssColor(glowing) }} />}
      </div>
      <span className={s.usePercent}>
        {Array.from({ length: n }, (_, i) => `${Math.round(share(stats.steps[i]) * 100)}`).join(' · ')}%{glow > 0 && ` · glow ${Math.round(share(glow) * 100)}%`}
      </span>
    </div>
  );
}

/** the colours this light needs that the palette doesn't have, as swatches, and one button to add them */
function Needs({ doc, d, ramp, shapes, fold, light, banded, ground }: { doc: Doc; d: IllustrationDoc; ramp: LitRamp; shapes: Shape[]; fold: Fold; light: Light; banded: boolean; ground: Oklch | null }) {
  // the colours of the ramp as it is: a vision lens shows others, but it is the real ones the palette takes
  const real = useMemo<LitRamp>(() => ({ ...ramp, steps: ramp.swatches.map((w) => w.oklch) }), [ramp]);
  const { stats, look } = useStats(real, shapes, fold, light, banded, ground);
  const have = d.swatches.map((w) => w.oklch);
  const list = neededColours(stats, look, have, ramp.name);
  if (!list.length) return null;
  const add = () =>
    doc.transact(list.length === 1 ? `Add ${list[0].name}` : `Add ${list.length} colours of the light on ${ramp.name}`, (x) => ({
      ...x,
      swatches: [...x.swatches, ...list.map((n): Swatch => ({ id: crypto.randomUUID(), name: n.name, role: null, oklch: n.oklch, type: 'process' }))],
    }));
  return (
    <InspectorGroup title="Colours this light needs" id="illustration.light.needs" meta={list.length}>
      <p className={s.hint}>The picture uses these, and the ramp has nothing near them.</p>
      <ul className={s.needs}>
        {list.map((n: Needed) => (
          <li key={n.name}>
            <i className={s.chip} data-colour="" style={{ background: cssColor(n.oklch) }} />
            <span className={s.needName}>
              {n.name}
              <small>{n.why}</small>
            </span>
            <span className={s.hex}>{toHex(n.oklch).toUpperCase()}</span>
          </li>
        ))}
      </ul>
      <Button size="xs" icon="add" onClick={add} className={s.every}>
        Add to palette
      </Button>
    </InspectorGroup>
  );
}

/** the lit shape, drawn at `size` pixels; hovering it reads which step the pixel under the pointer shows */
export const LitCanvas = memo(function LitCanvas(p: { shape: Shape; fold?: Fold; size: number; look: Look; azimuth: number; elevation: number; label: string; className?: string; words?: string[] }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const image = useRef<ImageData>(null);
  useLayoutEffect(() => {
    const ctx = ref.current?.getContext('2d');
    if (!ctx) return;
    if (image.current?.width !== p.size) image.current = new ImageData(p.size, p.size);
    shade(surface(p.shape, p.size, p.fold), p.look, p, image.current.data);
    ctx.putImageData(image.current, 0, 0);
  }, [p.shape, p.fold, p.size, p.look, p.azimuth, p.elevation]);
  const onMove = (e: PointerEvent<HTMLCanvasElement>) => {
    if (!p.words) return;
    const r = e.currentTarget.getBoundingClientRect();
    hover.set(textOf(read(surface(p.shape, p.size, p.fold), p.look, p, ((e.clientX - r.left) / r.width) * p.size, ((e.clientY - r.top) / r.height) * p.size), p.words));
  };
  return <canvas ref={ref} width={p.size} height={p.size} className={p.className} role="img" aria-label={p.label} data-colour="" onPointerMove={onMove} onPointerLeave={() => hover.set(null)} />;
});

/** the words for what a pixel reads */
function textOf(r: Reading, words: string[]): string | null {
  if (r.kind === 'step') return words[r.step] ?? null;
  if (r.kind === 'glow') return 'Glow: light coming through, a colour the ramp does not have';
  if (r.kind === 'shine') return 'Highlight in the light’s own colour, not a step of the ramp';
  return null;
}
