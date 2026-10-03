import type { IconName } from '../shell/tool.ts';
import { cx } from './cx.ts';
import s from './Icon.module.css';

/** Material Symbols Rounded (hard rule 1: the only way icons render). 18px unless told otherwise. */
export function Icon({ name, size, fill, className }: { name: IconName; size?: 14 | 16 | 18 | 20; fill?: boolean; className?: string }) {
  return (
    <span aria-hidden="true" className={cx('material-symbols-rounded', size && size !== 18 && s[`s${size}`], fill && s.fill, className)}>
      {name}
    </span>
  );
}
