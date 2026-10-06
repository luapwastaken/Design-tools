// Tab 1, Ramp settings: how the selected ramp is made (steps, intensity, hue shift, saturation, hero,
// material, Rebuild base), its L / C / H curves (draggable), and how the steps are seen (Show,
// Surround, Seen as). The Light and shadow colours are in Light & preview, where the light is.
import { MATERIALS } from '../../../shared/palette/ramp.ts';
import type { RampSpec } from '../../../shared/types.ts';
import { Button, NumberField, Segmented, Select, Slider, Toggle, useDocNumber, InspectorRow } from '../../ui/index.ts';
import { SURROUNDS, surroundOf } from '../common/surround.ts';
import { rampsFromLoose, selected, type Doc } from './actions.ts';
import { Curves } from './Curves.tsx';
import { LIT_VIEW, LitCanvas, SHAPE_NAME, useLut } from './Light.tsx';
import { brokenSteps, rampName, rampOf, regen, setSpec, stepsOf, type IllustrationDoc } from './doc.ts';
import { proofOf, PROOFS, type Proof } from './proof.ts';
import { patchView, shaped, type IllustrationView } from './view-state.ts';
import s from './RampSettings.module.css';

const INTENSITIES: { value: RampSpec['intensity']; label: string; tip: string }[] = [
  { value: 'grounded', label: 'Grounded', tip: 'Close to what the material does under this light' },
  { value: 'expressive', label: 'Expressive', tip: 'Pushed: more hue shift and chroma, as a painter would' },
  { value: 'extreme', label: 'Extreme', tip: 'As far as it goes: stylised light' },
];
const MATERIAL_OPTIONS = MATERIALS.map((m) => ({ value: m.id, label: m.label }));
const SHOWS: { value: IllustrationView['show']; label: string }[] = [
  { value: 'hex', label: 'Word and hex' },
  { value: 'name', label: 'Name' },
  { value: 'off', label: 'Off' },
];

export function RampSettings({ doc, d, v }: { doc: Doc; d: IllustrationDoc; v: IllustrationView }) {
  const w = selected(d, v.selected);
  const r = rampOf(d, w?.group);
  return (
    <div className={s.tab}>
      {!w ? (
        <p className={s.quiet}>Add a base colour, and the settings for its ramp are here.</p>
      ) : !r ? (
        <div className={s.loose}>
          <p className={s.quiet}>This colour is in no ramp. Make one from it, and its steps, curves and settings are here.</p>
          <Button icon="auto_awesome_motion" onClick={() => rampsFromLoose(doc, [w.id])}>
            Make a ramp from it
          </Button>
        </div>
      ) : (
        <div className={s.split}>
          <div className={s.controls}>
            <RampControls key={r.id} doc={doc} d={d} r={r} />
            <Curves doc={doc} d={d} v={v} />
          </div>
          <LivePreview d={d} v={v} r={r} />
        </div>
      )}
      {w && <ViewControls d={d} v={v} />}
    </div>
  );
}

/** the selected ramp lit, beside its settings: hue shift, chroma, intensity and steps show at once (the light is set in Light & preview) */
function LivePreview({ d, v, r }: { d: IllustrationDoc; v: IllustrationView; r: RampSpec }) {
  const view = shaped(v.preview, LIT_VIEW);
  const shape = view.shape === 'all' ? 'sphere' : view.shape;
  const name = rampName(d, r);
  const lut = useLut(stepsOf(d, r.id).map((w) => proofOf(w.oklch, v.proof)), view.banded);
  return (
    <aside className={s.live} aria-label="The ramp, lit" data-live-preview="" style={{ background: surroundOf(v.surround, d.swatches) }}>
      <LitCanvas shape={shape} size={240} lut={lut} azimuth={view.azimuth} elevation={view.elevation} label={`${name} on ${SHAPE_NAME[shape]}`} className={s.litCanvas} />
      <span className={s.liveCap}>{name}, lit</span>
    </aside>
  );
}

function RampControls({ doc, d, r }: { doc: Doc; d: IllustrationDoc; r: RampSpec }) {
  const name = rampName(d, r);
  const list = stepsOf(d, r.id);
  const baseless = !list.some((x) => x.step === 0);
  const broken = brokenSteps(list).length;
  const spec = (x: IllustrationDoc) => rampOf(x, r.id) ?? r;
  const set = (label: string, patch: Partial<RampSpec>) => doc.transact(`${label} of ${name}`, (x) => setSpec(x, r.id, patch));
  const steps = useDocNumber(doc, { label: `Change the steps of ${name}`, key: `${r.id}:steps`, get: (x) => spec(x).steps, set: (x, n) => setSpec(x, r.id, { steps: n }) });
  const hue = useDocNumber(doc, { label: `Change the hue shift of ${name}`, key: `${r.id}:hue`, get: (x) => spec(x).hueShift, set: (x, n) => setSpec(x, r.id, { hueShift: n }) });
  const chroma = useDocNumber(doc, { label: `Change the chroma curve of ${name}`, key: `${r.id}:chroma`, get: (x) => spec(x).chromaCurve, set: (x, n) => setSpec(x, r.id, { chromaCurve: n }) });
  // the split the ramp actually has: near white or black every step goes to the side with room
  const made = list.map((x) => x.step ?? 0);
  const lighter = made.filter((n) => n < 0).length;
  const material = MATERIALS.find((m) => m.id === r.material);
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
      {broken > 0 && <p className={s.bad}>A step is as light as the one before it: value should fall from highlight to deep shadow.</p>}
      <div className={s.grid}>
        <InspectorRow label="Steps">
          <NumberField label="Steps" hideLabel min={3} max={9} step={1} width={70} {...steps} />
          <span className={s.dim}>
            {lighter} lighter, {made.length - 1 - lighter} darker
          </span>
        </InspectorRow>
        <Segmented label="Intensity" fit options={INTENSITIES} value={r.intensity} onChange={(intensity) => set('Change the intensity', { intensity })} />
        <Slider label="Hue shift" info="How far the light and shadow steps turn toward the light and shadow colours." min={-1} max={1} step={0.05} fieldWidth={70} {...hue} />
        <Slider label="Saturation" info="Bends how chroma falls away toward the light and the shadow." min={-1} max={1} step={0.05} fieldWidth={70} {...chroma} />
        <InspectorRow label="Hero ramp">
          <Toggle label="Quieten the other ramps" checked={r.hero} onChange={(hero) => doc.transact(hero ? `Make ${name} the hero` : `End ${name} as hero`, (x) => setSpec(x, r.id, { hero }))} />
        </InspectorRow>
        <InspectorRow label="Material" info={material?.describe}>
          <Select options={MATERIAL_OPTIONS} value={r.material} onChange={(m) => set('Change the material', { material: m })} />
        </InspectorRow>
      </div>
      <p className={s.hint}>Edit any step and it keeps your colour; Regenerate rebuilds the ramp from the base.</p>
    </>
  );
}

/** how the steps are seen: display only, the palette is untouched */
function ViewControls({ d, v }: { d: IllustrationDoc; v: IllustrationView }) {
  return (
    <div className={s.view}>
      <h3 className={s.vtitle}>How the steps are seen</h3>
      <div className={s.grid}>
        <InspectorRow label="Show">
          <Select options={SHOWS} value={v.show} onChange={(show) => patchView({ show })} />
        </InspectorRow>
        <InspectorRow label="Steps sit on">
          <Select options={SURROUNDS.map((o) => ({ value: o.value, label: o.label, swatch: surroundOf(o.value, d.swatches) }))} value={v.board} onChange={(board) => patchView({ board })} />
        </InspectorRow>
        <InspectorRow label="Seen as">
          <Select options={PROOFS} value={v.proof} onChange={(proof: Proof) => patchView({ proof })} />
        </InspectorRow>
      </div>
    </div>
  );
}
