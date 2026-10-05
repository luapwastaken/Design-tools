// Harmonies tab, for the selected colour: a click adds the rule's colours as proposals. Tints are in
// the Colour picker section, where they are wanted while picking.
import { cssColor } from '../../../shared/color/index.ts';
import { harmony } from '../../../shared/palette/harmony.ts';
import { cx } from '../../ui/cx.ts';
import { SwatchStrip, Tooltip } from '../../ui/index.ts';
import { activeSwatch } from './actions.ts';
import { HARMONIES, runHarmony } from './build.ts';
import { nameIn, type DesignDoc, type DesignView } from './doc.ts';
import { proposals } from './proposals.ts';
import s from './Tabs.module.css';

export function HarmoniesTab({ d, v }: { d: DesignDoc; v: DesignView }) {
  const shown = proposals.use();
  const w = activeSwatch(d, v);
  if (!w) return <p className={s.none}>Select a colour in the palette to see its harmonies.</p>;
  const name = nameIn(d, w);
  return (
    <>
      <div className={s.h3}>
        Harmonies of {name}
        <small>each adds its colours as proposals</small>
      </div>
      <div className={s.harms}>
        {HARMONIES.map((h) => {
          const cols = harmony(w.oklch, h.kind);
          const on = shown?.from === 'harmony' && shown.label === `${h.label} of ${name}`;
          return (
            <Tooltip key={h.kind} content={`${h.label}: ${cols.length} more colours`}>
              <button type="button" className={cx(s.harm, on && s.on)} onClick={() => runHarmony({ name: w.name, oklch: w.oklch }, h.kind)}>
                <span className={s.hname}>{h.label}</span>
                <SwatchStrip colors={[w.oklch, ...cols].map(cssColor)} height={28} className={s.hstrip} />
                <span className={s.hcount}>+{cols.length}</span>
              </button>
            </Tooltip>
          );
        })}
      </div>
    </>
  );
}
