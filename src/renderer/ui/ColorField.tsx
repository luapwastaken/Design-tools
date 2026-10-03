import { useRef, useState } from 'react';
import type { Oklch } from '../../shared/color/index.ts';
import { HexField } from './HexField.tsx';
import { Picker, type ColourGesture } from './Picker.tsx';
import { Popover } from './Popover.tsx';
import s from './ColorField.module.css';

export type ColorFieldProps = {
  value: Oklch;
  name?: string;
  disabled?: boolean;
  className?: string;
} & ColourGesture;

/**
 * A colour as a field (plan unit F): the chip opens the picker in a popover, the hex is typable
 * (Enter commits), the name sits dim on the right.
 */
export function ColorField(p: ColorFieldProps) {
  const [open, setOpen] = useState(false);
  const field = useRef<HTMLDivElement>(null);
  const chip = useRef<HTMLButtonElement>(null);
  const close = (refocus: boolean) => {
    setOpen(false);
    if (refocus) chip.current?.focus({ preventScroll: true });
  };
  return (
    <>
      <HexField {...p} ref={field} chipRef={chip} open={open} onChip={() => setOpen(!open)} />
      {/* the colour area takes focus, or with none (Sliders) the first field */}
      {open && field.current && (
        <Popover anchor={field.current} label="Colour picker" focus="[data-plane], input" onClose={close} className={s.pop}>
          <Picker value={p.value} onBegin={p.onBegin} onChange={p.onChange} onCommit={p.onCommit} onCancel={p.onCancel} />
        </Popover>
      )}
    </>
  );
}
