import { cx } from './cx.ts';
import { Icon } from './Icon.tsx';
import s from './Toggle.module.css';

/**
 * A compact checkbox (Bone Ember has no switch): a box with a check, ember fill when on. The whole
 * thing, label included, is one button. `quiet`: neutral fill, for a long list of includes, so a
 * column of them isn't the loudest thing on screen; a setting keeps ember.
 */
export function Toggle({ checked, onChange, label, disabled, className, quiet }: { checked: boolean; onChange(v: boolean): void; label: string; disabled?: boolean; className?: string; quiet?: boolean }) {
  return (
    <button type="button" role="checkbox" aria-checked={checked} disabled={disabled} className={cx(s.tg, quiet && s.quiet, className)} onClick={() => onChange(!checked)}>
      <span className={s.box}>{checked && <Icon name="check" size={14} />}</span>
      {label}
    </button>
  );
}
