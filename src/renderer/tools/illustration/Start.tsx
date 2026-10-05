// The empty state, in the Ramps section: the one colour to start from (a hex), the other ways in and
// four pre-set starters. Base + light + shadow = the steps.
import { useRef } from 'react';
import { cssColor, type Oklch } from '../../../shared/color/index.ts';
import { Button, TextInput } from '../../ui/index.ts';
import { addBase, type Doc } from './actions.ts';
import { baseFromHex, CAN_PICK, fromPaletteMenu, pickImage, STARTERS, addStarter } from './starts.ts';
import { eyedrop } from './actions.ts';
import s from './Start.module.css';

/** the artboard's own ramp: a fixed sample, drawn as colour chips */
const SAMPLE: Oklch[] = [
  [0.78, 0.07, 45],
  [0.7, 0.08, 40],
  [0.6, 0.09, 38],
  [0.5, 0.08, 25],
  [0.4, 0.06, 5],
];

export function Start({ doc }: { doc: Doc }) {
  // the hex as typed so far; the button and Enter add it (blur alone adds nothing)
  const typed = useRef('');
  const add = () => {
    const o = baseFromHex(typed.current);
    if (typed.current.trim() && !o) return; // the field is showing why
    addBase(doc, o ?? undefined);
    typed.current = '';
  };
  return (
    <section className={s.start} aria-label="Start">
      <div className={s.art}>
        <div className={s.sample} aria-hidden="true">
          {SAMPLE.map((o, i) => (
            <i key={i} style={{ background: cssColor(o) }} />
          ))}
        </div>
        <h2 className={s.title}>Start with one colour</h2>
        <p className={s.lead}>Type a hex, or paste one, and its ramp grows from highlight to deep shadow. Drop an image anywhere to pick colours from it.</p>
        <div className={s.row} onKeyDown={(e) => e.key === 'Enter' && (e.target as Element).tagName === 'INPUT' && add()}>
          <TextInput label="Hex" mono value="" placeholder="C26B4C" className={s.hex} onChange={(t) => (typed.current = t)} validate={(t) => (!t.trim() || baseFromHex(t) ? null : 'Type a hex colour: 3 or 6 digits, # optional.')} onCommit={() => {}} />
          <Button variant="primary" icon="add" onClick={add}>
            Add base colour
          </Button>
        </div>
        <div className={s.row}>
          <Button icon="add_photo_alternate" onClick={pickImage}>
            From an image
          </Button>
          <Button icon="palette" onClick={(e) => fromPaletteMenu(doc, e.currentTarget.getBoundingClientRect(), e.currentTarget, e.detail === 0)}>
            From a palette
          </Button>
          {CAN_PICK && (
            <Button icon="colorize" onClick={() => void eyedrop(doc)}>
              From the screen
            </Button>
          )}
        </div>
        <div className={s.starters}>
          <span>Or start from</span>
          {STARTERS.map((st) => (
            <button key={st.id} type="button" className={s.starter} onClick={() => addStarter(doc, st)}>
              <i style={{ background: cssColor(st.dot) }} />
              {st.label}
            </button>
          ))}
        </div>
      </div>
    </section>
  );
}
