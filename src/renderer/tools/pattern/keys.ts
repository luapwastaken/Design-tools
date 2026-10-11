// The Pattern tool's keys. Read on every keydown, so what is off (no surprise showing) is decided at that moment.
// The actions come in as a parameter: they reach the shell and the UI, which node tests cannot load.
import type { Shortcut } from '../../shell/tool.ts';
import type { Doc } from './actions.ts';
import { ARRANGEMENTS } from './doc.ts';
import { made, swatchCopier } from './keystate.ts';

export type Acts = { newPattern(): Promise<void>; reseed(doc: Doc): void; surprise(doc: Doc): void };

/** Surprise me is showing: the document is exactly what it made */
export const proposing = (doc: Doc): boolean => made.get() !== null && doc.get() === made.get();

/** Surprise me: a new layout, held as a proposal until it is kept or discarded */
export function proposeSurprise(doc: Doc, surprise: Acts['surprise']): void {
  surprise(doc);
  made.set(doc.get());
}

export const keepSurprise = (): void => made.set(null);

/** back to the layout before the surprise */
export function discardSurprise(doc: Doc): void {
  doc.undo();
  made.set(null);
}

export const patternShortcuts = (doc: Doc, a: Acts): Shortcut[] => {
  const showing = proposing(doc);
  return [
    { keys: 'Ctrl+N', label: 'New pattern', group: 'Make', run: () => void a.newPattern() },
    { keys: 'R', label: 'New random seed', group: 'Make', run: () => a.reseed(doc) },
    { keys: 'Shift+R', label: 'Surprise me', group: 'Make', run: () => proposeSurprise(doc, a.surprise) },
    { keys: 'A', label: 'Keep the surprise', group: 'Make', when: 'after Surprise me', off: !showing, run: keepSurprise },
    { keys: 'Escape', label: 'Go back to before the surprise', group: 'Make', when: 'after Surprise me', off: !showing, run: () => discardSurprise(doc) },
    // listed only: the paste event adds the shape (a live Ctrl+V would cancel it)
    { keys: 'Ctrl+V', label: 'Paste an SVG as a shape', group: 'Make' },
    ...ARRANGEMENTS.map((x, n) => ({
      keys: `Alt+${n + 1}`,
      label: x.label,
      group: 'Layout',
      run: () => doc.transact(`Arrange as ${x.label.toLowerCase()}`, (d) => ({ ...d, arrangement: x.value })),
    })),
    { keys: 'Ctrl+Shift+C', label: 'Copy the swatch SVG', group: 'Copy and export', off: swatchCopier.get() === null, run: () => swatchCopier.get()?.() },
  ];
};
