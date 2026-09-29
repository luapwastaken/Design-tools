import { useId, useState, type KeyboardEvent, type ReactNode, type Ref } from 'react';
import type { IconName } from '../shell/tool.ts';
import { cx } from './cx.ts';
import { FieldError } from './FieldError.tsx';
import { Icon } from './Icon.tsx';
import s from './TextInput.module.css';

export type TextInputProps = {
  value: string;
  /** Enter or blur, with changed text that passes `validate` */
  onCommit(v: string): void;
  placeholder?: string;
  /** mono caps inside the field, like a Select */
  label?: string;
  /** a message when the text can't be committed */
  validate?(v: string): string | null;
  autoFocus?: boolean;
  selectOnFocus?: boolean;
  /** Esc, or Enter or blur without a committable change: the text went back to `value` */
  onCancel?(): void;
  /** every keystroke, for live filtering */
  onChange?(v: string): void;
  /** leading icon, e.g. search */
  icon?: IconName;
  /** trailing content, e.g. a Kbd hint */
  end?: ReactNode;
  mono?: boolean;
  /** an error from outside the field */
  error?: string;
  className?: string;
  ref?: Ref<HTMLInputElement>;
};

/**
 * A text field that commits a changed text on Enter or blur and reverts on Esc. Invalid text stays
 * in the field with its message and isn't committed; blur then reverts it.
 */
export function TextInput(p: TextInputProps) {
  const { value, placeholder, label, autoFocus, selectOnFocus, icon, end, mono, className, ref } = p;
  const [text, setText] = useState<string | null>(null); // non-null while holding an uncommitted edit
  const [problem, setProblem] = useState<string | null>(null);
  const errId = useId();
  const message = problem ?? p.error ?? null;

  const revert = () => {
    setText(null);
    setProblem(null);
  };

  const cancel = () => {
    revert();
    p.onCancel?.();
  };

  /** false when the text can't be committed (the field then shows why) */
  const tryCommit = () => {
    // unchanged commits nothing, so a rename that kept its name isn't a rename
    if (text === null || text === value) {
      cancel();
      return true;
    }
    const why = p.validate?.(text) ?? null;
    if (why) {
      setProblem(why);
      return false;
    }
    revert();
    p.onCommit(text);
    return true;
  };

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      tryCommit();
    } else if (e.key === 'Escape' && ((text !== null && text !== value) || problem || p.onCancel)) {
      e.preventDefault();
      e.stopPropagation();
      p.onChange?.(value);
      cancel();
    }
  };

  return (
    <div className={cx(s.wrap, className)}>
      <label className={cx(s.tf, mono && s.mono)} data-error={message ? '' : undefined}>
        {icon && <Icon name={icon} size={16} />}
        {label && <span className="lbl">{label}</span>}
        <input
          ref={ref}
          type="text"
          value={text ?? value}
          placeholder={placeholder}
          spellCheck={false}
          autoComplete="off"
          autoFocus={autoFocus}
          aria-invalid={message ? true : undefined}
          aria-describedby={message ? errId : undefined}
          data-dirty={text !== null ? 'true' : undefined}
          onChange={(e) => {
            setText(e.target.value);
            setProblem(null);
            p.onChange?.(e.target.value);
          }}
          onFocus={(e) => selectOnFocus && e.target.select()}
          onBlur={() => tryCommit() || cancel()}
          onKeyDown={onKeyDown}
        />
        {end}
      </label>
      {message && <FieldError id={errId}>{message}</FieldError>}
    </div>
  );
}
