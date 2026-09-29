// The selected ramp's lighting (spec §3.1), beside the lit shapes it changes: every change
// regenerates the ramp's unedited steps, one undo step each.
import { MATERIALS } from '../../../shared/palette/ramp.ts';
import type { RampSpec } from '../../../shared/types.ts';
import { cx } from '../../ui/cx.ts';
import { Button, ColorField, IconButton, Module, NumberField, Segmented, Select, Slider, Toggle, useDocColour, useDocNumber } from '../../ui/index.ts';
import { displayName } from '../common/names.ts';
import { lightEveryRamp, rampsFromLoose, selected, type Doc } from './actions.ts';
import { rampName, rampOf, revertRamp, setSpec, stepsOf, type IllustrationDoc } from './doc.ts';
import type { IllustrationView } from './view-state.ts';
import s from './Lighting.module.css';

const INTENSITIES: { value: RampSpec['intensity']; label: string; tip: string }[] = [
  { value: 'grounded', label: 'Grounded', tip: 'Close to what the material does under this light' },
  { value: 'expressive', label: 'Expressive', tip: 'Pushed: more hue shift and chroma, as a painter would' },
  { value: 'extreme', label: 'Extreme', tip: 'As far as it goes: stylised light' },
];
const MATERIAL_OPTIONS = MATERIALS.map((m) => ({ value: m.id, label: m.label }));
const same = (a: number[], b: number[]) => a.every((v, i) => v === b[i]);

export function Lighting({ doc, d, v, className }: { doc: Doc; d: IllustrationDoc; v: IllustrationView; className?: string }) {
  const w = selected(d, v.selected);
  const r = rampOf(d, w?.group);
  const edited = r ? stepsOf(d, r.id).filter((x) => x.edited).length : 0;
  return (
    <Module
      title="Lighting"
      sub={r ? rampName(d, r) : undefined}
      actions={r && edited > 0 && <IconButton icon="restart_alt" label={`Back to generated: ${edited} edited step${edited === 1 ? '' : 's'}`} size="sm" onClick={() => doc.transact(`Regenerate ${rampName(d, r)}`, (x) => revertRamp(x, r.id))} />}
      scroll
      className={className}
    >
      {r ? (
        <Controls key={r.id} doc={doc} d={d} r={r} />
      ) : (
        w && (
          <div className={s.loose}>
            <p className={s.hint}>This colour is in no ramp yet. As a base, it grows one from highlight to deep shadow.</p>
            <Button icon="auto_awesome_motion" onClick={() => rampsFromLoose(doc, [w.id])}>
              Make a ramp from it
            </Button>
          </div>
        )
      )}
    </Module>
  );
}

function Controls({ doc, d, r }: { doc: Doc; d: IllustrationDoc; r: RampSpec }) {
  const name = rampName(d, r);
  const spec = (x: IllustrationDoc) => rampOf(x, r.id) ?? r;
  const set = (label: string, patch: Partial<RampSpec>) => doc.transact(`${label} of ${name}`, (x) => setSpec(x, r.id, patch));
  const light = useDocColour(doc, { label: `Change the light of ${name}`, key: `${r.id}:light`, get: (x) => spec(x).light, set: (x, o) => setSpec(x, r.id, { light: o }) });
  const shadow = useDocColour(doc, { label: `Change the shadow of ${name}`, key: `${r.id}:shadow`, get: (x) => spec(x).shadow, set: (x, o) => setSpec(x, r.id, { shadow: o }) });
  const steps = useDocNumber(doc, { label: `Change the steps of ${name}`, key: `${r.id}:steps`, get: (x) => spec(x).steps, set: (x, n) => setSpec(x, r.id, { steps: n }) });
  const hue = useDocNumber(doc, { label: `Change the hue shift of ${name}`, key: `${r.id}:hue`, get: (x) => spec(x).hueShift, set: (x, n) => setSpec(x, r.id, { hueShift: n }) });
  const chroma = useDocNumber(doc, { label: `Change the chroma curve of ${name}`, key: `${r.id}:chroma`, get: (x) => spec(x).chromaCurve, set: (x, n) => setSpec(x, r.id, { chromaCurve: n }) });
  const material = MATERIALS.find((m) => m.id === r.material);
  // the split the ramp actually has: near white or black every step goes to the side with room
  const made = stepsOf(d, r.id).map((w) => w.step ?? 0);
  const lighter = made.filter((n) => n < 0).length;
  const shared = d.ramps.every((x) => same(x.light, r.light) && same(x.shadow, r.shadow));
  return (
    <div className={s.light}>
      <div className={s.group}>
        <div className={s.row}>
          <span className={cx('lbl', s.lab)}>Light</span>
          <ColorField {...light} name={displayName({ name: '', oklch: light.value })} className={s.grow} />
        </div>
        <div className={s.row}>
          <span className={cx('lbl', s.lab)}>Shadow</span>
          <ColorField {...shadow} name={displayName({ name: '', oklch: shadow.value })} className={s.grow} />
        </div>
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
      </div>
      <div className={s.group}>
        <Select label="Material" options={MATERIAL_OPTIONS} value={r.material} onChange={(m) => set('Change the material', { material: m })} />
        {material && <p className={s.describe}>{material.describe}</p>}
      </div>
      <Segmented label="Intensity" options={INTENSITIES} value={r.intensity} onChange={(intensity) => set('Change the intensity', { intensity })} />
      <div className={s.row}>
        <span className={cx('lbl', s.lab)}>Steps</span>
        <NumberField label="Steps" hideLabel min={3} max={9} step={1} width={70} {...steps} />
        <span className={s.dim}>
          {lighter} lighter, {made.length - 1 - lighter} darker
        </span>
      </div>
      <Slider label="Hue shift" min={-1} max={1} step={0.05} fieldWidth={70} {...hue} />
      <Slider label="Chroma" min={-1} max={1} step={0.05} fieldWidth={70} {...chroma} />
      <div className={s.row}>
        <span className={cx('lbl', s.lab)}>Hero</span>
        <Toggle label="Quieten the other ramps" checked={r.hero} onChange={(hero) => doc.transact(hero ? `Make ${name} the hero` : `End ${name} as hero`, (x) => setSpec(x, r.id, { hero }))} />
      </div>
    </div>
  );
}
