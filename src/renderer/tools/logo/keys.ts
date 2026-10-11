// The Logo tool's keyboard list, apart from index.ts so a test can call it with the actions and the
// focus gates stood in for (they reach the shell and the page).
import type { Shortcut } from '../../shell/tool.ts';
import type { Doc } from './actions.ts';
import { shownLockups, type LogoDoc } from './doc.ts';
import type { LogoView } from './view-state.ts';

export type Io = {
  newLogo(): void;
  step(doc: Doc, by: 1 | -1): void;
  stepVersion(by: 1 | -1): void;
  copySvg(doc: Doc): void;
  view(): LogoView;
  patch(p: Partial<LogoView>): void;
  /** bare Up and Down are the tool's, not a panel's scrolling, at this moment */
  arrowsFree(): boolean;
};

export function logoShortcuts(doc: Doc, io: Io): Shortcut[] {
  const d: LogoDoc = doc.get();
  const empty = !d.icon && !d.wordmark;
  const arrows = empty || !io.arrowsFree();
  const group = 'Logo';
  return [
    { keys: 'Ctrl+N', label: 'New logo', group, run: () => io.newLogo() },
    { keys: 'ArrowLeft', label: 'Previous lockup', group, run: () => io.step(doc, -1) },
    { keys: 'ArrowRight', label: 'Next lockup', group, run: () => io.step(doc, 1) },
    { keys: 'ArrowUp', label: 'Previous version', group, off: arrows, run: () => io.stepVersion(-1) },
    { keys: 'ArrowDown', label: 'Next version', group, off: arrows, run: () => io.stepVersion(1) },
    { keys: 'Alt+1', label: 'Edit', group, off: empty, run: () => io.patch({ mode: 'edit' }) },
    { keys: 'Alt+2', label: 'Sheet', group, off: empty, run: () => io.patch({ mode: 'sheet' }) },
    { keys: 'Ctrl+V', label: 'Paste an SVG into the first empty part', group },
    { keys: 'C', label: 'Show or hide the clearspace', group: 'View', run: () => io.patch({ clearspace: !io.view().clearspace }) },
    { keys: 'G', label: 'Show or hide the guides', group: 'View', run: () => io.patch({ guides: !io.view().guides }) },
    { keys: 'Ctrl+Shift+C', label: 'Copy the SVG', group: 'Copy and export', off: !shownLockups(d).length, run: () => io.copySvg(doc) },
  ];
}
