import type { MouseEvent, Ref } from 'react';
import type { IconName } from '../shell/tool.ts';
import { cx } from './cx.ts';
import { Icon } from './Icon.tsx';
import { ariaKeys } from './Kbd.tsx';
import { Tooltip } from './Tooltip.tsx';
import s from './IconButton.module.css';

export type IconButtonProps = {
  icon: IconName;
  /** tooltip and aria-label */
  label: string;
  /** the tooltip, where it says more than the name does (a toggle's name must not change with its state) */
  tip?: string;
  size?: 'md' | 'sm' | 'xs';
  /** a toggle that is on: raised, filled icon, aria-pressed */
  latched?: boolean;
  onClick?(e: MouseEvent<HTMLButtonElement>): void;
  disabled?: boolean;
  shortcut?: string;
  /** -1 for a mouse shortcut to a command the keyboard reaches another way (a Library row's menu) */
  tabIndex?: number;
  className?: string;
  ref?: Ref<HTMLButtonElement>;
  /** draw on top of a content colour (a swatch) with the --on-content tokens */
  onContent?: boolean;
};

const ICON = { md: 18, sm: 16, xs: 14 } as const;

export function IconButton({ icon, label, tip, size = 'md', latched, onClick, disabled, shortcut, tabIndex, className, ref, onContent }: IconButtonProps) {
  return (
    <Tooltip content={tip ?? label} shortcut={shortcut}>
      <button
        ref={ref}
        type="button"
        className={cx(s.ib, s[size], onContent && s.onContent, className)}
        aria-label={label}
        aria-pressed={latched}
        aria-keyshortcuts={shortcut && ariaKeys(shortcut)}
        disabled={disabled}
        tabIndex={tabIndex}
        onClick={onClick}
      >
        <Icon name={icon} size={ICON[size]} fill={latched} />
      </button>
    </Tooltip>
  );
}
