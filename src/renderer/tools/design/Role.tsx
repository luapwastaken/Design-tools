// A swatch's role: the seven jobs plus a free "Other" (spec 6.1).
import { useEffect, useRef, useState } from 'react';
import { ROLES } from '../../../shared/palette/roles.ts';
import type { Swatch } from '../../../shared/types.ts';
import { Select, TextInput } from '../../ui/index.ts';
import s from './Picker.module.css';

const OTHER = 'other';
const ROLE_OPTIONS = [{ value: '', label: 'No role' }, ...ROLES.map((r) => ({ value: r as string, label: r as string })), { value: OTHER, label: 'Other…' }];

export function Role({ w, onChange }: { w: Swatch; onChange(role: string | null): void }) {
  const custom = w.role !== null && !(ROLES as readonly string[]).includes(w.role);
  // "Other" chosen but not yet named; a role changed any other way (undo) ends it
  const [other, setOther] = useState(custom);
  useEffect(() => setOther(custom), [w.role]);
  const field = useRef<HTMLInputElement>(null);
  const value = other || custom ? OTHER : (w.role ?? '');
  return (
    <>
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
        className={s.role}
      />
      {value === OTHER && <TextInput ref={field} value={custom ? w.role! : ''} placeholder="Name the job" onCommit={(t) => onChange(t.trim() || null)} className={s.other} />}
    </>
  );
}
