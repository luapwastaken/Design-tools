// Swap one colour: the row of other colours the selected role could take, under the Palette title. "Now" comes
// first, then about eight that each still pass every pair the role is in, with the lowest ratio they reach.
// A click uses one (one undo step) and the row stays open for the next. Works from any tab.
import { cssColor, toHex, type Oklch } from '../../../shared/color/index.ts';
import { ROLES } from '../../../shared/palette/roles.ts';
import { altsTitle, roleChecks } from '../../../shared/palette/variations.ts';
import { cx } from '../../ui/cx.ts';
import { Button, Kbd } from '../../ui/index.ts';
import type { Doc } from './actions.ts';
import { jobHolders, type DesignDoc, type DesignView } from './doc.ts';
import { closeSwap, swapTo } from './variation-actions.ts';
import { alternatives, swapRoles } from './variations.ts';
import s from './SwapRow.module.css';

const ratio = (n: number) => `${n.toFixed(1)}:1`;

export function SwapRow({ doc, d, v }: { doc: Doc; d: DesignDoc; v: DesignView }) {
  const role = ROLES.find((r) => r === v.swapRole);
  if (!role || !jobHolders(d.swatches).some(([r]) => r === role)) return null;
  const list = alternatives(d, v, role);
  const now = swapRoles(d, v)[role];
  const chip = (colour: Oklch) => <i data-colour style={{ background: cssColor(colour) }} />;
  return (
    <div className={s.row} role="group" aria-label={`Other colours for ${role}`} data-swap-row>
      <div className={s.head}>
        <span className={s.title}>{altsTitle(role)}</span>
        {list.length < 8 && <span className={s.few}>{list.length ? `Only ${list.length} fit.` : 'No other colours fit.'}</span>}
        <Button size="xs" shortcut="Escape" onClick={closeSwap}>
          Close
          <Kbd>Esc</Kbd>
        </Button>
      </div>
      <div className={s.alts}>
        <div className={cx(s.alt, s.now)} aria-label={`${role} now, ${toHex(now)}`}>
          {chip(now)}
          <span className={s.hex}>{toHex(now).toUpperCase()}</span>
          <span className={s.dim}>Now · {ratio(Math.min(...roleChecks(swapRoles(d, v), role).map((p) => p.ratio)))}</span>
        </div>
        {list.map((a) => (
          <button key={a.hex} type="button" className={s.alt} aria-label={`Use ${a.hex.toUpperCase()} as ${role}`} onClick={() => swapTo(doc, role, a.colour)}>
            {chip(a.colour)}
            <span className={s.hex}>{a.hex.toUpperCase()}</span>
            <span className={s.dim}>{ratio(a.figure)}</span>
          </button>
        ))}
      </div>
    </div>
  );
}
