import type { ReactNode } from 'react';
import { cx } from './cx.ts';
import { Icon } from './Icon.tsx';
import s from './SectionHeader.module.css';

export type SectionHeaderProps = {
  title: string;
  sub?: string;
  /** right-aligned mono readout, e.g. a count */
  readout?: ReactNode;
  actions?: ReactNode;
  /** with onToggle: a disclosure (a Library collection) */
  expanded?: boolean;
  onToggle?(): void;
  className?: string;
};

/** A heading inside a module body: a Library collection, a group of settings. */
export function SectionHeader({ title, sub, readout, actions, expanded = true, onToggle, className }: SectionHeaderProps) {
  const name = (
    <>
      {onToggle && <Icon name={expanded ? 'keyboard_arrow_down' : 'keyboard_arrow_right'} />}
      <span className={s.title}>{title}</span>
      {sub && <span className={s.sub}>{sub}</span>}
    </>
  );
  return (
    <div className={cx(s.head, onToggle && s.toggles, className)}>
      {onToggle ? (
        <button type="button" className={s.name} aria-expanded={expanded} onClick={onToggle}>
          {name}
        </button>
      ) : (
        <span className={s.name}>{name}</span>
      )}
      <span className={s.grow} />
      {readout !== undefined && <span className={s.readout}>{readout}</span>}
      {actions}
    </div>
  );
}
