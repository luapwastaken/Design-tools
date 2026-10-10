// Swap one colour on a ramp: the row of other colours the ramp's base could take, under the Ramps title. Each is
// at the same grey value as the base, shown as its own ramp under the ramp's light. "Now" comes first. A click uses
// one (one undo step) and the row stays open for the next. Works from any tab.
import { cssColor, toHex, type Oklch } from '../../../shared/color/index.ts';
import { Button, Kbd } from '../../ui/index.ts';
import type { Doc } from './actions.ts';
import { baseOf, rampName, rampOf, stepsOf, type IllustrationDoc } from './doc.ts';
import { closeSwap, swapTo } from './variation-actions.ts';
import { alternatives } from './variations.ts';
import type { IllustrationView } from './view-state.ts';
import s from './SwapRamp.module.css';

const strip = (steps: Oklch[]) => (
  <span className={s.strip} data-colour>
    {steps.map((c, i) => (
      <i key={i} style={{ background: cssColor(c) }} />
    ))}
  </span>
);

export function SwapRamp({ doc, d, v }: { doc: Doc; d: IllustrationDoc; v: IllustrationView }) {
  const r = rampOf(d, v.swapRamp);
  const base = r && baseOf(d, r.id);
  if (!r || !base) return null;
  const name = rampName(d, r);
  const list = alternatives(d, r.id);
  return (
    <div className={s.row} role="group" aria-label={`Other colours for ${name}`} data-swap-row>
      <div className={s.head}>
        <span className={s.title}>Other colours for {name}, at the same grey value</span>
        {!list.length && <span className={s.few}>No other colours at this grey value</span>}
        <Button size="xs" shortcut="Escape" onClick={closeSwap}>
          Close
          <Kbd>Esc</Kbd>
        </Button>
      </div>
      <div className={s.alts}>
        <div className={`${s.alt} ${s.now}`} aria-label={`${name} now, ${toHex(base.oklch)}`}>
          {strip(stepsOf(d, r.id).map((w) => w.oklch))}
          <span className={s.hex}>{toHex(base.oklch).toUpperCase()}</span>
          <span className={s.dim}>Now</span>
        </div>
        {list.map((a) => (
          <button key={a.hex} type="button" className={s.alt} aria-label={`Use ${a.hex.toUpperCase()} for ${name}`} onClick={() => swapTo(doc, r.id, a.base)}>
            {strip(a.steps.map((st) => st.oklch))}
            <span className={s.hex}>{a.hex.toUpperCase()}</span>
          </button>
        ))}
      </div>
    </div>
  );
}
