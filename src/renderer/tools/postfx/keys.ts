// The Post FX keys, as a list built from what is true now (the keymap asks on every keydown). The actions and the view's state come in as `Acts`, so the list is pure and the tests need no page.
import type { Shortcut } from '../../shell/tool.ts';
import { showOriginalKey } from '../common/flip.ts';
import { timeline, type PostFxDoc } from './doc.ts';

export type Acts = {
  /** the layer whose settings show */
  selected: string | null;
  /** focus is somewhere the arrows are the stack's (arrowsFree), not in the rail or the Library */
  free: boolean;
  /** the doc bar's Copy the PNG while it can run, else null */
  copy: (() => void) | null;
  open(): void;
  original(): void;
  select(id: string): void;
  move(id: string, to: number): void;
  toggle(id: string): void;
  duplicate(id: string): void;
  arm(id: string): void;
  step(by: number): void;
  play(): void;
};

export function postfxKeys(d: PostFxDoc, a: Acts): Shortcut[] {
  const stack = d.stack;
  const at = stack.findIndex((l) => l.id === a.selected);
  const sel = at < 0 ? null : stack[at];
  const animated = !!d.source && timeline(d).count > 1;
  const held = !a.free; // focus in the rail or the Library keeps its arrows
  const go = (to: number) => a.select(stack[Math.min(stack.length - 1, Math.max(0, to))].id);
  const layers = { group: 'Layers' };
  const play = { group: 'Playback', when: 'more than one frame', off: !animated };
  return [
    { keys: 'Ctrl+O', label: 'Open an image or a clip', group: 'Image', run: a.open },
    showOriginalKey(a.original),
    { keys: 'ArrowUp', label: 'Previous layer', ...layers, off: !stack.length || held, run: () => go(at < 0 ? 0 : at - 1) },
    { keys: 'ArrowDown', label: 'Next layer', ...layers, off: !stack.length || held, run: () => go(at + 1) },
    { keys: 'Alt+ArrowUp', label: 'Move the layer up', ...layers, off: !sel || held || at === 0, run: () => a.move(sel!.id, at - 1) },
    { keys: 'Alt+ArrowDown', label: 'Move the layer down', ...layers, off: !sel || held || at === stack.length - 1, run: () => a.move(sel!.id, at + 2) },
    { keys: 'Ctrl+Shift+H', label: 'Show or hide the layer', ...layers, off: !sel, run: () => a.toggle(sel!.id) },
    { keys: 'Ctrl+D', label: 'Duplicate the layer', ...layers, off: !sel, run: () => a.duplicate(sel!.id) },
    { keys: 'Delete', also: ['Backspace'], label: 'Delete the layer (asks first)', ...layers, off: !sel || held, run: () => a.arm(sel!.id) },
    // Space plays too, by useSpaceTap: shown here, never matched (a keymap match would double-toggle it)
    { keys: 'K', shown: ['Space'], label: 'Play / pause', ...play, run: a.play },
    { keys: 'ArrowLeft', label: 'Previous frame', ...play, run: () => a.step(-1) },
    { keys: 'ArrowRight', label: 'Next frame', ...play, run: () => a.step(1) },
    { keys: 'Shift+ArrowLeft', label: '10 frames back', ...play, run: () => a.step(-10) },
    { keys: 'Shift+ArrowRight', label: '10 frames forward', ...play, run: () => a.step(10) },
    { keys: 'Ctrl+Shift+C', label: 'Copy the PNG', group: 'Copy and export', off: !a.copy, run: () => a.copy?.() },
  ];
}
