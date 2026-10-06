import type { MouseEvent, ReactNode, Ref } from 'react';
import type { IconName } from '../shell/tool.ts';
import { cx } from './cx.ts';
import { Icon } from './Icon.tsx';
import { ariaKeys } from './Kbd.tsx';
import { Tooltip } from './Tooltip.tsx';
import s from './Button.module.css';

export type ButtonProps = {
  variant?: 'primary' | 'secondary' | 'ghost' | 'danger';
  size?: 'xs' | 'md' | 'lg';
  icon?: IconName;
  /** trailing icon, e.g. `chevron_right` on "Send to" */
  iconEnd?: IconName;
  children?: ReactNode;
  onClick?(e: MouseEvent<HTMLButtonElement>): void;
  disabled?: boolean;
  /** a toggle that is on: raised, aria-pressed */
  latched?: boolean;
  tooltip?: string;
  shortcut?: string;
  type?: 'button' | 'submit';
  autoFocus?: boolean;
  /** -1 for a mouse shortcut to a command the keyboard reaches another way (a Library row's menu) */
  tabIndex?: number;
  className?: string;
  ref?: Ref<HTMLButtonElement>;
};

const ICON = { xs: 14, md: 16, lg: 16 } as const;

export function Button({ variant = 'secondary', size = 'md', icon, iconEnd, children, onClick, disabled, latched, tooltip, shortcut, type = 'button', autoFocus, tabIndex, className, ref }: ButtonProps) {
  const button = (
    <button
      ref={ref}
      type={type}
      className={cx(s.btn, s[variant], s[size], className)}
      disabled={disabled}
      autoFocus={autoFocus}
      tabIndex={tabIndex}
      aria-keyshortcuts={shortcut && ariaKeys(shortcut)}
      aria-pressed={latched}
      onClick={onClick}
    >
      {icon && <Icon name={icon} size={ICON[size]} />}
      {children}
      {iconEnd && <Icon name={iconEnd} size={ICON[size]} />}
    </button>
  );
  const tip = tooltip ?? (shortcut && typeof children === 'string' ? children : undefined);
  return tip ? <Tooltip content={tip} shortcut={shortcut}>{button}</Tooltip> : button;
}
