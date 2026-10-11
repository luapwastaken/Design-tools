// Halftone's keyboard: the list shortcuts() returns, and the two things a key and a click share, the
// ink's eye and the dot shape. Kept free of React and the shell so the list is unit tested
// (test/halftone-keys.test.ts); what needs the view or the file picker comes in as `hooks`.
import type { DocController } from '../../../shared/doc-api.ts';
import type { Shortcut } from '../../shell/tool.ts';
import { showOriginalKey } from '../common/flip.ts';
import { mapInk, type HalftoneDoc, type Shape } from './doc.ts';
import type { Show } from './view-state.ts';

type Doc = DocController<HalftoneDoc>;

export const SHAPES: { value: Shape; label: string; tip: string }[] = [
  { value: 'round', label: 'Round', tip: 'Round dots: the classic screen' },
  { value: 'ellipse', label: 'Ellipse', tip: 'Elliptical dots, which chain smoothly through the midtones' },
  { value: 'square', label: 'Square', tip: 'Square dots' },
  { value: 'diamond', label: 'Diamond', tip: 'Diamond dots' },
  { value: 'line', label: 'Line', tip: 'A line screen: bars that thicken with the tone' },
  { value: 'cross', label: 'Cross', tip: 'Crosses' },
  { value: 'stochastic', label: 'Stochastic (FM)', tip: 'Single printer dots scattered by blue noise: no angles, no rosettes, no SVG' },
];

/** `step` places along the shapes from `idx`, stopping at the ends */
export const stepIndex = (idx: number, step: number): number => Math.min(SHAPES.length - 1, Math.max(0, idx + step));

export function setShape(doc: Doc, shape: Shape): void {
  doc.transact(`Screen with ${SHAPES.find((x) => x.value === shape)!.label.toLowerCase()} dots`, (x) => ({ ...x, screen: { ...x.screen, shape } }));
}

/** the previous (-1) or next (1) dot shape, in the order of the Screen group's keys */
export function stepShape(doc: Doc, step: number): void {
  const idx = SHAPES.findIndex((x) => x.value === doc.get().screen.shape);
  const next = stepIndex(idx, step);
  if (next !== idx) setShape(doc, SHAPES[next].value);
}

/** an ink's eye: show it, or hide it (its plate and its dots go from the view and the exports) */
export function toggleInk(doc: Doc, id: string): void {
  const ink = doc.get().inks.find((k) => k.id === id);
  if (!ink) return;
  doc.transact(ink.visible ? `Hide ${ink.name}` : `Show ${ink.name}`, (x) => mapInk(x, id, (k) => ({ ...k, visible: !k.visible })));
}

/** Copy the PNG lives in the view's export hook; View keeps this pointed at it while the tool shows */
export const copyPng: { now: { run(): void; off: boolean } | null } = { now: null };

const VIEWS: { show: Show; label: string }[] = [
  { show: 'original', label: 'Original' },
  { show: 'result', label: 'Result' },
  { show: 'separations', label: 'Separations' },
];

export type KeyHooks = { pick(): void; flip(): void; show(show: Show): void };

/** The list, in the order the keymap tries it: the picture's rows (docs/rewrite/shortcuts-2026-10-11). Ctrl+V and Space are the shell's and the page's: not here. */
export function halftoneKeys(doc: Doc, hooks: KeyHooks): Shortcut[] {
  const d = doc.get();
  // the view switch is disabled with no image
  const off = !d.source;
  return [
    { keys: 'Ctrl+O', label: 'Open an image', group: 'Image', run: hooks.pick },
    ...VIEWS.map((v, n): Shortcut => ({ keys: `Alt+${n + 1}`, label: v.label, group: 'Image', off, run: () => hooks.show(v.show) })),
    { ...showOriginalKey(hooks.flip), off },
    // one key a plate, in the order of the Inks list (process CMYK is 1 to 4, spot inks go on)
    ...d.inks.slice(0, 9).map((_, n): Shortcut => ({
      keys: String(n + 1),
      label: `Show or hide plate ${n + 1}`,
      group: 'Image',
      run: () => {
        const ink = doc.get().inks[n];
        if (ink) toggleInk(doc, ink.id);
      },
    })),
    { keys: ',', us: ['['], label: 'Previous dot shape', group: 'Image', run: () => stepShape(doc, -1) },
    { keys: '.', us: [']'], label: 'Next dot shape', group: 'Image', run: () => stepShape(doc, 1) },
    // a mouse gesture on the dial (Dial.tsx), listed so it can be found; the caps are the key held
    { keys: 'Shift', label: 'Snap the angle to 15° (drag the dial)', group: 'Image' },
    { keys: 'Ctrl+Shift+C', label: 'Copy the PNG', group: 'Copy and export', off: off || !copyPng.now || copyPng.now.off, run: () => copyPng.now?.run() },
  ];
}
