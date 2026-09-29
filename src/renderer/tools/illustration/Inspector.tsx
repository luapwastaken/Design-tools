// The inspector (spec §2): the selected step or base in the shared picker, then the Light controls
// of its ramp. Export docks below them (View).
import { cssColor } from '../../../shared/color/index.ts';
import { MATERIALS } from '../../../shared/palette/ramp.ts';
import type { RampSpec, Swatch } from '../../../shared/types.ts';
import { cx } from '../../ui/cx.ts';
import { Button, ColorField, IconButton, Module, NumberField, Picker, PickerModes, Segmented, Select, Slider, TextInput, Toggle, useDocColour, useDocNumber } from '../../ui/index.ts';
import { displayName, fmtL } from '../common/names.ts';
import { lightEveryRamp, rampsFromLoose, selected, type Doc } from './actions.ts';
import { nameOf, rampName, rampOf, recolour, renameSwatch, revertRamp, revertStep, setSpec, stepsOf, wordOf, type IllustrationDoc } from './doc.ts';
import { patchView, type IllustrationView } from './view-state.ts';
import s from './Inspector.module.css';

const INTENSITIES: { value: RampSpec['intensity']; label: string; tip: string }[] = [
  { value: 'grounded', label: 'Grounded', tip: 'Close to what the material does under this light' },
  { value: 'expressive', label: 'Expressive', tip: 'Pushed: more hue shift and chroma, as a painter would' },
  { value: 'extreme', label: 'Extreme', tip: 'As far as it goes: stylised light' },
];
const MATERIAL_OPTIONS = MATERIALS.map((m) => ({ value: m.id, label: m.label }));
const same = (a: number[], b: number[]) => a.every((v, i) => v === b[i]);

/** The selected colour: its name, where it sits, and the picker. */
export function StepInspector({ doc, d, v }: { doc: Doc; d: IllustrationDoc; v: IllustrationView }) {
  const w = selected(d, v.selected);
  const r = rampOf(d, w?.group);
  const word = w && wordOf(d, w);
  return (
    <Module
      title={r ? (w?.step === 0 ? 'Base' : 'Step') : 'Colour'}
      sub={w ? (r && w.step !== 0 ? `${rampName(d, r)} · ${word}` : nameOf(d, w)) : undefined}
      actions={
        w && (
          <>
            <PickerModes value={v.picker} onChange={(picker) => patchView({ picker })} />
            {w.edited && <IconButton icon="restart_alt" label="Back to what the ramp makes" size="sm" onClick={() => doc.transact(`Regenerate ${nameOf(d, w)}`, (x) => revertStep(x, w.id))} />}
          </>
        )
      }
    >
      {!w ? <p className={s.hint}>Add a base colour, then pick any step here to edit it.</p> : <Editor key={w.id} doc={doc} d={d} w={w} r={r} v={v} />}
    </Module>
  );
}

function Editor({ doc, d, w, r, v }: { doc: Doc; d: IllustrationDoc; w: Swatch; r: RampSpec | null; v: IllustrationView }) {
  const name = nameOf(d, w);
  const colour = useDocColour(doc, {
    label: `Change ${name}`,
    key: `${w.id}:colour`,
    get: (x) => x.swatches.find((y) => y.id === w.id)?.oklch ?? w.oklch,
    set: (x, o) => recolour(x, w.id, o),
  });
  const steps = r ? stepsOf(d, r.id) : [];
  const at = steps.findIndex((x) => x.id === w.id);
  // what an edit here does: the base moves the ramp, any other step keeps your colour
  const note = !r ? 'In no ramp. Make a ramp from it in the Light panel, or from the row’s menu.' : w.step === 0 ? 'The base: the ramp follows it.' : w.edited ? 'Edited by hand: the ramp leaves it when it changes.' : 'Made by the ramp. An edit here keeps your colour.';
  return (
    <div className={s.editor}>
      <div className={s.ident}>
        <i className={s.big} style={{ background: cssColor(colour.value) }} />
        <div className={s.fields}>
          <TextInput
            value={w.name}
            placeholder={w.name.trim() ? undefined : name}
            onCommit={(t) => doc.transact(`Rename ${name}`, (x) => renameSwatch(x, w.id, t.trim()))}
          />
          <span className={s.where}>
            {r ? (
              <>
                <span className="lbl">
                  Step {at + 1} of {steps.length}
                </span>
                <span className={s.dot}>·</span>
                <span className="lbl">L {fmtL(w.oklch[0])}</span>
                {w.edited && (
                  <>
                    <span className={s.dot}>·</span>
                    <span className={cx('lbl', s.edited)}>Edited</span>
                  </>
                )}
              </>
            ) : (
              <span className="lbl">Not in a ramp</span>
            )}
          </span>
        </div>
      </div>
      <Picker {...colour} mode={v.picker} onMode={(picker) => patchView({ picker })} />
      <p className={s.note}>{note}</p>
    </div>
  );
}

/** The Light panel (spec §3.1) for the selected ramp: every change regenerates its unedited steps, one undo step each. */
export function LightInspector({ doc, d, v }: { doc: Doc; d: IllustrationDoc; v: IllustrationView }) {
  const w = selected(d, v.selected);
  const r = rampOf(d, w?.group);
  const edited = r ? stepsOf(d, r.id).filter((x) => x.edited).length : 0;
  return (
    <Module
      title="Light"
      sub={r ? rampName(d, r) : undefined}
      actions={r && edited > 0 && <IconButton icon="restart_alt" label={`Back to generated: ${edited} edited step${edited === 1 ? '' : 's'}`} size="sm" onClick={() => doc.transact(`Regenerate ${rampName(d, r)}`, (x) => revertRamp(x, r.id))} />}
    >
      {r ? (
        <LightControls key={r.id} doc={doc} d={d} r={r} />
      ) : w ? (
        <div className={s.loose}>
          <p className={s.hint}>This colour is in no ramp yet. As a base, it grows one from highlight to deep shadow.</p>
          <Button icon="auto_awesome_motion" onClick={() => rampsFromLoose(doc, [w.id])}>
            Make a ramp from it
          </Button>
        </div>
      ) : (
        <p className={s.hint}>Add a base colour to light it.</p>
      )}
    </Module>
  );
}

function LightControls({ doc, d, r }: { doc: Doc; d: IllustrationDoc; r: RampSpec }) {
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
      <div className={s.pair}>
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
            Use this light for every ramp
          </Button>
        )}
      </div>
      <div className={s.block}>
        <Select label="Material" options={MATERIAL_OPTIONS} value={r.material} onChange={(m) => set('Change the material', { material: m })} />
        {material && <p className={s.describe}>{material.describe}</p>}
      </div>
      <Segmented label="Intensity" options={INTENSITIES} value={r.intensity} onChange={(intensity) => set('Change the intensity', { intensity })} />
      <div className={s.row}>
        <span className={cx('lbl', s.lab)}>Steps</span>
        <NumberField label="Steps" hideLabel min={3} max={9} step={1} width={88} {...steps} />
        <span className={s.dim}>
          {lighter} lighter, {made.length - 1 - lighter} darker
        </span>
      </div>
      <Slider label="Hue shift" min={-1} max={1} step={0.05} {...hue} />
      <Slider label="Chroma curve" min={-1} max={1} step={0.05} {...chroma} />
      <div className={s.hero}>
        <Toggle label="Hero colour" checked={r.hero} onChange={(hero) => doc.transact(hero ? `Make ${name} the hero` : `End ${name} as hero`, (x) => setSpec(x, r.id, { hero }))} />
        <span className={s.dim}>The other ramps’ steps quieten; their bases stay as picked</span>
      </div>
    </div>
  );
}
