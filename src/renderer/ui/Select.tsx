import { useRef, useState } from 'react';
import { cx } from './cx.ts';
import { Icon } from './Icon.tsx';
import { menu } from './menu.ts';
import s from './Select.module.css';

export type SelectProps<T extends string> = {
  /** mono caps inside the field: `ROLE  Accent` */
  label?: string;
  options: { value: T; label: string; /** css colour of content */ swatch?: string }[];
  value: T;
  onChange(v: T): void;
  disabled?: boolean;
  /** the list's least width, for a field narrower than its options (the picker's model menu) */
  menuWidth?: number;
  className?: string;
};

/** Our own dropdown (hard rule 6: never a native <select>). The list is the shared menu popover. */
export function Select<T extends string>({ label, options, value, onChange, disabled, menuWidth = 0, className }: SelectProps<T>) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLButtonElement>(null);
  const at = options.findIndex((o) => o.value === value);
  const current = options[at];

  const show = () => {
    const el = ref.current!;
    const r = el.getBoundingClientRect();
    setOpen(true);
    menu.open(
      r,
      options.map((o) => ({ label: o.label, swatch: o.swatch, checked: o.value === value, onSelect: () => o.value !== value && onChange(o.value) })),
      { width: Math.max(r.width, menuWidth), initial: Math.max(at, 0), owner: el, role: 'listbox', onClose: () => setOpen(false) },
    );
  };

  return (
    <button
      ref={ref}
      type="button"
      className={cx(s.dd, className)}
      data-state={open ? 'open' : undefined}
      aria-haspopup="listbox"
      aria-expanded={open}
      aria-label={label ? `${label}: ${current?.label ?? ''}` : undefined}
      disabled={disabled}
      onClick={() => (open ? menu.close() : show())}
      onKeyDown={(e) => {
        if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
          e.preventDefault();
          if (!open) show();
        }
      }}
    >
      {label && <span className="lbl">{label}</span>}
      {current?.swatch !== undefined && <span className={s.chip} data-colour style={{ background: current.swatch }} />}
      <span className={s.value}>{current?.label ?? ''}</span>
      <Icon name="unfold_more" size={16} />
    </button>
  );
}
