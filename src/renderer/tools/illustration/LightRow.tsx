// The scene's light, under the Ramps header in every state: a preset, the two colours it is made of and
// Edit. A preset is written to every ramp as one step; with no ramp it is what the next one is born with.
import { cssColor, toHex } from '../../../shared/color/index.ts';
import { Button, Select, Tooltip } from '../../ui/index.ts';
import { selected, type Doc } from './actions.ts';
import { setScene, type IllustrationDoc } from './doc.ts';
import { LIGHTS, sceneLight } from './scene.ts';
import { patchView, type IllustrationView } from './view-state.ts';
import s from './LightRow.module.css';

export function LightRow({ doc, d, v }: { doc: Doc; d: IllustrationDoc; v: IllustrationView }) {
  const { pair, preset, mixed } = sceneLight(d, selected(d, v.selected)?.group);
  // the reading when it is no preset: Mixed (the ramps disagree) or Custom (they agree on a pair of its own)
  const value = preset?.id ?? (mixed ? 'mixed' : 'custom');
  const options = [...LIGHTS.map((l) => ({ value: l.id, label: l.label })), ...(preset ? [] : [{ value, label: mixed ? 'Mixed' : 'Custom' }])];
  const choose = (id: string) => {
    const l = LIGHTS.find((x) => x.id === id);
    if (l) doc.transact(`Light the scene: ${l.label}`, (x) => setScene(x, l.light, l.shadow));
  };
  const tip = (what: string, c: typeof pair.light) => `${what} ${toHex(c).toUpperCase()}${mixed ? ' (the selected ramp)' : ''}`;
  return (
    <div className={s.row} role="group" aria-label="Light">
      <Select label="Light" options={options} value={value} onChange={choose} className={s.pick} />
      <Tooltip content={tip('Light colour', pair.light)}>
        <i className={s.swatch} role="img" aria-label={tip('Light colour', pair.light)} data-colour="" style={{ background: cssColor(pair.light) }} />
      </Tooltip>
      <Tooltip content={tip('Shadow colour', pair.shadow)}>
        <i className={s.swatch} role="img" aria-label={tip('Shadow colour', pair.shadow)} data-colour="" style={{ background: cssColor(pair.shadow) }} />
      </Tooltip>
      <Button size="xs" variant="ghost" disabled={!d.ramps.length} tooltip={d.ramps.length ? 'Change the light and shadow colours in Light & preview' : 'Add a colour first: its light is edited in Light & preview'} onClick={() => patchView({ tab: 'light' })}>
        Edit
      </Button>
    </div>
  );
}
