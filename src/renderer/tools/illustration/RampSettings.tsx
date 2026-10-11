// Tab 1, Ramp settings: how the selected ramp is made (steps, hero, Rebuild base), its L / C / H
// curves (draggable), and how the steps are labelled and what they sit on. The scene light is the
// Light row's (under Ramps); the ramp's look (material, intensity, push, hue shift, saturation), the
// lit object and Seen as are in Light & preview, where you see them relight.
import type { RampSpec } from '../../../shared/types.ts';
import { Button, NumberField, Select, Toggle, useDocNumber, InspectorRow } from '../../ui/index.ts';
import { SURROUNDS, surroundOf } from '../common/surround.ts';
import { rampsFromLoose, selected, type Doc } from './actions.ts';
import { Curves } from './Curves.tsx';
import { brokenSteps, rampName, rampOf, regen, setSpec, stepsOf, type IllustrationDoc } from './doc.ts';
import { patchView, type IllustrationView } from './view-state.ts';
import s from './RampSettings.module.css';

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
        <div className={s.controls}>
          <RampControls key={r.id} doc={doc} d={d} r={r} />
          <Curves doc={doc} d={d} v={v} />
        </div>
      )}
      {w && <ViewControls d={d} v={v} />}
    </div>
  );
}

function RampControls({ doc, d, r }: { doc: Doc; d: IllustrationDoc; r: RampSpec }) {
  const name = rampName(d, r);
  const list = stepsOf(d, r.id);
  const baseless = !list.some((x) => x.step === 0);
  const broken = brokenSteps(list).length;
  const spec = (x: IllustrationDoc) => rampOf(x, r.id) ?? r;
  const steps = useDocNumber(doc, { label: `Change the steps of ${name}`, key: `${r.id}:steps`, get: (x) => spec(x).steps, set: (x, n) => setSpec(x, r.id, { steps: n }) });
  // the split the ramp actually has: near white or black every step goes to the side with room
  const made = list.map((x) => x.step ?? 0);
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
      {broken > 0 && <p className={s.bad}>A step is as light as the one before it: value should fall from highlight to deep shadow.</p>}
      <div className={s.grid}>
        <InspectorRow label="Steps">
          <NumberField label="Steps" hideLabel min={3} max={9} step={1} width={70} {...steps} />
          <span className={s.dim}>
            {lighter} lighter, {made.length - 1 - lighter} darker
          </span>
        </InspectorRow>
        <InspectorRow label="Hero ramp">
          <Toggle label="Quieten the other ramps" checked={r.hero} onChange={(hero) => doc.transact(hero ? `Make ${name} the hero` : `End ${name} as hero`, (x) => setSpec(x, r.id, { hero }))} />
        </InspectorRow>
      </div>
      <p className={s.hint}>Material, finish, intensity, push, hue shift and saturation are in Light & preview, where you see the object relight.</p>
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
      </div>
    </div>
  );
}
