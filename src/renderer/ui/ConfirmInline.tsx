import { useEffect, useRef, type ReactNode } from 'react';
import type { IconName } from '../shell/tool.ts';
import { Button } from './Button.tsx';
import { cx } from './cx.ts';
import { Icon } from './Icon.tsx';
import s from './ConfirmInline.module.css';

export type ConfirmInlineProps = {
  icon?: IconName;
  /** what will happen: `Delete palette "Rust test"?` */
  title: string;
  /** what is kept, from facts the app knows (brief §6) */
  detail?: ReactNode;
  confirmLabel: string;
  danger?: boolean;
  onConfirm(): void;
  onKeep(): void;
  /** for a narrow item (a swatch chip): no indent, and the buttons wrap */
  compact?: boolean;
};

/** The armed state of a destructive action, in place of the item. Focus lands on Keep; Esc keeps. */
export function ConfirmInline({ icon, title, detail, confirmLabel, danger, onConfirm, onKeep, compact }: ConfirmInlineProps) {
  const keep = useRef<HTMLButtonElement>(null);
  useEffect(() => keep.current?.focus({ preventScroll: true }), []);
  return (
    <div
      role="alertdialog"
      aria-label={title}
      className={cx(s.arm, compact && s.compact)}
      onKeyDown={(e) => {
        if (e.key !== 'Escape') return;
        e.preventDefault();
        e.stopPropagation();
        onKeep();
      }}
    >
      <div className={s.q}>
        {icon && <Icon name={icon} />}
        <span>{title}</span>
      </div>
      {detail && <div className={s.detail}>{detail}</div>}
      <div className={s.actions}>
        <Button variant={danger ? 'danger' : 'primary'} onClick={onConfirm}>
          {confirmLabel}
        </Button>
        <Button ref={keep} variant="ghost" onClick={onKeep}>
          Keep
        </Button>
        {!compact && (
          <>
            <span className={s.grow} />
            <span className="lbl">Esc keeps</span>
          </>
        )}
      </div>
    </div>
  );
}
