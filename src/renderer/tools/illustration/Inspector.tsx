// The inspector (UX pass): the selected colour only, its name, where it sits in its ramp, and the
// picker in the app-wide style. The ramp's lighting sits beside the lit shapes (Lighting).
import { cssColor } from '../../../shared/color/index.ts';
import type { RampSpec, Swatch } from '../../../shared/types.ts';
import { cx } from '../../ui/cx.ts';
import { IconButton, Module, Picker, PickerStyles, TextInput, useDocColour } from '../../ui/index.ts';
import { fmtL } from '../common/names.ts';
import { selected, type Doc } from './actions.ts';
import { nameOf, rampName, rampOf, recolour, renameSwatch, revertStep, stepsOf, wordOf, type IllustrationDoc } from './doc.ts';
import type { IllustrationView } from './view-state.ts';
import s from './Inspector.module.css';

/** The selected colour: its name, where it sits, and the picker. */
export function StepInspector({ doc, d, v }: { doc: Doc; d: IllustrationDoc; v: IllustrationView }) {
  const w = selected(d, v.selected);
  const r = rampOf(d, w?.group);
  const word = w && wordOf(d, w);
  return (
    <Module
      title={r ? (w?.step === 0 ? 'Base' : 'Step') : 'Colour'}
      sub={w ? (r && w.step !== 0 ? `${rampName(d, r)} · ${word}` : nameOf(d, w)) : undefined}
      actions={
        w && (
          <>
            <PickerStyles />
            {w.edited && <IconButton icon="restart_alt" label="Back to what the ramp makes" size="sm" onClick={() => doc.transact(`Regenerate ${nameOf(d, w)}`, (x) => revertStep(x, w.id))} />}
          </>
        )
      }
    >
      {!w ? <p className={s.hint}>Add a base colour, then pick any step here to edit it.</p> : <Editor key={w.id} doc={doc} d={d} w={w} r={r} />}
    </Module>
  );
}

function Editor({ doc, d, w, r }: { doc: Doc; d: IllustrationDoc; w: Swatch; r: RampSpec | null }) {
  const name = nameOf(d, w);
  const colour = useDocColour(doc, {
    label: `Change ${name}`,
    key: `${w.id}:colour`,
    get: (x) => x.swatches.find((y) => y.id === w.id)?.oklch ?? w.oklch,
    set: (x, o) => recolour(x, w.id, o),
  });
  const steps = r ? stepsOf(d, r.id) : [];
  const at = steps.findIndex((x) => x.id === w.id);
  // what an edit here does: the base moves the ramp, any other step keeps your colour
  const note = !r
    ? 'In no ramp. Make a ramp from it under Light, or from the row’s menu.'
    : w.step === 0
      ? 'The base: the ramp follows it. Edit any other step and it keeps your colour.'
      : w.edited
        ? 'Edited by hand: the ramp leaves it when it changes.'
        : 'Made by the ramp. An edit here keeps your colour.';
  return (
    <div className={s.editor}>
      <div className={s.ident}>
        <i className={s.big} style={{ background: cssColor(colour.value) }} />
        <div className={s.fields}>
          <TextInput
            value={w.name}
            placeholder={w.name.trim() ? undefined : name}
            onCommit={(t) => doc.transact(`Rename ${name}`, (x) => renameSwatch(x, w.id, t.trim()))}
          />
          <span className={s.where}>
            {r ? (
              <>
                <span className="lbl">
                  Step {at + 1} of {steps.length}
                </span>
                <span className={s.dot}>·</span>
                <span className="lbl">L {fmtL(w.oklch[0])}</span>
                {w.edited && (
                  <>
                    <span className={s.dot}>·</span>
                    <span className={cx('lbl', s.edited)}>Edited</span>
                  </>
                )}
              </>
            ) : (
              <span className="lbl">Not in a ramp</span>
            )}
          </span>
        </div>
      </div>
      <Picker {...colour} styles={false} />
      <p className={s.note}>{note}</p>
    </div>
  );
}
