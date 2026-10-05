import type { ReactNode } from 'react';
import { cx } from './cx.ts';
import { InfoTip } from './InfoTip.tsx';
import s from './InspectorRow.module.css';

export type InspectorRowProps = {
  label: string;
  /** one sentence of help, shown in a tooltip from an (i) after the label */
  info?: string;
  /** two values on one row (X/Y, across/down, from/to): the children share the value column equally */
  pair?: boolean;
  children?: ReactNode;
  className?: string;
};

/**
 * A row of an inspector group: the label on the left (sans, --ink-2, 96px), the value on the right.
 * For a slider use `Slider` itself (it draws the same label cell, and takes `info` too).
 */
export function InspectorRow({ label, info, pair, children, className }: InspectorRowProps) {
  return (
    <div className={cx(s.row, className)}>
      <span className={s.label}>
        <span className={s.text}>{label}</span>
        {info && <InfoTip text={info} />}
      </span>
      <div className={cx(s.value, pair && s.pair)}>{children}</div>
    </div>
  );
}
