import type { LibraryIndex, LibraryItemRef, ToolId } from '../../../shared/types.ts';
import type { MenuItem } from '../../ui/index.ts';
import { shell } from '../core/index.ts';

export { KIND_WORD } from '../core/routing.ts';

export const collectionLabel = (name: string) => (name === '' ? 'Library root' : name);

export function sendToItems(ref: LibraryItemRef): MenuItem[] {
  return shell.targetsFor(ref.kind).map(({ tool, use }) => ({
    label: tool.label,
    icon: tool.icon,
    hint: use.label,
    onSelect: () => void shell.sendItem(ref, tool.id),
  }));
}

export type ItemCommands = {
  rename(): void;
  move(to: string): void;
  remove(): void;
};

/** The item menu (brief §6): Open, Send to, Rename, Duplicate, Move to, Reveal in Explorer, Delete. */
export function itemMenu(ref: LibraryItemRef, index: LibraryIndex, cmd: ItemCommands): MenuItem[] {
  const sendTo = sendToItems(ref);
  const moveTo: MenuItem[] = index.collections
    .filter((c) => c.name !== '' && c.name !== ref.collection)
    .map((c) => ({ label: c.name, icon: c.locked ? 'lock' : 'folder', onSelect: () => cmd.move(c.name) }));
  return [
    // nothing here opens it: Open is off, and the row's tooltip says why
    { label: 'Open', icon: 'open_in_new', shortcut: 'Enter', disabled: !shell.openTarget(ref.kind), onSelect: () => void shell.openItem(ref) },
    { label: 'Send to', icon: 'send', disabled: !sendTo.length, submenu: sendTo },
    { label: 'Rename', icon: 'edit', shortcut: 'F2', onSelect: cmd.rename },
    { label: 'Duplicate', icon: 'content_copy', shortcut: 'Ctrl+D', onSelect: () => void shell.duplicateItem(ref) },
    { label: 'Move to', icon: 'drive_file_move', disabled: !moveTo.length, submenu: moveTo },
    { label: 'Reveal in Explorer', icon: 'folder_open', onSelect: () => void shell.revealItem(ref) },
    'separator',
    { label: 'Delete', icon: 'delete', shortcut: 'Delete', danger: true, onSelect: cmd.remove },
  ];
}

/** "Open in Illustration; it stays open there, detached." when a tool has it (brief §6). */
export function ownerNote(owner: ToolId | undefined, detached: boolean): string {
  if (!owner) return '';
  const label = shell.tool(owner).label;
  return detached ? ` Open in ${label}; it stays open there, detached.` : ` Open in ${label}; it stays open there.`;
}

export function formatBytes(n: number): string {
  if (n < 1024) return `${n} bytes`;
  if (n < 1024 ** 2) return `${Math.round(n / 1024)} KB`;
  return `${(n / 1024 ** 2).toFixed(1)} MB`;
}
