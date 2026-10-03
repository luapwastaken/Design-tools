// A quick tap of Space plays and pauses in the tools with a timeline (After Effects' habit, spec §9).
import { useEffect, useRef, type RefObject } from 'react';
import { isTextField } from '../../shell/core/keys.ts';

/** a Space press shorter than this, with no drag in it, is a tap: longer, it pans the view */
const TAP_MS = 250;

/**
 * A tap of Space plays and pauses (spec §9: only a text field keeps Space), unless the tap was a pan.
 * The focused button isn't pressed by it; Enter still presses buttons, and an open menu keeps Space.
 */
export function useSpaceTap(el: RefObject<HTMLElement | null>, active: boolean, toggle: () => void) {
  const run = useRef(toggle);
  run.current = toggle;
  useEffect(() => {
    if (!active) return;
    let down: number | null = null;
    const onDown = (e: KeyboardEvent) => {
      if (e.key !== ' ' || e.ctrlKey || e.altKey || e.metaKey) return;
      const f = document.activeElement as HTMLElement | null;
      if ((f && (isTextField(f) || f.closest('[role="menu"], [role="listbox"]'))) || !el.current || !el.current.getClientRects().length || el.current.closest('[inert]')) return;
      e.preventDefault();
      if (!e.repeat) down = performance.now();
    };
    const onUp = (e: KeyboardEvent) => {
      if (e.key !== ' ' || down === null) return;
      e.preventDefault();
      if (performance.now() - down < TAP_MS) run.current();
      down = null;
    };
    const cancel = () => (down = null);
    addEventListener('keydown', onDown);
    addEventListener('keyup', onUp);
    addEventListener('pointerdown', cancel, true);
    addEventListener('blur', cancel);
    return () => {
      removeEventListener('keydown', onDown);
      removeEventListener('keyup', onUp);
      removeEventListener('pointerdown', cancel, true);
      removeEventListener('blur', cancel);
    };
  }, [active]);
}
