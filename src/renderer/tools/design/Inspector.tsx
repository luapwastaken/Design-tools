// The inspector (SPEC 3): the selected swatch as a stack of collapsible groups. Name and role, the
// colour (in the app-wide picker style), tints, harmonies, its contrast against the palette, type,
// and which roles the palette still lacks.
import { useEffect, useMemo, useRef, useState } from 'react';
import { contrast, cssColor, type Oklch } from '../../../shared/color/index.ts';
import { contrastTarget } from '../../../shared/palette/checks.ts';
import { ROLES } from '../../../shared/palette/roles.ts';
import type { Swatch } from '../../../shared/types.ts';
import { IconButton, InspectorGroup, Module, InspectorRow, Picker, PickerStyles, Segmented, Select, SwatchStrip, TextInput, Tooltip, useDocColour } from '../../ui/index.ts';
import { cx } from '../../ui/cx.ts';
import { fmtL } from '../common/names.ts';
import { armDelete, copyHex, select, selection, setRole, type Doc } from './actions.ts';
import { tints } from './adjust.ts';
import { HARMONIES, runHarmony } from './build.ts';
import { displayName, insertAfter, mapSwatch, nameIn, newSwatch, recolour, type DesignDoc, type DesignView } from './doc.ts';
import { harmony } from '../../../shared/palette/harmony.ts';
import { proposals } from './proposals.ts';
import { patchView } from './view-state.ts';
import s from './Inspector.module.css';

const OTHER = 'other';
const IDLE = ['Colour', 'Tints', 'Harmonies', 'Contrast', 'Type', 'Roles'];
const ROLE_OPTIONS = [{ value: '', label: 'No role' }, ...ROLES.map((r) => ({ value: r as string, label: r as string })), { value: OTHER, label: 'Other…' }];
const TYPES: { value: Swatch['type']; label: string; tip: string }[] = [
  { value: 'process', label: 'Process', tip: 'Process colour' },
  { value: 'global', label: 'Global', tip: 'Global swatch: edits update every use (ASE)' },
  { value: 'spot', label: 'Spot', tip: 'Spot colour: printed as its own ink (ASE)' },
];

export function Inspector({ doc, d, v }: { doc: Doc; d: DesignDoc; v: DesignView }) {
  const sel = selection(d, v);
  const w = d.swatches.find((x) => x.id === sel[0]);
  if (!w) {
    return (
      <>
        <InspectorGroup id="design.swatch" title="Swatch">
          <p className={s.hint}>Select a colour on the artboard to edit it here.</p>
        </InspectorGroup>
        {/* the groups a selection fills, there but idle: the inspector keeps its shape */}
        {IDLE.map((title) => (
          <Module key={title} title={title} readout="select a swatch" className={s.idle} />
        ))}
      </>
    );
  }
  return <Editor key={w.id} doc={doc} d={d} w={w} v={v} count={sel.length} name={nameIn(d, w)} />;
}

function Editor({ doc, d, w, v, count, name }: { doc: Doc; d: DesignDoc; w: Swatch; v: DesignView; count: number; name: string }) {
  const edit = (label: string, fn: (x: Swatch) => Swatch) => doc.transact(label, (x) => mapSwatch(x, w.id, fn));
  const colour = useDocColour(doc, {
    label: `Change ${name}`,
    key: `${w.id}:colour`,
    get: (x) => x.swatches.find((y) => y.id === w.id)?.oklch ?? w.oklch,
    set: (x, o) => recolour(x, { [w.id]: o }),
  });
  const addTint = (o: Oklch) => {
    const t = newSwatch(o);
    doc.transact('Add tint', (x) => insertAfter(x, w.id, [t]));
    select([t.id]);
  };
  const ts = tints(w.oklch);
  const near = ts.reduce((best, t, i, all) => (Math.abs(t[0] - w.oklch[0]) < Math.abs(all[best][0] - w.oklch[0]) ? i : best), 0);
  const held = ROLES.filter((r) => d.swatches.some((x) => x.role === r)).length;

  return (
    <>
      <InspectorGroup
        id="design.swatch"
        title="Swatch"
        // with several selected, the fields below still edit the one named here
        meta={count > 1 ? `Editing 1 of ${count}` : undefined}
        actions={
          <>
            <IconButton icon="content_copy" label="Copy hex" shortcut="C" size="sm" onClick={() => copyHex(w)} />
            <IconButton icon="delete" label={count > 1 ? `Delete ${count} swatches` : 'Delete swatch'} shortcut="Delete" size="sm" onClick={() => armDelete(doc)} />
          </>
        }
      >
        <div className={s.ident}>
          <i className={s.big} style={{ background: cssColor(colour.value) }} />
          <TextInput value={w.name} placeholder={w.name.trim() ? displayName({ name: '', oklch: w.oklch }) : name} onCommit={(t) => edit(`Rename ${name}`, (x) => ({ ...x, name: t.trim() }))} className={s.name} />
        </div>
        <InspectorRow label="Role" info="What the colour does. Roles pair the contrast checks and set the page the In use view draws.">
          <Role w={w} onChange={(role) => setRole(doc, w.id, role)} />
        </InspectorRow>
      </InspectorGroup>

      <InspectorGroup id="design.colour" title="Colour" actions={<PickerStyles />}>
        <Picker {...colour} styles={false} lockL={v.lockL} lockH={v.lockH} onLock={(which, on) => patchView(which === 'L' ? { lockL: on } : { lockH: on })} />
      </InspectorGroup>

      <InspectorGroup id="design.tints" title="Tints" meta="click to add">
        <div className={s.tints}>
          {ts.map((t, i) => (
            <Tooltip key={i} content={`Add L ${fmtL(t[0])}`}>
              <button type="button" aria-label={`Add a tint at L ${fmtL(t[0])}`} className={cx(s.tint, i === near && s.here)} style={{ background: cssColor(t) }} onClick={() => addTint(t)} />
            </Tooltip>
          ))}
        </div>
      </InspectorGroup>

      <InspectorGroup id="design.harmonies" title="Harmonies" meta="adds as proposals">
        <Harmonies w={w} name={name} />
      </InspectorGroup>

      <ContrastGroup d={d} w={w} name={name} />

      <InspectorGroup id="design.type" title="Type" meta="for ASE export">
        <Segmented options={TYPES} value={w.type} onChange={(type) => edit(`Make ${name} ${type}`, (x) => ({ ...x, type }))} />
      </InspectorGroup>

      <InspectorGroup id="design.roles" title="Roles" meta={`${held} of ${ROLES.length} held`} defaultOpen={false}>
        <div className={s.roles}>
          {ROLES.map((r) => {
            const owner = d.swatches.find((x) => x.role === r);
            return (
              <Tooltip key={r} content={owner ? (owner.id === w.id ? `${name} is the ${r}` : `${displayName(owner)} is the ${r}. Click to give it to ${name}.`) : `Give ${name} the ${r} job`}>
                <button type="button" className={cx(s.roleChip, owner && s.held, owner?.id === w.id && s.mine)} onClick={() => setRole(doc, w.id, owner?.id === w.id ? null : r)}>
                  {owner && <i className={s.dot} style={{ background: cssColor(owner.oklch) }} />}
                  <span>{r}</span>
                </button>
              </Tooltip>
            );
          })}
        </div>
      </InspectorGroup>
    </>
  );
}

/** the chips are narrow: the rule's short name (the tooltip has the long one) */
const SHORT: Record<string, string> = { complementary: 'Complement', split: 'Split' };

/** the five rules, each with the colours it would add, built on this swatch */
function Harmonies({ w, name }: { w: Swatch; name: string }) {
  const shown = proposals.use();
  return (
    <div className={s.harmonies}>
      {HARMONIES.map((h) => {
        const cols = harmony(w.oklch, h.kind);
        const on = shown?.from === 'harmony' && shown.label === `${h.label} of ${name}`;
        return (
          <Tooltip key={h.kind} content={`${h.label}: ${cols.length} more colours`}>
            <button type="button" className={cx(s.harm, on && s.on)} onClick={() => runHarmony({ name: w.name, oklch: w.oklch }, h.kind)}>
              <SwatchStrip colors={[w.oklch, ...cols].map(cssColor)} height={16} className={s.hstrip} />
              <span>{SHORT[h.kind] ?? h.label}</span>
            </button>
          </Tooltip>
        );
      })}
    </div>
  );
}

/** this colour against the palette's grounds and ink: the ratio and its grade, a click opens the dock */
function ContrastGroup({ d, w, name }: { d: DesignDoc; w: Swatch; name: string }) {
  const rows = useMemo(() => {
    const others = d.swatches.filter((x) => x.id !== w.id);
    const pick = new Map<string, Swatch>();
    for (const r of ['Background', 'Surface', 'Text']) {
      const x = others.find((o) => o.role === r);
      if (x) pick.set(x.id, x);
    }
    // with few roles set, the lightest and darkest stand in
    const byL = [...others].sort((a, b) => a.oklch[0] - b.oklch[0]);
    for (const x of [byL.at(-1), byL[0]]) if (x && pick.size < 3) pick.set(x.id, x);
    return [...pick.values()].map((o) => ({ o, ratio: contrast(w.oklch, o.oklch) }));
  }, [d.swatches, w]);
  return (
    <InspectorGroup id="design.contrast" title={`Contrast of ${name}`} meta="vs the palette">
      {rows.length === 0 ? (
        <p className={s.hint}>Add another colour to compare it with.</p>
      ) : (
        <div className={s.contrast}>
          {rows.map(({ o, ratio }) => {
            const need = contrastTarget(w.role ?? o.role);
            const ok = ratio >= need;
            const [fg, bg] = w.oklch[0] < o.oklch[0] ? [w, o] : [o, w];
            return (
              <button key={o.id} type="button" className={s.crow} onClick={() => patchView({ dock: true })}>
                <span className={s.aa} style={{ background: cssColor(bg.oklch), color: cssColor(fg.oklch) }}>
                  Aa
                </span>
                <span className={s.cname}>{displayName(o)}</span>
                <span className={s.ratio}>{ratio.toFixed(2)}</span>
                <span className={cx(s.grade, !ok && ratio < 3 && s.bad)}>{ratio >= 7 ? 'AAA' : ratio >= 4.5 ? 'AA' : ratio >= 3 ? 'Large' : 'Fail'}</span>
              </button>
            );
          })}
        </div>
      )}
    </InspectorGroup>
  );
}

/** job names plus a free "Other" (spec 6.1) */
function Role({ w, onChange }: { w: Swatch; onChange(role: string | null): void }) {
  const custom = w.role !== null && !(ROLES as readonly string[]).includes(w.role);
  // "Other" chosen but not yet named; a role changed any other way (undo) ends it
  const [other, setOther] = useState(custom);
  useEffect(() => setOther(custom), [w.role]);
  const field = useRef<HTMLInputElement>(null);
  const value = other || custom ? OTHER : (w.role ?? '');
  return (
    <>
      <Select
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
      {value === OTHER && <TextInput ref={field} value={custom ? w.role! : ''} placeholder="Name the job" onCommit={(t) => onChange(t.trim() || null)} className={s.other} />}
    </>
  );
}
