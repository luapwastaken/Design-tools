// The empty state in the Ramps section: one plain sentence and the one way in that needs no menu, a hex.
// The light and the Add colour button sit above it, as they do once there are ramps.
import { useRef } from 'react';
import { TextInput } from '../../ui/index.ts';
import { type Doc } from './actions.ts';
import { addTyped, baseFromHex } from './starts.ts';
import s from './Start.module.css';

export function Start({ doc }: { doc: Doc }) {
  // the hex as typed so far; Enter adds it (blur alone adds nothing)
  const typed = useRef('');
  const add = () => {
    if (!typed.current.trim()) return;
    if (addTyped(doc, typed.current)) typed.current = '';
  };
  return (
    <section className={s.start} aria-label="Start">
      <p className={s.lead}>No ramps yet. Pick a light, then add colours.</p>
      <div className={s.row} onKeyDown={(e) => e.key === 'Enter' && (e.target as Element).tagName === 'INPUT' && add()}>
        <TextInput label="Hex" mono value="" placeholder="C26B4C" className={s.hex} onChange={(t) => (typed.current = t)} validate={(t) => (!t.trim() || baseFromHex(t) ? null : 'Type a hex colour: 3 or 6 digits, # optional.')} onCommit={() => {}} />
      </div>
      <p className={s.fine}>Type a hex and press Enter to make its ramp, or use From… to add several colours at once.</p>
    </section>
  );
}
