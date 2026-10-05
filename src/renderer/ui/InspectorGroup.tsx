import { useState, type ReactNode } from 'react';
import { Module } from './Module.tsx';
import s from './InspectorGroup.module.css';

export type InspectorGroupProps = {
  /** sentence case: "Screen", "Light and shadow" */
  title: string;
  /** right-aligned mono meta: a count, a value, "6 on" */
  meta?: ReactNode;
  /** right-aligned small IconButtons (add, reset, copy), after the meta */
  actions?: ReactNode;
  /** a muted label after the title ("Horizontal" in "Proportions Horizontal") */
  sub?: string;
  /** open when first seen (default true); a remembered choice wins */
  defaultOpen?: boolean;
  /** with an id the folded state is remembered across launches: `<tool>.<group>`, e.g. "pattern.seams" */
  id?: string;
  children?: ReactNode;
  className?: string;
  footer?: ReactNode;
};

const KEY = 'dt.group.';
// a per-machine view preference: storage failing only means the default
const read = (id: string | undefined, fallback: boolean) => {
  try {
    const v = id && localStorage.getItem(KEY + id);
    return v === '1' ? true : v === '0' ? false : fallback;
  } catch {
    return fallback;
  }
};

/**
 * A collapsible group of the inspector: twirl, sentence-case title, meta and actions on the right.
 * The body keeps its rows in a --label-w (96px) column. A closed group's body stays mounted (hidden),
 * so what is in it keeps its state.
 */
export function InspectorGroup({ title, meta, actions, sub, defaultOpen = true, id, children, className, footer }: InspectorGroupProps) {
  const [open, setOpen] = useState(() => read(id, defaultOpen));
  const toggle = () => {
    setOpen(!open);
    try {
      if (id) localStorage.setItem(KEY + id, open ? '0' : '1');
    } catch {}
  };
  return (
    <Module title={title} sub={sub} readout={meta} actions={actions} collapse={{ open, onToggle: toggle }} className={className} footer={footer}>
      <div className={s.rows}>{children}</div>
    </Module>
  );
}
