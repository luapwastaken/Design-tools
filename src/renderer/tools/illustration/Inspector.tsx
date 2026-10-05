// The inspector (all modes): the same groups with the same meaning, in the order and openness the
// mode wants. Step colour is the selected swatch (the picker follows the app-wide style: Square by
// default, the L x C plane as OKLCH); Ramp and Light & shadow are per ramp, as they always were.
import type { ReactNode } from 'react';
import { cssColor, toHex } from '../../../shared/color/index.ts';
import { MATERIALS } from '../../../shared/palette/ramp.ts';
import type { RampSpec, Swatch } from '../../../shared/types.ts';
import { Button, ColorField, IconButton, InspectorGroup, InspectorRow, NumberField, Picker, Segmented, Select, Slider, TextInput, Toggle, useDocColour, useDocNumber } from '../../ui/index.ts';
import { displayName, fmtL } from '../common/names.ts';
import { lightEveryRamp, rampsFromLoose, selected, type Doc } from './actions.ts';
import { brokenSteps, nameOf, rampName, rampOf, recolour, regen, renameSwatch, revertRamp, revertStep, setSpec, stepsOf, wordOf, type IllustrationDoc } from './doc.ts';
import type { IllustrationView } from './view-state.ts';
import s from './Inspector.module.css';

type Mode = IllustrationView['tab'];
type Props = { doc: Doc; d: IllustrationDoc; v: IllustrationView };

const INTENSITIES: { value: RampSpec['intensity']; label: string; tip: string }[] = [
  { value: 'grounded', label: 'Grounded', tip: 'Close to what the material does under this light' },
  { value: 'expressive', label: 'Expressive', tip: 'Pushed: more hue shift and chroma, as a painter would' },
  { value: 'extreme', label: 'Extreme', tip: 'As far as it goes: stylised light' },
];
const MATERIAL_OPTIONS = MATERIALS.map((m) => ({ value: m.id, label: m.label }));
const same = (a: number[], b: number[]) => a.every((x, i) => x === b[i]);

/** which groups are open in a mode: the mode decides what is open, not what exists */
const OPEN: Record<Mode, { step: boolean; ramp: boolean; light: boolean }> = {
  ramps: { step: true, ramp: true, light: false },
  light: { step: true, ramp: true, light: true },
  check: { step: true, ramp: false, light: false },
  paint: { step: true, ramp: false, light: false },
};

/** Step colour, Ramp, Light & shadow, in the mode's order; `lead` goes first (Checks, the Mixer) */
export function Groups({ doc, d, v, lead }: Props & { lead?: ReactNode }) {
  const open = OPEN[v.tab];
  const step = <StepGroup key={`step-${v.tab}`} doc={doc} d={d} v={v} open={open.step} />;
  const ramp = <RampGroup key={`ramp-${v.tab}`} doc={doc} d={d} v={v} open={open.ramp} />;
  const light = <LightGroup key={`light-${v.tab}`} doc={doc} d={d} v={v} open={open.light} />;
  return (
    <>
      {lead}
      {v.tab === 'light' ? [step, light, ramp] : [step, ramp, light]}
    </>
  );
}

/** The selected colour: its name, where it sits, and the picker. */
function StepGroup({ doc, d, v, open }: Props & { open: boolean }) {
  const w = selected(d, v.selected);
  const r = rampOf(d, w?.group);
  if (!w) return null;
  const steps = r ? stepsOf(d, r.id) : [];
  const at = steps.findIndex((x) => x.id === w.id);
  const where = r ? `${rampName(d, r)} · step ${at + 1} of ${steps.length}${w.step === 0 ? ' · base' : ''}` : `${nameOf(d, w)} · in no ramp`;
  return (
    <InspectorGroup
      title="Step colour"
      sub={where}
      meta={toHex(w.oklch).toUpperCase()}
      actions={w.edited && <IconButton icon="restart_alt" label="Back to what the ramp makes" size="sm" onClick={() => doc.transact(`Regenerate ${nameOf(d, w)}`, (x) => revertStep(x, w.id))} />}
      defaultOpen={open}
    >
      <Editor key={w.id} doc={doc} d={d} w={w} r={r} />
    </InspectorGroup>
  );
}

function Editor({ doc, d, w, r }: { doc: Doc; d: IllustrationDoc; w: Swatch; r: RampSpec | null }) {
  const name = nameOf(d, w);
  const word = wordOf(d, w);
  const colour = useDocColour(doc, {
    label: `Change ${name}`,
    key: `${w.id}:colour`,
    get: (x) => x.swatches.find((y) => y.id === w.id)?.oklch ?? w.oklch,
    set: (x, o) => recolour(x, w.id, o),
  });
  // what an edit here does: the base moves the ramp, any other step keeps your colour
  const note = !r ? 'In no ramp: make one from it in the Ramp group.' : w.step === 0 ? 'Base: the ramp follows it.' : w.edited ? 'Edited by hand: the ramp leaves it when it changes.' : 'Made by the ramp: an edit here keeps your colour.';
  return (
    <div className={s.editor}>
      <div className={s.ident}>
        <i className={s.big} style={{ background: cssColor(colour.value) }} />
        <div className={s.fields}>
          <TextInput className={s.name} value={w.name} placeholder={w.name.trim() ? undefined : name} onCommit={(t) => doc.transact(`Rename ${name}`, (x) => renameSwatch(x, w.id, t.trim()))} />
          <span className={s.where}>
            L {fmtL(w.oklch[0])}
            {word ? ` · ${word}` : ''}
            {w.edited ? ' · edited' : ''}
          </span>
        </div>
      </div>
      <Picker {...colour} />
      <p className={s.note}>{note}</p>
    </div>
  );
}

/** Steps, hue shift, chroma, intensity, hero: per ramp. A colour in no ramp offers to make one. */
function RampGroup({ doc, d, v, open }: Props & { open: boolean }) {
  const w = selected(d, v.selected);
  const r = rampOf(d, w?.group);
  if (!w) return null;
  if (!r)
    return (
      <InspectorGroup title="Ramp" sub="none" defaultOpen>
        <Button icon="auto_awesome_motion" onClick={() => rampsFromLoose(doc, [w.id])}>
          Make a ramp from it
        </Button>
      </InspectorGroup>
    );
  const steps = stepsOf(d, r.id);
  const edited = steps.filter((x) => x.edited).length;
  const name = rampName(d, r);
  return (
    <InspectorGroup
      title="Ramp"
      sub={name}
      actions={
        <Button size="xs" variant="ghost" icon="restart_alt" disabled={!edited} onClick={() => doc.transact(`Regenerate ${name}`, (x) => revertRamp(x, r.id))} tooltip="Every hand-edited step goes back to what the ramp makes">
          {edited ? `Regenerate (${edited} edited)` : 'Regenerate'}
        </Button>
      }
      defaultOpen={open}
    >
      <RampControls key={r.id} doc={doc} d={d} r={r} baseless={!steps.some((x) => x.step === 0)} broken={brokenSteps(steps).length} />
    </InspectorGroup>
  );
}

function RampControls({ doc, d, r, baseless, broken }: { doc: Doc; d: IllustrationDoc; r: RampSpec; baseless: boolean; broken: number }) {
  const name = rampName(d, r);
  const spec = (x: IllustrationDoc) => rampOf(x, r.id) ?? r;
  const set = (label: string, patch: Partial<RampSpec>) => doc.transact(`${label} of ${name}`, (x) => setSpec(x, r.id, patch));
  const steps = useDocNumber(doc, { label: `Change the steps of ${name}`, key: `${r.id}:steps`, get: (x) => spec(x).steps, set: (x, n) => setSpec(x, r.id, { steps: n }) });
  const hue = useDocNumber(doc, { label: `Change the hue shift of ${name}`, key: `${r.id}:hue`, get: (x) => spec(x).hueShift, set: (x, n) => setSpec(x, r.id, { hueShift: n }) });
  const chroma = useDocNumber(doc, { label: `Change the chroma curve of ${name}`, key: `${r.id}:chroma`, get: (x) => spec(x).chromaCurve, set: (x, n) => setSpec(x, r.id, { chromaCurve: n }) });
  // the split the ramp actually has: near white or black every step goes to the side with room
  const made = stepsOf(d, r.id).map((x) => x.step ?? 0);
  const lighter = made.filter((n) => n < 0).length;
  return (
    <>
      {baseless && (
        <div className={s.warn}>
          <span>Another tool removed this ramp's base.</span>
          <Button size="xs" icon="restart_alt" onClick={() => doc.transact(`Rebuild ${name}`, (x) => regen(x, r.id))} tooltip="Rebuild makes the base again from the ramp's own colour.">
            Rebuild base
          </Button>
        </div>
      )}
      {broken > 0 && <p className={s.bad}>A step is as light as the one before it: lightness should fall from highlight to deep shadow.</p>}
      <InspectorRow label="Steps">
        <NumberField label="Steps" hideLabel min={3} max={9} step={1} width={70} {...steps} />
        <span className={s.dim}>
          {lighter} up, {made.length - 1 - lighter} down
        </span>
      </InspectorRow>
      <Slider label="Hue shift" info="How far the light and shadow steps turn toward the light and shadow colours." min={-1} max={1} step={0.05} fieldWidth={70} {...hue} />
      <Slider label="Chroma" info="Bends how chroma falls away toward the light and the shadow." min={-1} max={1} step={0.05} fieldWidth={70} {...chroma} />
      <Segmented label="Intensity" fit options={INTENSITIES} value={r.intensity} onChange={(intensity) => set('Change the intensity', { intensity })} />
      <InspectorRow label="Hero">
        <Toggle label="Quieten the other ramps" checked={r.hero} onChange={(hero) => doc.transact(hero ? `Make ${name} the hero` : `End ${name} as hero`, (x) => setSpec(x, r.id, { hero }))} />
      </InspectorRow>
    </>
  );
}

/** Light colour, shadow colour, material: per ramp. */
function LightGroup({ doc, d, v, open }: Props & { open: boolean }) {
  const w = selected(d, v.selected);
  const r = rampOf(d, w?.group);
  if (!r) return null;
  return (
    <InspectorGroup title="Light & shadow" sub={rampName(d, r)} defaultOpen={open}>
      <LightControls key={r.id} doc={doc} d={d} r={r} />
    </InspectorGroup>
  );
}

function LightControls({ doc, d, r }: { doc: Doc; d: IllustrationDoc; r: RampSpec }) {
  const name = rampName(d, r);
  const spec = (x: IllustrationDoc) => rampOf(x, r.id) ?? r;
  const light = useDocColour(doc, { label: `Change the light of ${name}`, key: `${r.id}:light`, get: (x) => spec(x).light, set: (x, o) => setSpec(x, r.id, { light: o }) });
  const shadow = useDocColour(doc, { label: `Change the shadow of ${name}`, key: `${r.id}:shadow`, get: (x) => spec(x).shadow, set: (x, o) => setSpec(x, r.id, { shadow: o }) });
  const material = MATERIALS.find((m) => m.id === r.material);
  const shared = d.ramps.every((x) => same(x.light, r.light) && same(x.shadow, r.shadow));
  return (
    <>
      <InspectorRow label="Light" info="Lighter steps lean toward this colour.">
        <ColorField {...light} name={displayName({ name: '', oklch: light.value })} />
      </InspectorRow>
      <InspectorRow label="Shadow" info="Darker steps lean toward this colour.">
        <ColorField {...shadow} name={displayName({ name: '', oklch: shadow.value })} />
      </InspectorRow>
      <InspectorRow label="Material" info={material?.describe}>
        <Select label="" options={MATERIAL_OPTIONS} value={r.material} onChange={(m) => doc.transact(`Change the material of ${name}`, (x) => setSpec(x, r.id, { material: m }))} />
      </InspectorRow>
      {d.ramps.length > 1 && (
        <Button
          size="xs"
          variant="ghost"
          icon="wb_sunny"
          disabled={shared}
          onClick={() => lightEveryRamp(doc, r.id)}
          tooltip={shared ? 'Every ramp is lit this way already' : 'One scene, one light: every ramp takes this light and shadow colour'}
          className={s.every}
        >
          Use for every ramp
        </Button>
      )}
    </>
  );
}

