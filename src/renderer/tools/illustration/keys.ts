// The Illustration tool's keys as one list, built from a plain description of the moment (`KeyState`) and the
// things a key does (`KeyActs`), so a test can build it in any state without the app behind it. index.ts fills
// both in from the real view and doc. Every row is always in the list; one that does not apply right now is
// `off` (the sheet dims it, the keymap skips it), so no row's turn depends on its place in the list.
import type { Shortcut } from '../../shell/tool.ts';

/** the tab ids of the tabbed section, in Alt+N order */
export type Tab = 'settings' | 'light' | 'zones' | 'check' | 'paint' | 'variations' | 'layers';

export type KeyState = {
  tab: string;
  /** the palette holds a colour (Light and Check have nothing to show without one) */
  swatches: boolean;
  /** there is at least one ramp */
  ramps: boolean;
  /** the selected colour is in a ramp */
  ramp: boolean;
  /** the other-colours row is open on a ramp that exists */
  swapOpen: boolean;
  /** how many palettes the Variations grid shows (0 off that tab) */
  cells: number;
  /** one of them is open large */
  cellOpen: boolean;
  /** a button, link or field has the focus: Enter belongs to it */
  onControl: boolean;
  /** colours are proposed and not yet kept */
  proposals: boolean;
  /** text is selected or a field has focus: Ctrl+C is the page's */
  copyOff: boolean;
  /** the arrows are the tool's: focus is nowhere or in the ramps */
  arrowsFree: boolean;
};

export type KeyActs = {
  tab(t: Tab): void;
  addColour(): void;
  arm(): void;
  duplicate(): void;
  newPalette(): void;
  /** along a ramp (dx) or to the next ramp (dy) */
  step(dx: number, dy: number): void;
  moveRamp(dir: -1 | 1): void;
  hero(): void;
  lock(): void;
  /** the other-colours row of the selected ramp */
  swap(): void;
  closeSwap(): void;
  keepAll(): void;
  discard(): void;
  greyscale(): void;
  holdValue(): void;
  eyedrop(): void;
  paintTool(t: 'paint' | 'smudge' | 'pick'): void;
  size(dir: 1 | -1): void;
  load(dir: 1 | -1): void;
  copyRamp(): void;
  copyAll(): void;
  show(n: number): void;
  newSet(): void;
  cellStep(dir: -1 | 1): void;
  more(): void;
  use(): void;
  closeCell(): void;
  layerShow(i: number): void;
};

const TABS: [Tab, string][] = [
  ['settings', 'Ramp settings'],
  ['light', 'Light & preview'],
  ['zones', 'Light zones'],
  ['check', 'Check values'],
  ['paint', 'Paint'],
  ['variations', 'Variations'],
  ['layers', 'Layers'],
];
const LAYER_SHOWS = ['Flats', 'Recipe', 'Target'];

export function illustrationKeys(s: KeyState, a: KeyActs): Shortcut[] {
  const paint = s.tab === 'paint';
  const vars = s.tab === 'variations' && s.ramps;
  const layers = s.tab === 'layers' && s.ramps;
  const R = 'Ramps';
  const P = { group: 'Paint', when: 'Paint tab', off: !paint };
  const V = { group: 'Variations and Layers', when: 'Variations tab', off: !vars };
  return [
    // ── Ramps ──
    { keys: 'Shift+A', label: 'Add a colour', group: R, run: a.addColour },
    { keys: 'ArrowUp', label: 'Previous ramp', group: R, off: !s.swatches || !s.arrowsFree, run: () => a.step(0, -1) },
    { keys: 'ArrowDown', label: 'Next ramp', group: R, off: !s.swatches || !s.arrowsFree, run: () => a.step(0, 1) },
    { keys: 'Alt+ArrowUp', label: 'Move the ramp up', group: R, off: !s.ramp, run: () => a.moveRamp(-1) },
    { keys: 'Alt+ArrowDown', label: 'Move the ramp down', group: R, off: !s.ramp, run: () => a.moveRamp(1) },
    // a large Variations palette takes the side arrows while it is open
    { keys: 'ArrowLeft', label: 'Lighter step', group: R, off: !s.swatches || s.cellOpen, run: () => a.step(-1, 0) },
    { keys: 'ArrowRight', label: 'Darker step', group: R, off: !s.swatches || s.cellOpen, run: () => a.step(1, 0) },
    { keys: 'H', label: 'Hero colour', group: R, off: !s.ramp, run: a.hero },
    // S is the Smudge brush on the Paint tab (below), the other-colours row everywhere else
    { keys: 'S', label: 'Other colours for this ramp', group: R, off: paint || !s.ramp, run: a.swap },
    { keys: 'L', label: 'Lock the ramp for Variations', group: R, off: !s.ramp, run: a.lock },
    { keys: 'A', label: 'Keep all proposals', group: R, off: !s.proposals, run: a.keepAll },
    { keys: 'Escape', label: 'Close the other-colours row', group: R, off: !s.swapOpen, run: a.closeSwap },
    // the open palette and the other-colours row are closed first
    { keys: 'Escape', label: 'Discard proposals', group: R, off: !s.proposals || s.swapOpen || s.cellOpen, run: a.discard },
    { keys: 'I', label: 'Pick a colour from the screen', group: R, off: paint, run: a.eyedrop },
    // the paste event does it
    { keys: 'Ctrl+V', label: 'Paste colour codes as ramps', group: R },
    { keys: 'Ctrl+D', label: 'Duplicate the ramp', group: R, run: a.duplicate },
    { keys: 'Ctrl+N', label: 'New palette', group: R, run: a.newPalette },
    { keys: 'Delete', also: ['Backspace'], label: 'Delete the ramp (asks first)', group: R, off: !s.swatches, run: a.arm },

    // ── View ──
    { keys: 'G', label: 'Show or hide greyscale', group: 'View', run: a.greyscale },
    { keys: 'V', label: 'Hold value: keep the lightness while you edit', group: 'View', run: a.holdValue },
    ...TABS.map(([t, label], i): Shortcut => ({ keys: `Alt+${i + 1}`, label, group: 'View', off: !s.swatches && t !== 'settings' && t !== 'paint', run: () => a.tab(t) })),

    // ── Paint ──
    { keys: 'B', label: 'Brush', ...P, run: () => a.paintTool('paint') },
    { keys: 'S', label: 'Smudge', ...P, run: () => a.paintTool('smudge') },
    { keys: 'I', label: 'Pick', ...P, run: () => a.paintTool('pick') },
    { keys: ',', us: ['['], label: 'Smaller brush', ...P, run: () => a.size(-1) },
    { keys: '.', us: [']'], label: 'Larger brush', ...P, run: () => a.size(1) },
    { keys: 'Shift+,', us: ['Shift+{'], label: 'Less load (or strength)', ...P, run: () => a.load(-1) },
    { keys: 'Shift+.', us: ['Shift+}'], label: 'More load (or strength)', ...P, run: () => a.load(1) },
    // the canvas takes the click
    { keys: 'Alt+Click', label: 'Pick the colour under the cursor', ...P },
    // the canvas takes this one too, in the capture phase, while a stroke is down
    { keys: 'Escape', label: 'Cancel the stroke', group: 'Paint', when: 'while painting', off: !paint },

    // ── Variations and Layers ──
    { keys: 'Space', label: 'New set of six', ...V, run: a.newSet },
    ...Array.from({ length: 6 }, (_, i): Shortcut => ({ keys: String(i + 1), label: 'Open a palette larger', ...V, off: !vars || i >= s.cells, run: () => a.show(i + 1) })),
    { keys: 'ArrowLeft', label: 'Previous palette', ...V, when: 'one open', off: !vars || !s.cellOpen, run: () => a.cellStep(-1) },
    { keys: 'ArrowRight', label: 'Next palette', ...V, when: 'one open', off: !vars || !s.cellOpen, run: () => a.cellStep(1) },
    { keys: 'M', label: 'More like this', ...V, when: 'one open', off: !vars || !s.cellOpen, run: a.more },
    // a focused button keeps its own Enter
    { keys: 'Enter', label: 'Use this palette', ...V, when: 'one open', off: !vars || !s.cellOpen || s.onControl, run: a.use },
    { keys: 'Escape', label: 'Close the large palette', ...V, when: 'one open', off: !vars || !s.cellOpen || s.swapOpen, run: a.closeCell },
    ...LAYER_SHOWS.map((n, i): Shortcut => ({ keys: String(i + 1), label: `Show: ${n}`, group: 'Variations and Layers', when: 'Layers tab', off: !layers, run: () => a.layerShow(i) })),

    // ── Copy and export ──
    { keys: 'C', also: ['Ctrl+C'], label: "Copy the ramp's colour codes", group: 'Copy and export', off: !s.ramp || s.copyOff, run: a.copyRamp },
    { keys: 'Ctrl+Shift+C', label: 'Copy every colour in the export format', group: 'Copy and export', off: !s.swatches, run: a.copyAll },
  ];
}
