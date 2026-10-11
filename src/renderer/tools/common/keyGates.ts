// Gates for tool shortcuts that share the keyboard with the page: copy with text selected, and the
// bare arrow keys while focus is somewhere that scrolls or steps by itself. Each is read in a tool's
// shortcuts(), which the keymap calls on every keydown, so `off: copyOff()` is decided at that moment.
import { isTextField, type FieldLike } from '../../shell/core/keys.ts';

/** Ctrl+C belongs to the page, not the tool, when text is selected (`selected` is the selection's text) or a text field has focus; pure for the test */
export const copyIsNative = (selected: string, el: FieldLike | null | undefined): boolean => selected !== '' || isTextField(el);

/** for a live Ctrl+C: `off: copyOff()` */
export const copyOff = (): boolean => copyIsNative(window.getSelection()?.toString() ?? '', document.activeElement as HTMLElement | null);

type Focus = { closest(selector: string): unknown } | null | undefined;

/**
 * Bare Up/Down/PageUp/PageDown are the tool's when nothing has focus (the body) or focus is inside
 * the tool's own view; focus in the rail or Library keeps them, as design/actions.ts step() does. With
 * `area`, a selector, focus inside the tool but outside that area (an inspector panel that scrolls)
 * keeps them too. Pure for the test.
 */
export function arrowsAreMine(tool: string, el: Focus, body: unknown, area?: string): boolean {
  if (!el || el === body) return true;
  if (!el.closest(`[data-tool="${tool}"]`)) return false;
  return !area || !!el.closest(area);
}

/** for a live bare arrow: `off: !arrowsFree('logo')` */
export const arrowsFree = (tool: string, area?: string): boolean => arrowsAreMine(tool, document.activeElement, document.body, area);
