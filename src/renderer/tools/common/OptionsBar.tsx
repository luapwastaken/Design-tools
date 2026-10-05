import type { ReactNode } from 'react';
import s from './OptionsBar.module.css';

/**
 * The 36px bar under the doc bar: the current mode's working controls in one row (Generate, Style,
 * Seed; a brush's size). A simple row: put `OptionsField`s and Buttons in it, a `<span style={{ flex: 1 }} />`
 * to push the rest right. Give the tool's `.work` grid a row of `var(--options-h)` for it.
 */
export function OptionsBar({ children }: { children: ReactNode }) {
  return (
    <div className={s.bar} role="toolbar" aria-label="Options">
      {children}
    </div>
  );
}

/** A label on the left (sans, --ink-2), the compact control after it. */
export function OptionsField({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className={s.field}>
      <span className={s.label}>{label}</span>
      {children}
    </div>
  );
}
