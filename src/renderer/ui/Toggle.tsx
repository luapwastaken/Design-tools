import { cx } from './cx.ts';
import s from './Toggle.module.css';

/**
 * A latching key: well track, lit signal when on. The whole thing, label included, is one button.
 * `quiet`: lit in neutral, for a long list of includes, so a column of them isn't the loudest thing
 * on screen; a setting keeps the signal.
 */
export function Toggle({ checked, onChange, label, disabled, className, quiet }: { checked: boolean; onChange(v: boolean): void; label: string; disabled?: boolean; className?: string; quiet?: boolean }) {
  return (
    <button type="button" role="switch" aria-checked={checked} disabled={disabled} className={cx(s.tg, quiet && s.quiet, className)} onClick={() => onChange(!checked)}>
      <span className={s.sw} />
      {label}
    </button>
  );
}
