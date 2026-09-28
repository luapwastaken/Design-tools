import { useEffect, useRef, useState } from 'react';
import { cssColor, type Oklch } from '../../../shared/color/index.ts';
import { ROLES } from '../../../shared/palette/roles.ts';
import type { Swatch } from '../../../shared/types.ts';
import { IconButton, Module, Picker, PickerModes, Segmented, Select, TextInput, Toggle, Tooltip, useDocColour } from '../../ui/index.ts';
import { cx } from '../../ui/cx.ts';
import { select, selection, type Doc } from './actions.ts';
import { tints } from './adjust.ts';
import { displayName, insertAfter, mapSwatch, newSwatch, recolour, type DesignDoc, type DesignView } from './doc.ts';
import { fmtL } from './SwatchChip.tsx';
import { armed, patchView } from './view-state.ts';
import s from './Inspector.module.css';

const OTHER = 'other';
const ROLE_OPTIONS = [{ value: '', label: 'No role' }, ...ROLES.map((r) => ({ value: r as string, label: r as string })), { value: OTHER, label: 'Other…' }];
const TYPES: { value: Swatch['type']; label: string; tip: string }[] = [
  { value: 'process', label: 'Process', tip: 'Process colour' },
  { value: 'global', label: 'Global', tip: 'Global swatch: edits update every use (ASE)' },
  { value: 'spot', label: 'Spot', tip: 'Spot colour: printed as its own ink (ASE)' },
];

/** The active swatch: name, role, the picker, tints of its hue to add, and delete. */
export function Inspector({ doc, d, v }: { doc: Doc; d: DesignDoc; v: DesignView }) {
  const sel = selection(d, v);
  const w = d.swatches.find((x) => x.id === sel[0]);
  return (
    <Module
      title="Swatch"
      sub={w ? displayName(w) : undefined}
      // with several selected, the fields below still edit the one named here
      readout={sel.length > 1 ? `Editing 1 of ${sel.length}` : undefined}
      actions={
        w && (
          <>
            <PickerModes value={v.picker} onChange={(picker) => patchView({ picker })} />
            <IconButton icon="delete" label={sel.length > 1 ? `Delete ${sel.length} swatches` : 'Delete swatch'} shortcut="Delete" size="sm" onClick={() => armed.set(true)} />
          </>
        )
      }
    >
      {!w ? (
        <p className={s.hint}>{d.swatches.length ? 'Select a swatch to edit it.' : 'Add or build colours, then pick one here to edit it.'}</p>
      ) : (
        <Editor key={w.id} doc={doc} w={w} v={v} />
      )}
    </Module>
  );
}

function Editor({ doc, w, v }: { doc: Doc; w: Swatch; v: DesignView }) {
  const edit = (label: string, fn: (x: Swatch) => Swatch) => doc.transact(label, (d) => mapSwatch(d, w.id, fn));
  const name = displayName(w);
  const colour = useDocColour(doc, {
    label: `Change ${name}`,
    key: `${w.id}:colour`,
    get: (d) => d.swatches.find((x) => x.id === w.id)?.oklch ?? w.oklch,
    set: (d, o) => recolour(d, { [w.id]: o }),
  });
  const addTint = (o: Oklch) => {
    const t = newSwatch(o);
    doc.transact('Add tint', (d) => insertAfter(d, w.id, [t]));
    select([t.id]);
  };
  const near = tints(w.oklch).reduce((best, t, i, all) => (Math.abs(t[0] - w.oklch[0]) < Math.abs(all[best][0] - w.oklch[0]) ? i : best), 0);

  return (
    <div className={s.editor}>
      <div className={s.ident}>
        <i className={s.big} style={{ background: cssColor(colour.value) }} />
        <div className={s.fields}>
          <TextInput value={w.name} placeholder={displayName({ name: '', oklch: w.oklch })} onCommit={(t) => edit(`Rename ${name}`, (x) => ({ ...x, name: t.trim() }))} />
          <Role w={w} onChange={(role) => edit(role ? `Set ${name} to ${role}` : `Clear ${name}'s role`, (x) => ({ ...x, role }))} />
        </div>
      </div>

      <Picker {...colour} mode={v.picker} onMode={(picker) => patchView({ picker })} lockL={v.lockL} lockH={v.lockH} />
      <div className={s.locks}>
        <Toggle label="Value lock" checked={v.lockL} onChange={(lockL) => patchView({ lockL })} />
        <Toggle label="Hue lock" checked={v.lockH} onChange={(lockH) => patchView({ lockH })} />
        <span className={s.dim}>Picker drags only</span>
      </div>

      <div className={s.section}>
        <div className={s.head}>
          <span className="lbl">Tints</span>
          <span className={s.dim}>Same hue down the scale. Click one to add it.</span>
        </div>
        <div className={s.tints}>
          {tints(w.oklch).map((t, i) => (
            <Tooltip key={i} content={`Add L ${fmtL(t[0])}`}>
              <button type="button" aria-label={`Add a tint at L ${fmtL(t[0])}`} className={cx(s.tint, i === near && s.here)} style={{ background: cssColor(t) }} onClick={() => addTint(t)} />
            </Tooltip>
          ))}
        </div>
      </div>

      <Segmented label="Type" options={TYPES} value={w.type} onChange={(type) => edit(`Make ${name} ${type}`, (x) => ({ ...x, type }))} />
    </div>
  );
}

/** job names plus a free "Other" (spec §6.1) */
function Role({ w, onChange }: { w: Swatch; onChange(role: string | null): void }) {
  const custom = w.role !== null && !(ROLES as readonly string[]).includes(w.role);
  // "Other" chosen but not yet named; a role changed any other way (undo) ends it
  const [other, setOther] = useState(custom);
  useEffect(() => setOther(custom), [w.role]);
  const field = useRef<HTMLInputElement>(null);
  const value = other || custom ? OTHER : (w.role ?? '');
  return (
    <div className={s.role}>
      <Select
        label="Role"
        options={ROLE_OPTIONS}
        value={value}
        onChange={(r) => {
          setOther(r === OTHER);
          if (r !== OTHER) onChange(r || null);
          // the closing menu hands focus back to the Select first
          else requestAnimationFrame(() => field.current?.focus());
        }}
        className={s.roleSelect}
      />
      {value === OTHER && (
        <TextInput
          ref={field}
          value={custom ? w.role! : ''}
          placeholder="Name the job"
          onCommit={(t) => onChange(t.trim() || null)}
          className={s.other}
        />
      )}
    </div>
  );
}
