// The Colour picker section (bottom left of the right column): the selected step, in the app-wide
// picker style (its switch is in this header), with Hex, HSB and RGB under it. Every value is typable.
import { cssColor } from '../../../shared/color/index.ts';
import type { RampSpec, Swatch } from '../../../shared/types.ts';
import { IconButton, Picker, PickerStyles, TextInput, useDocColour } from '../../ui/index.ts';
import { fmtL } from '../common/names.ts';
import { Section } from '../common/Section.tsx';
import { selected, type Doc } from './actions.ts';
import { nameOf, rampName, rampOf, recolour, renameSwatch, revertStep, stepsOf, wordOf, type IllustrationDoc } from './doc.ts';
import type { IllustrationView } from './view-state.ts';
import s from './PickerSection.module.css';

export function PickerSection({ doc, d, v }: { doc: Doc; d: IllustrationDoc; v: IllustrationView }) {
  const w = selected(d, v.selected);
  const r = rampOf(d, w?.group);
  const steps = r ? stepsOf(d, r.id) : [];
  const where = !w ? undefined : r ? `${w.step === 0 ? 'Base step' : `Step ${steps.findIndex((x) => x.id === w.id) + 1}`} of ${rampName(d, r)}` : `${nameOf(d, w)} · in no ramp`;
  return (
    <Section
      title="Colour picker"
      sub={where}
      className={s.picker}
      bodyClassName={s.body}
      actions={
        <>
          {w?.edited && <IconButton icon="restart_alt" label="Back to what the ramp makes" size="sm" onClick={() => doc.transact(`Regenerate ${nameOf(d, w)}`, (x) => revertStep(x, w.id))} />}
          <PickerStyles />
        </>
      }
    >
      {w ? <Editor key={w.id} doc={doc} d={d} w={w} r={r} /> : <p className={s.quiet}>Add a base colour and its steps are edited here.</p>}
    </Section>
  );
}

function Editor({ doc, d, w, r }: { doc: Doc; d: IllustrationDoc; w: Swatch; r: RampSpec | null }) {
  const name = nameOf(d, w);
  const word = wordOf(d, w);
  const colour = useDocColour(doc, {
    label: `Change ${name}`,
    key: `${w.id}:colour`,
    get: (x) => x.swatches.find((y) => y.id === w.id)?.oklch ?? w.oklch,
    set: (x, o) => recolour(x, w.id, o),
  });
  // what an edit here does: the base moves the ramp, any other step keeps your colour
  const note = !r ? 'In no ramp: make one from it with the Ramps menu.' : w.step === 0 ? 'Base: the ramp follows it.' : w.edited ? 'Edited by hand: the ramp leaves it when it changes.' : 'Made by the ramp: an edit here keeps your colour.';
  return (
    <>
      <div className={s.ident}>
        <i className={s.chip} style={{ background: cssColor(colour.value) }} />
        <TextInput className={s.name} value={w.name} placeholder={w.name.trim() ? undefined : name} onCommit={(t) => doc.transact(`Rename ${name}`, (x) => renameSwatch(x, w.id, t.trim()))} />
        <span className={s.where}>
          L {fmtL(w.oklch[0])}
          {word ? ` · ${word}` : ''}
          {w.edited ? ' · edited' : ''}
        </span>
      </div>
      <Picker {...colour} styles={false} className={s.pick} />
      <p className={s.note}>{note}</p>
    </>
  );
}
