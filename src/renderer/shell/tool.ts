import type { ComponentType } from 'react';
import type { MaterialSymbol } from 'material-symbols';
import type { DocController } from '../../shared/doc-api.ts';
import type { DocKind, DocPayload, ItemKind, LoadedItem, ToolId } from '../../shared/types.ts';

export type IconName = MaterialSymbol;

/** How a tool uses a received item. `label` shows in the Send to submenu (mono caps): 'PALETTE', 'INKS', 'AS SHAPE'. */
export type Use = { mode: 'open' | 'apply'; label: string };

export type Shortcut = {
  /** e.g. 'Ctrl+Alt+0', 'I', 'Shift+Delete'. Bare keys never fire while a text field has focus. */
  keys: string;
  label: string;
  run: () => void;
};

/**
 * Everything the shell knows about a tool (spec §5). A tool folder exports one of these; the
 * registry in shell/registry.ts lists them.
 */
export interface ToolDefinition<Doc = unknown> {
  id: ToolId;
  label: string;
  group: 'colour' | 'make' | 'image';
  icon: IconName;
  /** Ctrl+<shortcut> switches to it; 0 = none */
  shortcut: number;

  docVersion: number;
  createEmptyDoc(): Doc;
  /** throw when it can't; the shell then quarantines the old doc and starts empty */
  migrate?(raw: unknown, fromVersion: number): Doc;
  /** default: JSON-equal to createEmptyDoc() */
  isEmpty?(doc: Doc): boolean;
  /** breadcrumb name; the shell falls back to the source item's name, then "Untitled" */
  docName?(doc: Doc): string | null;

  /** a Library item of this kind IS this tool's document (spec §7.1) */
  itemKind?: DocKind;
  /** with itemKind: the file contents (without id/kind/version, which the shell adds) */
  toItem?(doc: Doc): Omit<DocPayload, 'id' | 'kind' | 'version'>;
  /** with itemKind: the document from a file */
  fromItem?(item: LoadedItem): Doc;

  /** what Send to and the Library can hand this tool */
  accepts: Partial<Record<ItemKind, Use>>;
  /**
   * Turn a received item into the next document. Return value is committed by the shell as ONE
   * history step (spec §5). For mode 'open' on the tool's own itemKind the shell also links the
   * source; tools never set sources.
   */
  receive(item: LoadedItem, use: Use, current: Doc): Promise<Doc>;
  /** image tools: the full-resolution result from the base settings (spec §7.4) */
  render?(doc: Doc, opts: { maxEdge?: number }): Promise<{ blob: Blob; name: string; ext: string }>;

  /**
   * drop and paste of OS files: true when it took them all, false to let the shell offer them to
   * the Library, or the files it left (the shell offers those)
   */
  onFiles?(files: File[], how: 'drop' | 'paste', doc: DocController<Doc>): Promise<boolean | File[]>;
  /** active only while the tool is shown; the shell owns the listeners */
  shortcuts?: (doc: DocController<Doc>) => Shortcut[];
  StatusSlot?: ComponentType<{ doc: DocController<Doc> }>;
  View: ComponentType<{ doc: DocController<Doc>; active: boolean }>;
}
