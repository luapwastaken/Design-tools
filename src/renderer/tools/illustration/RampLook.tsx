// How a ramp looks: its material, how far it is pushed (Grounded, Expressive, Extreme, and every
// Push between), hue shift and saturation. Light & preview holds them, where
// every tick relights the big object. Each edit is one undo
// step; a drag is one step.
import { intensityAt, MATERIALS, pushOf } from '../../../shared/palette/ramp.ts';
import type { RampSpec } from '../../../shared/types.ts';
import { InspectorRow, Segmented, Select, Slider, useDocNumber } from '../../ui/index.ts';
import { rampName, rampOf, setSpec, type IllustrationDoc } from './doc.ts';
import type { Doc } from './actions.ts';
import { FINISH_PRESETS, finishPresetOf } from './finish.ts';

const INTENSITIES: { value: RampSpec['intensity']; label: string; tip: string }[] = [
  { value: 'grounded', label: 'Grounded', tip: 'Close to what the material does under this light' },
  { value: 'expressive', label: 'Expressive', tip: 'Pushed: more hue shift and chroma, as a painter would' },
  { value: 'extreme', label: 'Extreme', tip: 'As far as it goes: stylised light' },
];
const MATERIAL_OPTIONS = MATERIALS.map((m) => ({ value: m.id, label: m.label }));
const FINISH_OPTIONS = [{ value: 'own', label: 'Material’s own' }, ...FINISH_PRESETS.map((p) => ({ value: p.id, label: p.label }))];

/** the rows, for a group or a grid to hold: Material, Finish, Intensity, Push, Hue shift, Saturation */
export function RampLook({ doc, d, r }: { doc: Doc; d: IllustrationDoc; r: RampSpec }) {
  const name = rampName(d, r);
  const spec = (x: IllustrationDoc) => rampOf(x, r.id) ?? r;
  const hue = useDocNumber(doc, { label: `Change the hue shift of ${name}`, key: `${r.id}:hue`, get: (x) => spec(x).hueShift, set: (x, n) => setSpec(x, r.id, { hueShift: n }) });
  const chroma = useDocNumber(doc, { label: `Change the chroma curve of ${name}`, key: `${r.id}:chroma`, get: (x) => spec(x).chromaCurve, set: (x, n) => setSpec(x, r.id, { chromaCurve: n }) });
  // a percentage of the way from Grounded (0) to Extreme (200); it also sets the intensity nearest, so the segments follow it
  const push = useDocNumber(doc, { label: `Change the push of ${name}`, key: `${r.id}:push`, get: (x) => Math.round(pushOf(spec(x)) * 100), set: (x, n) => setSpec(x, r.id, { push: n / 100, intensity: intensityAt(n / 100) }) });
  const material = MATERIALS.find((m) => m.id === r.material);
  const finish = finishPresetOf(r);
  return (
    <>
      <InspectorRow label="Material" info={material?.describe}>
        {/* a new material starts from its own finish: the Surface numbers of the old one go */}
        <Select options={MATERIAL_OPTIONS} value={r.material} onChange={(m) => doc.transact(`Change the material of ${name}`, (x) => setSpec(x, r.id, { material: m, surface: undefined }))} />
      </InspectorRow>
      <InspectorRow label="Finish" info="Satin, Silk, Linen and Gold set the Surface numbers for you (Gold also makes it Metal). Grain stretches the highlight into a streak, and Streak in Surface says which way it runs.">
        <Select
          options={finish === 'custom' ? [...FINISH_OPTIONS, { value: 'custom', label: 'Custom' }] : FINISH_OPTIONS}
          value={finish}
          onChange={(id) => {
            const p = FINISH_PRESETS.find((x) => x.id === id);
            doc.transact(p ? `Give ${name} a ${p.label.toLowerCase()} finish` : `Give ${name} its material’s finish`, (x) => setSpec(x, r.id, { material: p?.material ?? spec(x).material, surface: p?.surface }));
          }}
        />
      </InspectorRow>
      <Segmented
        label="Intensity"
        fit
        options={INTENSITIES}
        value={r.intensity}
        onChange={(intensity) => doc.transact(`Change the intensity of ${name}`, (x) => setSpec(x, r.id, { intensity, push: undefined }))}
      />
      <Slider label="Push" info="How far the ramp is pushed between Grounded (0) and Expressive (100) and Extreme (200)." min={0} max={200} step={5} unit="%" fieldWidth={70} {...push} />
      <Slider label="Hue shift" info="How far the light and shadow steps turn toward the light and shadow colours." min={-1} max={1} step={0.05} fieldWidth={70} {...hue} />
      <Slider label="Saturation" info="Bends how chroma falls away toward the light and the shadow." min={-1} max={1} step={0.05} fieldWidth={70} {...chroma} />
    </>
  );
}
