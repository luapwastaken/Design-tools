import { useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent } from 'react';
import { createPortal } from 'react-dom';
import type { Oklch } from '../../shared/color/index.ts';
import { HexField } from './HexField.tsx';
import { Picker, type ColourGesture } from './Picker.tsx';
import { placeBelow } from './popover.ts';
import s from './ColorField.module.css';

export type ColorFieldProps = {
  value: Oklch;
  name?: string;
  disabled?: boolean;
  className?: string;
  /** controls board only */
  forceState?: 'focus';
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
      {open && field.current && (
        <PickerPopover anchor={field.current} value={p.value} onBegin={p.onBegin} onChange={p.onChange} onCommit={p.onCommit} onCancel={p.onCancel} onClose={close} />
      )}
    </>
  );
}

type PopoverProps = { anchor: HTMLElement; value: Oklch; onClose(refocus: boolean): void } & ColourGesture;

/** Below the field, scaled in from it. Stays open for the eyedropper; a press, scroll or focus outside closes it. */
function PickerPopover({ anchor, onClose, ...picker }: PopoverProps) {
  const ref = useRef<HTMLDivElement>(null);
  const live = useRef(onClose);
  live.current = onClose;
  const inside = (t: EventTarget | null) => t instanceof Node && (!!ref.current?.contains(t) || anchor.contains(t));

  useLayoutEffect(() => {
    const el = ref.current!;
    const at = placeBelow(anchor.getBoundingClientRect(), el.offsetWidth, el.offsetHeight, 'start', 4);
    el.style.left = `${at.x}px`;
    el.style.top = `${at.y}px`;
    el.style.transformOrigin = at.origin;
    el.querySelector<HTMLElement>('[data-plane]')?.focus({ preventScroll: true });
  }, []);

  useEffect(() => {
    const away = (e: Event) => inside(e.target) || live.current(false);
    const resize = () => live.current(false);
    addEventListener('pointerdown', away, true);
    addEventListener('scroll', away, true);
    addEventListener('focusin', away);
    addEventListener('resize', resize);
    return () => {
      removeEventListener('pointerdown', away, true);
      removeEventListener('scroll', away, true);
      removeEventListener('focusin', away);
      removeEventListener('resize', resize);
    };
  }, []);

  const onKeyDown = (e: KeyboardEvent) => {
    if (e.key === 'Tab') {
      // past either end: close onto the chip and let this Tab move on from there, as a menu does
      const stops = [...ref.current!.querySelectorAll<HTMLElement>('button, input, [tabindex]')].filter((el) => el.tabIndex >= 0 && !el.matches(':disabled'));
      if (document.activeElement === (e.shiftKey ? stops[0] : stops.at(-1))) onClose(true);
      return;
    }
    if (e.key !== 'Escape') return; // a field reverting its edit or a drag cancelling took theirs first
    e.preventDefault();
    e.stopPropagation();
    onClose(true);
  };

  return createPortal(
    <div
      ref={ref}
      role="dialog"
      aria-label="Colour picker"
      className={s.pop}
      onKeyDown={onKeyDown}
      onContextMenu={(e) => e.preventDefault()}
    >
      <Picker {...picker} />
    </div>,
    document.body,
  );
}
