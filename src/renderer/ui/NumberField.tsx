import { useEffect, useId, useRef, useState, type KeyboardEvent, type Ref } from 'react';
import { cx } from './cx.ts';
import { parseNumber } from './expr.ts';
import { FieldError } from './FieldError.tsx';
import { clamp, decimalsOf, roundTo, useScrub, wrapTo, type NumberGesture } from './scrub.ts';
import s from './NumberField.module.css';

export type { NumberGesture } from './scrub.ts';

export type NumberFieldProps = {
  label: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  unit?: string;
  /** decimals shown; default from `step` */
  precision?: number;
  disabled?: boolean;
  /** the label still names the input for screen readers; a Slider draws its own */
  hideLabel?: boolean;
  /** 'sm' is the 22px field that sits in a module header */
  size?: 'md' | 'sm';
  width?: number | string;
  className?: string;
  /** an error from outside the field (shown like an out-of-range entry) */
  error?: string;
  /** take the error message to show elsewhere (the module footer when the row can't grow) */
  onError?(message: string | null): void;
  ref?: Ref<HTMLInputElement>;
  /** a Slider's track or label drag is setting the value: a typed edit it would overwrite is dropped */
  dragging?: boolean;
  /** a circular value (hue): typing or stepping past an end wraps round; a drag stays clamped */
  wrap?: boolean;
} & NumberGesture;

const format = (v: number, precision: number) => roundTo(v, precision).toFixed(precision);

// A press elsewhere blurs the field before its click lands; a refused entry's message going then
// would move the rows under the pointer and lose that click. So the revert waits for the press to end.
let pressing = false;
let watching = false;
function watchPresses() {
  if (watching) return;
  watching = true;
  addEventListener('pointerdown', () => (pressing = true), true);
  for (const type of ['pointerup', 'pointercancel']) addEventListener(type, () => (pressing = false), true);
}
function afterPress(fn: () => void) {
  if (!pressing) return fn();
  const done = () => {
    removeEventListener('pointerup', done, true);
    removeEventListener('pointercancel', done, true);
    setTimeout(fn);
  };
  addEventListener('pointerup', done, true);
  addEventListener('pointercancel', done, true);
}

/**
 * A number you drag or type (brief §6). The mono label is the scrub handle; the value is a text
 * input. Arrow keys step, Shift ×10. Enter or blur commits; Esc reverts. An out-of-range entry
 * stays in the field with a message and is never committed; blur then reverts it.
 */
export function NumberField(p: NumberFieldProps) {
  const { label, value, min, max, step = 1, unit, disabled, hideLabel, size = 'md', width, className, onError, ref, wrap } = p;
  const precision = p.precision ?? decimalsOf(step);
  const [text, setText] = useState<string | null>(null); // non-null while holding an uncommitted edit
  const [problem, setProblem] = useState<string | null>(null);
  const input = useRef<HTMLInputElement | null>(null);
  const errId = useId();
  const message = problem ?? p.error ?? null;

  const scrub = useScrub({ ...p, step, precision, onClick: () => input.current?.focus() });

  useEffect(() => onError?.(message), [message]);
  useEffect(watchPresses, []);

  // a drag drops a typed edit; otherwise the next blur would commit the stale text over it
  useEffect(() => {
    if (!scrub.active && !p.dragging) return;
    setText(null);
    setProblem(null);
  }, [scrub.active, p.dragging]);

  const range = `${label} runs ${format(min, precision)} to ${format(max, precision)}${unit ? ` ${unit}` : ''}.`;

  const commit = (v: number, fromKey = false) => {
    if (v === value) return;
    p.onBegin?.();
    p.onChange(v);
    p.onCommit?.(fromKey);
  };

  const revert = () => {
    setText(null);
    setProblem(null);
  };

  /** false when the text can't be committed (the field then shows why) */
  const tryCommit = () => {
    if (text === null) return true;
    const typed = parseNumber(text, unit);
    const v = typed === null ? null : roundTo(wrap ? wrapTo(typed, min, max) : typed, precision); // commit only what the field shows
    if (v === null || v < min || v > max) {
      setProblem(v === null ? `Type a number. ${range}` : `Out of range. ${range}`);
      return false;
    }
    revert();
    commit(v);
    return true;
  };

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    const el = e.currentTarget;
    if (e.key === 'Enter') {
      e.preventDefault();
      if (tryCommit()) requestAnimationFrame(() => el.select());
    } else if (e.key === 'Escape') {
      if (text === null && !problem) return; // nothing to revert: let Esc through
      e.preventDefault();
      e.stopPropagation();
      revert();
      requestAnimationFrame(() => el.select());
    } else if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
      e.preventDefault();
      const from = (text === null ? null : parseNumber(text, unit)) ?? value;
      const dir = e.key === 'ArrowUp' ? 1 : -1;
      revert();
      const next = from + dir * step * (e.shiftKey ? 10 : 1);
      commit(wrap ? roundTo(wrapTo(next, min, max), precision) : clamp(roundTo(next, precision), min, max), true);
      requestAnimationFrame(() => el.select());
    }
  };

  const state = scrub.active ? 'scrub' : undefined;

  return (
    <div className={cx(s.wrap, className)} style={width === undefined ? undefined : { width }}>
      <div
        className={cx(s.nf, s[size])}
        data-state={state}
        data-error={message ? '' : undefined}
        data-disabled={disabled ? '' : undefined}
        onPointerDown={(e) => {
          // a click anywhere on the field (but the label and the input) puts the caret in it
          if (e.target === e.currentTarget && !disabled) {
            e.preventDefault();
            input.current?.focus();
          }
        }}
      >
        {!hideLabel && (
          <span className={s.label} aria-hidden="true" {...scrub.handlers}>
            {label}
          </span>
        )}
        <input
          ref={(el) => {
            input.current = el;
            if (typeof ref === 'function') ref(el);
            else if (ref) ref.current = el;
          }}
          type="text"
          inputMode="decimal"
          role="spinbutton"
          aria-label={label}
          aria-valuemin={min}
          aria-valuemax={max}
          aria-valuenow={value}
          aria-invalid={message ? true : undefined}
          aria-describedby={message ? errId : undefined}
          spellCheck={false}
          autoComplete="off"
          disabled={disabled}
          data-dirty={text !== null ? 'true' : undefined}
          value={text ?? format(value, precision)}
          onChange={(e) => {
            setText(e.target.value);
            setProblem(null);
          }}
          onFocus={(e) => e.target.select()}
          onBlur={() => tryCommit() || afterPress(revert)}
          onKeyDown={onKeyDown}
        />
        {unit && <span className={s.unit}>{unit}</span>}
      </div>
      {message && !onError && <FieldError id={errId}>{message}</FieldError>}
    </div>
  );
}
