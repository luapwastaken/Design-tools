import { useId, type KeyboardEvent } from 'react';
import type { IconName } from '../shell/tool.ts';
import { cx } from './cx.ts';
import { Icon } from './Icon.tsx';
import { InfoTip } from './InfoTip.tsx';
import { Tooltip } from './Tooltip.tsx';
import s from './Segmented.module.css';

export type SegmentedProps<T extends string> = {
  /** `tip`: the tooltip, and the accessible name of an icon alone; with a label, the label stays the name (voice control says it) and `tip` is its description */
  options: { value: T; label: string; icon?: IconName; tip?: string; /** a count after the label, in the danger tone (a check's problems); 0 shows nothing */ badge?: number; /** this segment can't be chosen yet (its `tip` says why) */ disabled?: boolean }[];
  value: T;
  onChange(v: T): void;
  /** a row label on the left, like a Slider's */
  label?: string;
  /** one sentence of help: an (i) after the row label shows it in a tooltip */
  info?: string;
  /** mono caps segments (format switches: OKLCH, RGB) */
  mono?: boolean;
  /** segments hug their labels instead of sharing the width */
  fit?: boolean;
  disabled?: boolean;
  className?: string;
};

const STEP: Record<string, number> = { ArrowLeft: -1, ArrowUp: -1, ArrowRight: 1, ArrowDown: 1 };

/** One Tab stop; arrow keys move and choose (brief §6). */
export function Segmented<T extends string>({ options, value, onChange, label, info, mono, fit, disabled, className }: SegmentedProps<T>) {
  const labelId = useId();
  const at = options.findIndex((o) => o.value === value);

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const n = options.length;
    let i = e.key === 'Home' ? 0 : e.key === 'End' ? n - 1 : e.key in STEP ? (Math.max(at, 0) + STEP[e.key] + n) % n : -1;
    if (i < 0) return;
    // past segments that can't be chosen
    for (let k = 0; k < n && options[i].disabled; k++) i = (i + (STEP[e.key] ?? 1) + n) % n;
    if (options[i].disabled) return;
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
            aria-label={o.label ? (o.badge ? `${o.label}, ${o.badge} to look at` : undefined) : o.tip}
            aria-description={o.label ? o.tip : undefined}
            tabIndex={i === at || (at < 0 && i === 0) ? 0 : -1}
            disabled={disabled || o.disabled}
            className={i === at ? s.on : undefined}
            onClick={() => o.value !== value && onChange(o.value)}
          >
            {o.icon && <Icon name={o.icon} size={16} />}
            {o.label}
            {!!o.badge && <span className={s.badge}>{o.badge > 99 ? '99+' : o.badge}</span>}
          </button>
        </Tooltip>
      ))}
    </div>
  );
  if (!label) return group;
  return (
    <div className={cx(s.row, className)}>
      <span className={s.label}>
        <span id={labelId} className="lbl">
          {label}
        </span>
        {info && <InfoTip text={info} />}
      </span>
      {group}
    </div>
  );
}
