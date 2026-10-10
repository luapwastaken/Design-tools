// The scene's light, under the Ramps header in every state: a preset, and the light and shadow colours
// it is made of, editable as the shared colour fields are. A choice is written to every ramp as one
// step; with no ramp it is what the next one is born with.
import type { Oklch } from '../../../shared/color/index.ts';
import { ColorField, Select, Tooltip, useDocColour } from '../../ui/index.ts';
import { selected, type Doc } from './actions.ts';
import { setScene, type IllustrationDoc } from './doc.ts';
import { LIGHTS, sceneLight, type LightPair } from './scene.ts';
import { cleanStrengths } from './light-zones.ts';
import { patchView, type IllustrationView } from './view-state.ts';
import s from './LightRow.module.css';

const MIXED = 'The ramps are not all lit the same, so these are the selected ramp’s colours. Choose a light, or change a colour, to light every ramp alike.';

/** a preset chosen: its light and shadow on every ramp, one undo step; Light zones' four strengths follow it, and the rim goes back to the key's colour */
export function chooseLight(doc: Doc, id: string): void {
  const l = LIGHTS.find((x) => x.id === id);
  if (!l) return;
  doc.transact(`Light the scene: ${l.label}`, (x) => setScene(x, l.light, l.shadow));
  patchView({ zoneStrengths: cleanStrengths(l.strengths), zoneRim: null });
}

/** a chip edits one end of the pair for every ramp, as one undo step per gesture */
export const lightBinding = (which: keyof LightPair, label: string, group: string | undefined) => ({
  label: `Light the scene: ${label}`,
  key: `scene:${which}`,
  get: (x: IllustrationDoc) => sceneLight(x, group).pair[which],
  set: (x: IllustrationDoc, o: Oklch) => {
    const now = sceneLight(x, group).pair;
    return setScene(x, which === 'light' ? o : now.light, which === 'shadow' ? o : now.shadow);
  },
});

export function LightRow({ doc, d, v }: { doc: Doc; d: IllustrationDoc; v: IllustrationView }) {
  const group = selected(d, v.selected)?.group;
  const { pair, preset, mixed } = sceneLight(d, group);
  // the reading when it is no preset: Mixed (the ramps disagree) or Custom (they agree on a pair of its own)
  const value = preset?.id ?? (mixed ? 'mixed' : 'custom');
  const options = [...LIGHTS.map((l) => ({ value: l.id, label: l.label })), ...(preset ? [] : [{ value, label: mixed ? 'Mixed' : 'Custom' }])];
  const light = useDocColour(doc, lightBinding('light', 'light colour', group));
  const shadow = useDocColour(doc, lightBinding('shadow', 'shadow colour', group));
  return (
    <div className={s.row} role="group" aria-label="Light">
      <Tooltip content={MIXED} disabled={!mixed}>
        <div>
          <Select label="Light" options={options} value={value} onChange={(id) => chooseLight(doc, id)} />
        </div>
      </Tooltip>
      <div className={s.pair}>
        <ColorField {...light} name="Light" />
        <ColorField {...shadow} name="Shadow" />
      </div>
    </div>
  );
}
