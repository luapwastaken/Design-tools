import type { DocController, DocState } from '../../shared/doc-api.ts';
import type { ItemKind, LibraryIndex, LibraryItemRef, Settings, Theme, ToolId } from '../../shared/types.ts';
import type { ToolDefinition, Use } from './tool.ts';

/**
 * Contract between the shell's logic (unit S-core: shell/core/*) and its views (unit S-view:
 * App, TitleBar, Rail, StatusBar, ToolHost, LibraryPanel, SettingsScreen). S-core exports
 * `shell` (implements Shell) and `useShell` from shell/core/index.ts. Views read state only
 * through `useShell(select)` and act only through `shell.*`.
 */

export type Readout = {
  /** mono caps, e.g. 'SAVED 14:32 · SCRATCH', 'OPEN IN ILLUSTRATION', 'LOCKED · MONOLITH', 'WORKSPACE' */
  text: string;
  tone: 'normal' | 'live' | 'warn' | 'danger';
  /** e.g. { label: 'Take back', run } or { label: 'Reload from disk', run } */
  actions: { label: string; run(): void }[];
};

export type CrashInfo = { message: string; details: string; automatic: boolean };

export type ShellState = {
  /** false until every DocController has been created and restored (spec §4 start-up) */
  ready: boolean;
  active: ToolId;
  /** registered tools in rail order */
  tools: ToolDefinition<any>[];
  /** tools whose views have mounted; a tool mounts on first activation and never unmounts */
  mounted: ToolId[];
  libraryOpen: boolean;
  settingsOpen: boolean;
  settings: Settings | null;
  library: LibraryIndex | null;
  /** itemId → the tool whose live document it is (one owner per item, spec §7.3) */
  owners: Record<string, ToolId>;
  /** per-tool document state, mirrored from each DocController for cheap rendering */
  docStates: Partial<Record<ToolId, DocState>>;
  /** per-tool breadcrumb name */
  docNames: Partial<Record<ToolId, string>>;
  crashed: Partial<Record<ToolId, CrashInfo>>;
  /** persistent problem for the status bar (a write that keeps failing, a dead watcher) */
  statusWarning: string | null;
  /** running exports/imports; the close handshake asks before quitting while > 0 */
  busy: number;
  isPackaged: boolean;
};

export interface Shell {
  getState(): ShellState;
  subscribe(fn: () => void): () => void;

  tool(id: ToolId): ToolDefinition<any>;
  doc(id: ToolId): DocController<any>;
  /** title-bar readout for a tool's document */
  readout(id: ToolId): Readout;

  setActive(id: ToolId): void;
  toggleLibrary(open?: boolean): void;
  openSettings(open?: boolean): void;
  setTheme(theme: Theme): Promise<void>;
  /** the app-wide colour picker style and model (every picker follows at once) */
  setPicker(patch: Partial<Pick<Settings, 'pickerStyle' | 'pickerModel'>>): Promise<void>;
  chooseLibraryRoot(): Promise<void>;

  // ── items ──
  /** tools that accept this kind, with how they use it (Send to submenu) */
  targetsFor(kind: ItemKind): { tool: ToolDefinition<any>; use: Use }[];
  /** the active tool's use label for this kind, or null (Library row highlight) */
  acceptedLabel(kind: ItemKind): string | null;
  /** where double-click / Open / a drop into a tool would send this kind; null: nothing opens it (the row tooltip says why) */
  openTarget(kind: ItemKind): { tool: ToolDefinition<any>; use: Use } | null;
  /** double-click / Open: active tool if it accepts the kind, else the tool whose itemKind matches (spec §6.4) */
  openItem(ref: LibraryItemRef): Promise<void>;
  sendItem(ref: LibraryItemRef, to: ToolId): Promise<void>;
  /** a tool's own Send to button (spec §7.4) */
  sendDoc(from: ToolId, to: ToolId): Promise<void>;
  /**
   * What that button sends: the tool's itemKind, 'image' for a tool that renders, null while the
   * document is empty (Send to disabled). Changes with the document: read it with
   * useSyncExternalStore(doc.subscribe, () => shell.sendKind(id)), then list shell.targetsFor(kind).
   */
  sendKind(from: ToolId): ItemKind | null;
  /** called by views AFTER their ConfirmInline was confirmed */
  deleteItem(ref: LibraryItemRef): Promise<void>;
  moveItem(ref: LibraryItemRef, collection: string): Promise<void>;
  renameItem(ref: LibraryItemRef, name: string): Promise<void>;
  duplicateItem(ref: LibraryItemRef): Promise<void>;
  revealItem(ref: LibraryItemRef): Promise<void>;
  importFiles(paths: string[], collection: string): Promise<void>;
  createCollection(name: string): Promise<void>;
  renameCollection(name: string, newName: string): Promise<void>;
  setCollectionLocked(name: string, locked: boolean): Promise<void>;

  // ── documents ──
  /** a doc-kind tool's New: an empty document in place of the open one, one undoable step; `name` names the item its first edit makes */
  newDoc(id: ToolId, name?: string): Promise<void>;
  /** the readout actions call these */
  takeBack(id: ToolId): Promise<void>;
  reloadFromDisk(id: ToolId): Promise<void>;
  keepMineAsCopy(id: ToolId): Promise<void>;

  // ── tool hosting ──
  /** ToolHost's error boundary reports here */
  reportCrash(id: ToolId, error: unknown): void;
  reloadTool(id: ToolId): void;
  /** quarantine the document, give the tool a fresh DocController, clear the crash */
  startEmpty(id: ToolId): Promise<void>;
  /** a tool's view state (zoom, tabs, panel sizes) from workspace state.json; never in history (spec §7.1) */
  view(id: ToolId): unknown;
  /** saved a moment after it stops changing */
  setView(id: ToolId, view: unknown): void;

  /** wraps exports/imports so the close handshake knows about them */
  runBusy<T>(fn: () => Promise<T>): Promise<T>;
  /** a save the quit must wait for that isn't a document or view write (the paint canvas's painting); returns the unregister */
  beforeClose(fn: () => Promise<void>): () => void;
  /**
   * The tool's document now lives in another item: `fork` when an edit copied it into Scratch (it
   * was open elsewhere, locked or missing), else the same item under a new id (a rename or move).
   * Called before the tool's view sees the new id. Returns the unregister.
   */
  onRelink(tool: ToolId, fn: (from: string, to: string, fork: boolean) => void): () => void;
}
