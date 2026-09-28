import { cx } from './cx.ts';
import s from './Toggle.module.css';

/** A latching key: well track, lit signal when on. The whole thing, label included, is one button. */
export function Toggle({ checked, onChange, label, disabled, className }: { checked: boolean; onChange(v: boolean): void; label: string; disabled?: boolean; className?: string }) {
  return (
    <button type="button" role="switch" aria-checked={checked} disabled={disabled} className={cx(s.tg, className)} onClick={() => onChange(!checked)}>
      <span className={s.sw} />
      {label}
    </button>
  );
}
