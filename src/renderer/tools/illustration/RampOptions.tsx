// Ramps mode's view bar: what the board prints under each swatch, the surround it sits on, and the
// lens it is seen through (G flips greyscale).
import { Select, Toggle } from '../../ui/index.ts';
import { OptionsBar, OptionsField } from '../common/OptionsBar.tsx';
import { SURROUNDS, surroundOf } from '../common/surround.ts';
import type { IllustrationDoc } from './doc.ts';
import { PROOFS, type Proof } from './proof.ts';
import { patchView, type IllustrationView } from './view-state.ts';
import s from './Ramps.module.css';

const SHOWS: { value: IllustrationView['show']; label: string }[] = [
  { value: 'hex', label: 'Hex and lightness' },
  { value: 'name', label: 'Name' },
  { value: 'off', label: 'Off' },
];

export function RampOptions({ d, v }: { d: IllustrationDoc; v: IllustrationView }) {
  return (
    <OptionsBar>
      <OptionsField label="Show">
        <Select className={s.selWide} options={SHOWS} value={v.show} onChange={(show) => patchView({ show })} />
      </OptionsField>
      <OptionsField label="Surround">
        <Select
          className={s.sel}
          options={SURROUNDS.map((o) => ({ value: o.value, label: o.label, swatch: surroundOf(o.value, d.swatches) }))}
          value={v.surround}
          onChange={(surround) => patchView({ surround })}
        />
      </OptionsField>
      <span className={s.grow} />
      <OptionsField label="Proof">
        <Select className={s.sel} options={PROOFS} value={v.proof} onChange={(proof: Proof) => patchView({ proof })} />
      </OptionsField>
      <Toggle label="Greyscale (G)" checked={v.proof === 'grey'} onChange={(on) => patchView({ proof: on ? 'grey' : 'off' })} />
    </OptionsBar>
  );
}
