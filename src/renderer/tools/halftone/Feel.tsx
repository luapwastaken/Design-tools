// Print feel (spec §5 q4): misregistration and paper grain, shown in the view and baked into the
// screen PNG only when asked. The SVG and the separations are always clean.
import { Module, Slider, Toggle, useDocNumber } from '../../ui/index.ts';
import type { Doc } from './actions.ts';
import { fix, LIMIT, type HalftoneDoc } from './doc.ts';
import s from './Inspector.module.css';

export function FeelModule({ doc, d }: { doc: Doc; d: HalftoneDoc }) {
  const mis = useDocNumber(doc, { label: 'Change the misregistration', key: 'feel.misregister', get: (x) => x.feel.misregister, set: (x, v) => fix({ ...x, feel: { ...x.feel, misregister: v } }) });
  const grain = useDocNumber(doc, { label: 'Change the paper grain', key: 'feel.texture', get: (x) => Math.round(x.feel.texture * 100), set: (x, v) => fix({ ...x, feel: { ...x.feel, texture: v / 100 } }) });
  const on = d.feel.misregister > 0 || d.feel.texture > 0;
  return (
    <Module title="Print feel" sub={on ? (d.feel.bake ? 'In the PNG too' : 'View only') : undefined}>
      <div className={s.stack}>
        <div className={s.group}>
          <Slider label="Misregister" min={LIMIT.misregister[0]} max={LIMIT.misregister[1]} step={0.01} unit="mm" {...mis} />
          <Slider label="Grain" min={0} max={100} step={1} unit="%" {...grain} />
        </div>
        <div className={s.group}>
          <Toggle label="Bake into the screen PNG" checked={d.feel.bake} onChange={(bake) => doc.transact(bake ? 'Bake the print feel into the PNG' : 'Keep the print feel out of the PNG', (x) => ({ ...x, feel: { ...x.feel, bake } }))} />
          <p className={s.note}>A Riso's drift and grain, for the view; never in the SVG or the plates.</p>
        </div>
      </div>
    </Module>
  );
}
