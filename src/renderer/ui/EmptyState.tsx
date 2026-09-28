import type { ReactNode } from 'react';
import type { IconName } from '../shell/tool.ts';
import { Button } from './Button.tsx';
import { cx } from './cx.ts';
import { Icon } from './Icon.tsx';
import s from './EmptyState.module.css';

export type EmptyStateProps = {
  icon: IconName;
  title: string;
  /** what to drop, paste or pick */
  detail?: ReactNode;
  /** the one action */
  action?: { label: string; icon?: IconName; onClick(): void };
  /** a problem to fix, not a place to drop: a solid edge, since the dashed one means "drop here" */
  problem?: boolean;
  className?: string;
};

export function EmptyState({ icon, title, detail, action, problem, className }: EmptyStateProps) {
  return (
    <div className={cx(s.empty, problem && s.problem, className)}>
      <Icon name={icon} size={20} />
      <b className={s.title}>{title}</b>
      {detail && <p className={s.detail}>{detail}</p>}
      {action && (
        <Button icon={action.icon} onClick={action.onClick} className={s.action}>
          {action.label}
        </Button>
      )}
    </div>
  );
}
