import { Icon } from './Icon.tsx';
import s from './FieldError.module.css';

/** The message under a field in the error state. */
export function FieldError({ id, children }: { id?: string; children: string }) {
  return (
    <div id={id} role="alert" className={s.err}>
      <Icon name="error" size={14} />
      <span>{children}</span>
    </div>
  );
}
