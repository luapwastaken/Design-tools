import { useId, type KeyboardEvent } from 'react';
import type { IconName } from '../shell/tool.ts';
import { cx } from './cx.ts';
import { Icon } from './Icon.tsx';
import { Tooltip } from './Tooltip.tsx';
import s from './Segmented.module.css';

export type SegmentedProps<T extends string> = {
  /** `tip`: the full name, for a label shortened to fit (it becomes the tooltip and the accessible name) */
  options: { value: T; label: string; icon?: IconName; tip?: string }[];
  value: T;
  onChange(v: T): void;
  /** a row label on the left, like a Slider's */
  label?: string;
  /** mono caps segments (format switches: OKLCH, RGB) */
  mono?: boolean;
  /** segments hug their labels instead of sharing the width */
  fit?: boolean;
  disabled?: boolean;
  className?: string;
};

const STEP: Record<string, number> = { ArrowLeft: -1, ArrowUp: -1, ArrowRight: 1, ArrowDown: 1 };

/** One Tab stop; arrow keys move and choose (brief §6). */
export function Segmented<T extends string>({ options, value, onChange, label, mono, fit, disabled, className }: SegmentedProps<T>) {
  const labelId = useId();
  const at = options.findIndex((o) => o.value === value);

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const n = options.length;
    const i = e.key === 'Home' ? 0 : e.key === 'End' ? n - 1 : e.key in STEP ? (Math.max(at, 0) + STEP[e.key] + n) % n : -1;
    if (i < 0) return;
    e.preventDefault();
    onChange(options[i].value);
    (e.currentTarget.children[i] as HTMLElement | undefined)?.focus();
  };

  const group = (
    <div
      role="radiogroup"
      aria-labelledby={label ? labelId : undefined}
      aria-disabled={disabled || undefined}
      className={cx(s.seg, mono && s.mono, fit && s.fit, !label && className)}
      onKeyDown={disabled ? undefined : onKeyDown}
    >
      {options.map((o, i) => (
        <Tooltip key={o.value} content={o.tip} disabled={!o.tip}>
          <button
            type="button"
            role="radio"
            aria-checked={i === at}
            aria-label={o.tip}
            tabIndex={i === at || (at < 0 && i === 0) ? 0 : -1}
            disabled={disabled}
            className={i === at ? s.on : undefined}
            onClick={() => o.value !== value && onChange(o.value)}
          >
            {o.icon && <Icon name={o.icon} size={16} />}
            {o.label}
          </button>
        </Tooltip>
      ))}
    </div>
  );
  if (!label) return group;
  return (
    <div className={cx(s.row, className)}>
      <span id={labelId} className={cx('lbl', s.label)}>
        {label}
      </span>
      {group}
    </div>
  );
}
