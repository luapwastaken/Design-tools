import { useId, useState, type KeyboardEvent, type Ref } from 'react';
import { cssColor, parseHex, toHex, type Oklch } from '../../shared/color/index.ts';
import { fromHex } from '../../shared/color/picker.ts';
import { cx } from './cx.ts';
import { FieldError } from './FieldError.tsx';
import type { ColourGesture } from './Picker.tsx';
import { Tooltip } from './Tooltip.tsx';
import s from './HexField.module.css';

export type HexFieldProps = {
  value: Oklch;
  /** dim, on the right: the swatch's name; without one the field says "Hex" */
  name?: string;
  disabled?: boolean;
  /** makes the chip a button (ColorField opens its picker with it); otherwise the chip only shows */
  onChip?(): void;
  /** the chip's picker is open */
  open?: boolean;
  chipRef?: Ref<HTMLButtonElement>;
  className?: string;
  ref?: Ref<HTMLDivElement>;
} & ColourGesture;

const PROBLEM = 'Type a hex colour: 3 or 6 digits, # optional.';

/**
 * A colour chip and its hex, typable (brief §6 fields): Enter or blur commits, Esc reverts. A hex
 * that doesn't parse stays with its message and is never committed; blur then reverts it.
 */
export function HexField(p: HexFieldProps) {
  const { value, name, disabled, onChip, open, chipRef, className, ref } = p;
  const hex = toHex(value);
  const [text, setText] = useState<string | null>(null); // non-null while holding an uncommitted edit
  const [problem, setProblem] = useState<string | null>(null);
  const errId = useId();

  const revert = () => {
    setText(null);
    setProblem(null);
  };

  /** false when the text can't be committed (the field then shows why) */
  const tryCommit = () => {
    if (text === null) return true;
    const typed = parseHex(text);
    if (!typed) {
      setProblem(PROBLEM);
      return false;
    }
    revert();
    if (typed !== hex) {
      p.onBegin?.();
      p.onChange(fromHex(typed, value[2]));
      p.onCommit?.();
    }
    return true;
  };

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    const el = e.currentTarget;
    if (e.key === 'Enter') {
      e.preventDefault();
      if (tryCommit()) requestAnimationFrame(() => el.select());
    } else if (e.key === 'Escape' && (text !== null || problem)) {
      e.preventDefault();
      e.stopPropagation(); // the revert takes this Esc; the next one reaches the popover
      revert();
    }
  };

  const colour = { background: cssColor(value) };

  return (
    <div className={cx(s.wrap, className)}>
      <div
        ref={ref}
        className={s.cf}
        data-open={open ? '' : undefined}
        data-error={problem ? '' : undefined}
        data-disabled={disabled ? '' : undefined}
      >
        {onChip ? (
          <Tooltip content="Open picker" disabled={disabled}>
            <button
              ref={chipRef}
              type="button"
              className={s.chip}
              style={colour}
              aria-label={name ? `Pick ${name}` : 'Open picker'}
              aria-haspopup="dialog"
              aria-expanded={!!open}
              disabled={disabled}
              onClick={onChip}
            />
          </Tooltip>
        ) : (
          <span className={s.chip} style={colour} />
        )}
        <input
          type="text"
          value={text ?? hex}
          aria-label={name ? `${name}, hex` : 'Hex'}
          aria-invalid={problem ? true : undefined}
          aria-describedby={problem ? errId : undefined}
          spellCheck={false}
          autoComplete="off"
          disabled={disabled}
          data-dirty={text !== null ? 'true' : undefined}
          onChange={(e) => {
            setText(e.target.value);
            setProblem(null);
          }}
          onFocus={(e) => e.target.select()}
          onBlur={() => tryCommit() || revert()}
          onKeyDown={onKeyDown}
        />
        {/* unnamed, the slot is the field's own mono label, as the mockups draw it */}
        {name === undefined ? (
          <span className="lbl">Hex</span>
        ) : (
          <Tooltip content={name} overflowOnly>
            <span className={s.name}>{name}</span>
          </Tooltip>
        )}
      </div>
      {problem && <FieldError id={errId}>{problem}</FieldError>}
    </div>
  );
}
