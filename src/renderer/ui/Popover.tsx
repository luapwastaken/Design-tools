import { createContext, useContext, useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { cx } from './cx.ts';
import { menuStore } from './menu.ts';
import { placeBelow } from './popover.ts';
import s from './Popover.module.css';

/** a popover opened from inside another hands its panel up, so presses in it count as inside every one below */
const Nest = createContext<((el: HTMLElement) => () => void) | null>(null);

const STOPS = 'button, input, textarea, [tabindex]';

type Props = {
  anchor: HTMLElement;
  label: string;
  /** under the anchor's left edge, or its right (a button at the end of a bar) */
  align?: 'start' | 'end';
  /** what takes focus when it opens: the first match */
  focus?: string;
  onClose(refocus: boolean): void;
  className?: string;
  children: ReactNode;
};

/**
 * A panel under its trigger (a colour field's chip, Export, the paints button), scaled in from it and
 * kept in the window as it grows. A press, scroll or focus outside, Esc, or a Tab past either end
 * closes it; a menu or popover opened from inside it counts as inside.
 */
export function Popover({ anchor, label, align = 'start', focus = STOPS, onClose, className, children }: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const live = useRef(onClose);
  live.current = onClose;
  const nested = useRef(new Set<HTMLElement>());
  const parent = useContext(Nest);
  const [register] = useState(() => (el: HTMLElement) => {
    nested.current.add(el);
    const off = parent?.(el);
    return () => {
      nested.current.delete(el);
      off?.();
    };
  });
  const panels = () => [ref.current!, ...nested.current];
  // a menu it opened (a Select's list) keeps it open, whatever that menu's press or Esc does
  const ownsMenu = () => {
    const owner = menuStore.get()?.opts.owner;
    return !!owner && panels().some((p) => p.contains(owner));
  };
  const inside = (t: EventTarget | null) => t instanceof Node && (anchor.contains(t) || panels().some((p) => p.contains(t)) || ownsMenu());

  useLayoutEffect(() => {
    const el = ref.current!;
    const off = parent?.(el);
    const place = () => {
      const a = anchor.getBoundingClientRect();
      const w = el.offsetWidth;
      const at = placeBelow(align === 'end' ? new DOMRect(a.right - w, a.y, w, a.height) : a, w, el.offsetHeight, 'start', 4);
      el.style.left = `${at.x}px`;
      el.style.top = `${at.y}px`;
      // scaled from the trigger's middle, wherever the panel lands
      el.style.transformOrigin = `${Math.min(Math.max(a.left + a.width / 2 - at.x, 0), w)}px ${at.origin.split(' ')[1]}`;
    };
    place();
    el.querySelector<HTMLElement>(focus)?.focus({ preventScroll: true });
    // a change inside (the picker's style) changes its size
    const ro = new ResizeObserver(place);
    ro.observe(el);
    return () => {
      ro.disconnect();
      off?.();
    };
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
      // past either end: close onto the trigger and let this Tab move on from there, as a menu does
      const stops = [...ref.current!.querySelectorAll<HTMLElement>(STOPS)].filter((el) => el.tabIndex >= 0 && !el.matches(':disabled'));
      if (document.activeElement === (e.shiftKey ? stops[0] : stops.at(-1))) onClose(true);
      return;
    }
    if (e.key !== 'Escape') return; // a field reverting its edit, a drag cancelling or a confirm took theirs first
    e.preventDefault();
    e.stopPropagation();
    onClose(true);
  };

  return createPortal(
    <Nest.Provider value={register}>
      <div ref={ref} role="dialog" aria-label={label} className={cx(s.pop, className)} onKeyDown={onKeyDown} onContextMenu={(e) => e.preventDefault()}>
        {children}
      </div>
    </Nest.Provider>,
    document.body,
  );
}
