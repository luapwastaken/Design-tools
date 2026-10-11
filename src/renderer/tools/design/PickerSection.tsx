// The Colour picker section: the selected swatch in the app-wide picker style, then name and role,
// hex, HSB, RGB and print type. Every value typable. Lock and delete sit in the header.
import type { ReactNode } from 'react';
import { cssColor, inSrgb, READOUT_TOL, toHex, toSrgbGamut, type Oklch } from '../../../shared/color/index.ts';
import { fromHex } from '../../../shared/color/picker.ts';
import type { Swatch } from '../../../shared/types.ts';
import { HexField } from '../../ui/HexField.tsx';
import { cx } from '../../ui/cx.ts';
import { CopyAs, IconButton, NumberField, PickerBody, PickerModelSelect, PickerStyles, pickFromScreen, Segmented, SrgbFix, TextInput, Tooltip, useDocColour, usePickerModel, usePickerStyle } from '../../ui/index.ts';
import { usePickerColour, type Channel } from '../../ui/pickerModels.ts';
import { Section } from '../common/Section.tsx';
import { fmtL } from '../common/names.ts';
import { tints } from './adjust.ts';
import { armDelete, select, selection, setRole, toggleLocked, type Doc } from './actions.ts';
import { displayName, insertAfter, mapSwatch, nameIn, newSwatch, recolour, type DesignDoc, type DesignView } from './doc.ts';
import { Role } from './Role.tsx';
import s from './Picker.module.css';

const TYPES: { value: Swatch['type']; label: string; tip: string }[] = [
  { value: 'process', label: 'Process', tip: 'Process colour' },
  { value: 'global', label: 'Global', tip: 'Global swatch: edits update every use (ASE)' },
  { value: 'spot', label: 'Spot', tip: 'Spot colour: printed as its own ink (ASE)' },
];
const CAN_PICK = 'EyeDropper' in globalThis;

export function PickerSection({ doc, d, v }: { doc: Doc; d: DesignDoc; v: DesignView }) {
  const sel = selection(d, v);
  const w = d.swatches.find((x) => x.id === sel[0]);
  const style = usePickerStyle();
  const styles = <PickerStyles labelled className={s.styles} />;
  if (!w) {
    return (
      <Section title="Colour picker" sub={d.swatches.length ? 'select a colour' : undefined} actions={styles} className={s.section}>
        <div className={s.idle} aria-disabled="true">
          <p className={s.hint}>{d.swatches.length ? 'Select a colour in the palette to edit it here.' : 'Make a palette first, then edit its colours here.'}</p>
        </div>
      </Section>
    );
  }
  return <Editor key={w.id} doc={doc} d={d} w={w} v={v} count={sel.length} styles={styles} />;
}

type Gesture = { onBegin(): void; onCommit(fromKey?: boolean): void; onCancel(): void };

function Editor({ doc, d, w, v, count, styles }: { doc: Doc; d: DesignDoc; w: Swatch; v: DesignView; count: number; styles: ReactNode }) {
  const name = nameIn(d, w);
  const edit = (label: string, fn: (x: Swatch) => Swatch) => doc.transact(label, (x) => mapSwatch(x, w.id, fn));
  const colour = useDocColour(doc, {
    label: `Change ${name}`,
    key: `${w.id}:colour`,
    get: (x) => x.swatches.find((y) => y.id === w.id)?.oklch ?? w.oklch,
    set: (x, o) => recolour(x, { [w.id]: o }),
  });
  const style = usePickerStyle();
  const model = usePickerModel();
  const pc = usePickerColour(colour.value, colour.onChange);
  const g: Gesture = { onBegin: () => colour.onBegin?.(), onCommit: (k) => colour.onCommit?.(k), onCancel: () => colour.onCancel?.() };
  const locked = v.locked.includes(w.id);
  const match = d.swatches.filter((x) => x.id !== w.id).map((x) => ({ name: nameIn(d, x), oklch: x.oklch }));
  const pick = async () => {
    const got = await pickFromScreen();
    if (!got || got === toHex(colour.value)) return;
    g.onBegin();
    colour.onChange(fromHex(got, colour.value[2]));
    g.onCommit();
  };
  return (
    <Section
      title="Colour picker"
      sub={count > 1 ? `${name} · 1 of ${count} selected` : name}
      className={s.section}
      bodyClassName={s.body}
      actions={
        <>
          {styles}
          <IconButton icon={locked ? 'lock' : 'lock_open'} label="Lock swatch" tip={locked ? 'Locked: a re-roll and Delete leave it. Click to unlock' : 'Lock swatch: a re-roll and Delete leave it'} shortcut="L" size="sm" latched={locked} onClick={() => toggleLocked(doc)} />
          <IconButton icon="delete" label={count > 1 ? `Delete ${count} swatches` : 'Delete swatch'} shortcut="Delete" size="sm" onClick={() => armDelete(doc)} />
        </>
      }
    >
      <div className={s.picker} data-picker={style}>
        <PickerBody value={colour.value} colour={pc} numbers={false} match={match} {...g} />
        {!inSrgb(colour.value, READOUT_TOL) && (
          <SrgbFix
            value={colour.value}
            onUse={() => {
              g.onBegin();
              colour.onChange(toSrgbGamut(colour.value));
              g.onCommit();
            }}
          />
        )}
      </div>

      <div className={s.hexRow}>
        <HexField {...colour} steered className={s.hex} />
        {CAN_PICK && <IconButton icon="colorize" label="Pick a colour from the screen" shortcut="I" onClick={() => void pick()} />}
        <CopyAs value={colour.value} />
      </div>

      <Tints doc={doc} w={w} />

      <div className={s.ident}>
        <TextInput
          value={w.name}
          placeholder={w.name.trim() ? displayName({ name: '', oklch: w.oklch }) : name}
          onCommit={(t) => edit(`Rename ${name}`, (x) => ({ ...x, name: t.trim(), named: t.trim() ? true : undefined }))}
          className={s.name}
          data-design-name=""
        />
        <div className={s.roleBox}>
          <Role w={w} onChange={(role) => setRole(doc, w.id, role)} />
        </div>
      </div>

      {(style === 'square' || style === 'wheel') && (
        <div className={s.row}>
          <span className={s.lab}>Area</span>
          <div className={s.model}>
            <PickerModelSelect model={model} />
          </div>
        </div>
      )}
      {style !== 'sliders' && style !== 'oklch' && <Numbers label="HSB" channels={pc.channels('hsb')} g={g} />}
      {style !== 'sliders' && <Numbers label="RGB" channels={pc.channels('rgb')} g={g} />}

      <div className={s.row}>
        <span className={s.lab}>Print type</span>
        <Segmented options={TYPES} value={w.type} onChange={(type) => edit(`Make ${name} ${type}`, (x) => ({ ...x, type }))} className={s.types} />
      </div>
    </Section>
  );
}

/** the same hue down the lightness scale; a click adds one beside the colour */
function Tints({ doc, w }: { doc: Doc; w: Swatch }) {
  const ts = tints(w.oklch);
  const near = ts.reduce((best, t, i, all) => (Math.abs(t[0] - w.oklch[0]) < Math.abs(all[best][0] - w.oklch[0]) ? i : best), 0);
  const add = (o: Oklch) => {
    const t = newSwatch(o);
    doc.transact('Add tint', (x) => insertAfter(x, w.id, [t]));
    select([t.id]);
  };
  return (
    <div className={s.tints} role="group" aria-label="Tints: click to add one">
      <span className={s.lab}>Tints</span>
      <div className={s.tintRow}>
        {ts.map((t, i) => (
          <Tooltip key={i} content={`Add a tint at L ${fmtL(t[0])}`}>
            <button type="button" aria-label={`Add a tint at L ${fmtL(t[0])}`} className={cx(s.tint, i === near && s.here)} onClick={() => add(t)}>
              <i data-colour="" style={{ background: cssColor(t) }} />
            </button>
          </Tooltip>
        ))}
      </div>
    </div>
  );
}

function Numbers({ label, channels, g }: { label: string; channels: Channel[]; g: Gesture }) {
  return (
    <div className={s.row}>
      <span className={s.lab}>{label}</span>
      <div className={s.nums}>
        {channels.map((ch) => (
          <NumberField key={ch.label} label={ch.label} value={ch.value} min={ch.min} max={ch.max} step={ch.step} precision={ch.precision} unit={ch.unit} wrap={ch.wrap} {...g} onChange={ch.type ?? ch.set} />
        ))}
      </div>
    </div>
  );
}
