// Tints & harmonies tab, for the selected colour: tints (a click adds one), harmonies (a click
// adds the rule's colours as proposals).
import { cssColor, type Oklch } from '../../../shared/color/index.ts';
import { harmony } from '../../../shared/palette/harmony.ts';
import { cx } from '../../ui/cx.ts';
import { SwatchStrip, Tooltip } from '../../ui/index.ts';
import { fmtL } from '../common/names.ts';
import { activeSwatch, select, type Doc } from './actions.ts';
import { tints } from './adjust.ts';
import { HARMONIES, runHarmony } from './build.ts';
import { insertAfter, newSwatch, nameIn, type DesignDoc, type DesignView } from './doc.ts';
import { proposals } from './proposals.ts';
import s from './Tabs.module.css';

export function TintsTab({ doc, d, v }: { doc: Doc; d: DesignDoc; v: DesignView }) {
  const shown = proposals.use();
  const w = activeSwatch(d, v);
  if (!w) return <p className={s.none}>Select a colour in the palette to see its tints and harmonies.</p>;
  const name = nameIn(d, w);
  const addTint = (o: Oklch) => {
    const t = newSwatch(o);
    doc.transact('Add tint', (x) => insertAfter(x, w.id, [t]));
    select([t.id]);
  };
  const ts = tints(w.oklch);
  const near = ts.reduce((best, t, i, all) => (Math.abs(t[0] - w.oklch[0]) < Math.abs(all[best][0] - w.oklch[0]) ? i : best), 0);
  return (
    <>
      <div className={s.h3}>
        Tints of {name}
        <small>the same hue down the lightness scale · click to add</small>
      </div>
      <div className={s.tints}>
        {ts.map((t, i) => (
          <Tooltip key={i} content={`Add L ${fmtL(t[0])}`}>
            <button type="button" aria-label={`Add a tint at L ${fmtL(t[0])}`} className={cx(s.tint, i === near && s.here)} onClick={() => addTint(t)}>
              <i style={{ background: cssColor(t) }} />
              <span>{fmtL(t[0])}</span>
            </button>
          </Tooltip>
        ))}
      </div>
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
