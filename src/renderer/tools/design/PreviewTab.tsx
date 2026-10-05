// Preview in use tab: the palette on a small website, light and dark side by side. Clicking an
// element selects its colour in the palette.
import { simulated } from './artboard.ts';
import { InContext } from './InContext.tsx';
import { select } from './actions.ts';
import { Select } from '../../ui/index.ts';
import type { Results } from './results.ts';
import type { DesignView, Simulate } from './doc.ts';
import { patchView } from './view-state.ts';
import { useMemo } from 'react';
import s from './Tabs.module.css';

const SIMULATE: { value: Simulate; label: string }[] = [
  { value: 'normal', label: 'Normal' },
  { value: 'protan', label: 'Protan' },
  { value: 'deutan', label: 'Deutan' },
  { value: 'tritan', label: 'Tritan' },
  { value: 'achromat', label: 'Achromat' },
  { value: 'greyscale', label: 'Greyscale value' },
];

export function PreviewTab({ v, r }: { v: DesignView; r: Results }) {
  // blank names filled in, as the checks' sentences name them; under See as, the colours as seen
  const shown = useMemo(() => (v.sim === 'normal' ? r.shown : r.shown.map((w) => ({ ...w, oklch: simulated(w.oklch, v.sim) }))), [r.shown, v.sim]);
  return (
    <>
      <div className={s.h3}>
        Your palette on a real page
        <small>built from the roles; click anything to select its colour</small>
        <span className={s.flags}>
          <Select label="See as" options={SIMULATE} value={v.sim} onChange={(sim) => patchView({ sim })} className={s.see} />
        </span>
      </div>
      <div className={s.preview}>
        <InContext swatches={shown} onSelect={(id) => select([id])} />
      </div>
    </>
  );
}
