import type {
  Collection,
  DocPayload,
  FileStamp,
  ImportResult,
  LibraryIndex,
  LibraryItemRef,
  LoadedItem,
  Settings,
  Theme,
  ToolId,
  WorkspaceState,
  WriteResult,
} from './types.ts';

/**
 * The renderer ⇄ main contract. Main implements every entry (src/main/ipc.ts registers them by
 * name); the preload forwards by name. Errors thrown in main arrive in the renderer as plain
 * Error(message).
 */
export type Api = {
  // ── app ──
  'app.info': () => Promise<{ version: string; isPackaged: boolean; smoke: boolean; userData: string }>;
  'app.log': (level: 'info' | 'warn' | 'error', message: string, details?: string) => Promise<void>;
  /**
   * renderer's answer to the 'app.closeRequest' event: everything flushed; `busy` = an export/import
   * is running; `pendingTrash` = ids of deletes still showing their Undo toast, which main sends to
   * the Recycle Bin once the quit is certain (spec §6.3), and leaves alone on "Keep running"
   */
  'app.closeReply': (busy: boolean, pendingTrash: string[]) => Promise<void>;
  /** smoke runs only: report the result; main quits through the close handshake, then exits 0 or 1 */
  'app.smokeDone': (ok: boolean, report: string) => Promise<void>;

  // ── settings ──
  'settings.get': () => Promise<Settings>;
  /** also applies side effects: theme → window background + caption overlay colours */
  'settings.set': (patch: Partial<Pick<Settings, 'theme' | 'libraryRoot' | 'pickerStyle' | 'pickerModel'>>) => Promise<Settings>;

  // ── library ──
  'library.index': () => Promise<LibraryIndex>;
  /** folder picker; returns the new settings, or null when cancelled */
  'library.chooseRoot': () => Promise<Settings | null>;
  'library.read': (id: string) => Promise<LoadedItem>;
  'library.stat': (id: string) => Promise<FileStamp | null>;
  /** write an existing doc item; refuses if the file changed since `expected` or is gone */
  'library.write': (id: string, payload: DocPayload, expected: FileStamp | null) => Promise<WriteResult>;
  /** create a new doc item; the name is made safe and de-duplicated ("Untitled palette 2") */
  'library.create': (collection: string, name: string, payload: DocPayload) => Promise<{ ref: LibraryItemRef; stamp: FileStamp }>;
  /** create an image item from bytes (Send to from image tools) */
  'library.createImage': (collection: string, name: string, ext: string, bytes: ArrayBuffer) => Promise<LibraryItemRef>;
  'library.rename': (id: string, name: string) => Promise<LibraryItemRef>;
  'library.move': (id: string, collection: string) => Promise<LibraryItemRef>;
  'library.duplicate': (id: string) => Promise<LibraryItemRef>;
  /** pending delete: hidden from the index until unhide or trash */
  'library.hide': (id: string) => Promise<void>;
  'library.unhide': (id: string) => Promise<void>;
  /** the Undo toast closed: send to the Recycle Bin */
  'library.trash': (id: string) => Promise<void>;
  'library.import': (paths: string[], collection: string) => Promise<ImportResult>;
  'library.reveal': (id: string) => Promise<void>;
  'collection.create': (name: string) => Promise<Collection>;
  'collection.rename': (name: string, newName: string) => Promise<Collection>;
  'collection.setLocked': (name: string, locked: boolean) => Promise<Collection>;

  // ── workspace (per-tool working state in %APPDATA%\Design Tools\workspace\<tool>\) ──
  /** reads state.json, falling back to state.prev.json; null when there is none */
  'workspace.load': (tool: ToolId) => Promise<WorkspaceState | null>;
  /** atomic write; keeps the previous good copy as state.prev.json */
  'workspace.save': (tool: ToolId, state: WorkspaceState) => Promise<void>;
  /** move the current state to crashed/<time>.json; returns that path */
  'workspace.quarantine': (tool: ToolId, raw: unknown) => Promise<string>;
  /** store bytes as assets/<sha256>.<ext>; returns the hash and a dt:// url */
  'workspace.putAsset': (tool: ToolId, bytes: ArrayBuffer, ext: string) => Promise<{ hash: string; url: string }>;
  /** delete assets not in `keep` (hashes) */
  'workspace.gcAssets': (tool: ToolId, keep: string[]) => Promise<number>;
  /** saved presets per tool (never document state, never in history) */
  'presets.load': (tool: ToolId) => Promise<unknown[]>;
  'presets.save': (tool: ToolId, presets: unknown[]) => Promise<void>;

  // ── export ──
  /**
   * Native save dialog (remembers the folder per tool+ext). Overwrite is reversible: temp write,
   * old file to the Recycle Bin (or renamed "(replaced …)" on drives without one), then rename.
   * Returns the written path, or null if cancelled.
   */
  'export.save': (req: { tool: ToolId; suggestedName: string; ext: string; filterName: string; data: ArrayBuffer | string }) => Promise<string | null>;
  /** pick a folder once, write every file into it with the same overwrite rule */
  'export.toFolder': (req: { tool: ToolId; files: { name: string; data: ArrayBuffer | string }[] }) => Promise<{ folder: string; written: string[] } | null>;
  /** the same, for files made one at a time (an animation's frames): pick the folder, or null if cancelled */
  'export.openFolder': (tool: ToolId) => Promise<{ id: number; folder: string } | null>;
  /** one file into an open folder, with the same overwrite and naming rules; its path */
  'export.intoFolder': (id: number, name: string, data: ArrayBuffer | string) => Promise<string>;
  'export.closeFolder': (id: number) => Promise<void>;
  /**
   * An export that takes a while turns this on, and off after: while on, the window is not slowed when
   * it is hidden or minimised (Chromium would give a hidden page a frame a second), so the export
   * keeps its speed. Off, the window goes back to how it was made.
   */
  'window.keepAwake': (on: boolean) => Promise<void>;
  'shell.reveal': (path: string) => Promise<void>;
};

export type ApiEvents = {
  /** the Library index changed (rescan after a watcher hint, an in-app operation, or focus) */
  'library.changed': LibraryIndex;
  /** main wants to close the window: flush, then call 'app.closeReply' */
  'app.closeRequest': null;
  /** main-side problem worth a toast (e.g. the watcher died and was restarted) */
  'app.notice': { level: 'info' | 'warn' | 'error'; message: string };
};

export type Bridge = {
  invoke<K extends keyof Api>(name: K, ...args: Parameters<Api[K]>): ReturnType<Api[K]>;
  on<K extends keyof ApiEvents>(name: K, fn: (payload: ApiEvents[K]) => void): () => void;
  /** absolute path of a dropped/picked File */
  pathForFile(file: File): string;
  /** the theme main started with, so the renderer can match before first paint */
  initialTheme: Theme;
  /** a smoke folder (--smoke, --smoke-dir): temp userData and Library */
  smoke: boolean;
  /** the smoke pass src/renderer/smoke.ts runs: 'full' (--smoke) or 'quiet' (--smoke-quiet); null for none */
  smokeRun: 'full' | 'quiet' | null;
};

declare global {
  interface Window {
    api: Bridge;
  }
}
