// Types shared by main, preload and renderer. Spec: docs/superpowers/specs/2026-09-27-rewrite-foundation-design.md

export type Theme = 'dark' | 'light';

export type ToolId =
  | 'design' | 'illustration' | 'pattern' | 'logo' | 'dither' | 'halftone' | 'postfx'
  /** dev-only stub image tool used until the image tools land (registered only when not packaged) */
  | 'dev-image';

// ── Library ─────────────────────────────────────────────────────────────────────────────────────

export type ItemKind = 'palette' | 'pattern' | 'logo' | 'image' | 'svg';
/** Kinds stored as JSON that the app writes, and that can therefore be a tool's document. */
export type DocKind = 'palette' | 'pattern' | 'logo';

export const IMAGE_EXTS = ['png', 'jpg', 'jpeg', 'webp', 'gif', 'bmp', 'avif', 'tif', 'tiff'] as const;
export const PALETTE_IMPORT_EXTS = ['ase', 'aco', 'gpl'] as const;
/** file suffix for each JSON kind, e.g. "Monolith core.palette.json" */
export const DOC_SUFFIX: Record<DocKind, string> = {
  palette: '.palette.json',
  pattern: '.pattern.json',
  logo: '.logo.json',
};

export type Swatch = {
  id: string;
  name: string;
  role: string | null;
  /** the truth, full float precision: [L 0..1, C 0..~0.4, H 0..360] */
  oklch: [number, number, number];
  type: 'process' | 'global' | 'spot';
  /** original values from an import (ASE/ACO/GPL); dropped as soon as the swatch is edited */
  source?: { space: 'rgb' | 'cmyk' | 'lab' | 'gray'; values: number[] };
  /** Illustration ramps: the ramp (RampSpec.id) this swatch belongs to */
  group?: string;
  /** position in its ramp: 0 = base, negative = lighter (toward the highlight), positive = darker */
  step?: number;
  /** a hand-edited ramp step: regenerating the ramp leaves it alone */
  edited?: boolean;
};

export type MaterialId =
  | 'skin' | 'cloth' | 'velvet' | 'metal' | 'plastic' | 'glass'
  | 'water' | 'foliage' | 'stone' | 'wood' | 'paper' | 'fur';

/** How Illustration builds one ramp (spec 2026-09-29 §3.1). Other tools pass it through untouched. */
export type RampSpec = {
  id: string;
  base: [number, number, number];
  light: [number, number, number];
  shadow: [number, number, number];
  material: MaterialId;
  intensity: 'grounded' | 'expressive' | 'extreme';
  /** 3..9, default 5 */
  steps: number;
  hueShift: number;
  chromaCurve: number;
  hero: boolean;
  /** the base's name when the file was written, so a ramp whose base another tool deleted keeps its name */
  name?: string;
};

export type PalettePayload = {
  kind: 'palette';
  id: string;
  version: 1;
  swatches: Swatch[];
  notes: string;
  /** Illustration's ramp settings; tools that don't use them must write them back unchanged */
  ramps?: RampSpec[];
};
export type PatternPayload = {
  kind: 'pattern';
  id: string;
  version: number;
  preview: { svg: string; tileWidth: number; tileHeight: number };
  [setting: string]: unknown;
};
export type LogoPayload = {
  kind: 'logo';
  id: string;
  version: number;
  icon: string | null; // SVG markup
  wordmark: string | null; // SVG markup
  preview: { svg: string };
  [setting: string]: unknown;
};
export type DocPayload = PalettePayload | PatternPayload | LogoPayload;

/** One entry in the Library index. `id` is the JSON id for doc kinds, and the path for images and SVGs. */
export type LibraryItemRef = {
  id: string;
  kind: ItemKind;
  /** display name = file name without the kind suffix / extension */
  name: string;
  /** collection folder name; '' for the Library root */
  collection: string;
  locked: boolean;
  /** absolute path (main uses it; the renderer only shows it or passes it back) */
  path: string;
  ext: string;
  mtimeMs: number;
  size: number;
};

export type Collection = {
  name: string; // folder name; '' = Library root
  locked: boolean;
  items: LibraryItemRef[];
  /** .ase/.aco/.gpl files sitting in the folder that haven't been imported */
  notImported: { name: string; path: string }[];
  /** unknown files and deeper folders, counted for the footer */
  ignored: number;
};

export type LibraryIndex = {
  root: string;
  /** false when the folder is missing or unreadable; `error` says why */
  ok: boolean;
  error?: string;
  collections: Collection[];
};

/** What the shell hands a tool: the ref plus its parsed contents. */
export type LoadedItem =
  | { ref: LibraryItemRef; kind: 'palette'; payload: PalettePayload }
  | { ref: LibraryItemRef; kind: 'pattern'; payload: PatternPayload }
  | { ref: LibraryItemRef; kind: 'logo'; payload: LogoPayload }
  /** images and SVGs: the renderer fetches `url` (dt://) itself */
  | { ref: LibraryItemRef; kind: 'image' | 'svg'; url: string };

/** Result of an import. `warnings`: what a palette reader had to say about one it made (spec §6.3). */
export type ImportResult = {
  made: LibraryItemRef[];
  failed: { name: string; reason: string }[];
  warnings: { name: string; messages: string[] }[];
};

/** State of a doc-kind item on disk, for "changed outside" detection. */
export type FileStamp = { mtimeMs: number; size: number };

export type WriteResult =
  | { ok: true; ref: LibraryItemRef; stamp: FileStamp }
  /** the file changed on disk since `expected`; nothing was written */
  | { ok: false; reason: 'changed-outside'; stamp: FileStamp | null }
  /** the file is gone (deleted or moved outside the app); nothing was written */
  | { ok: false; reason: 'missing' }
  | { ok: false; reason: 'error'; message: string };

// ── Settings and workspace ──────────────────────────────────────────────────────────────────────

export type Settings = {
  theme: Theme;
  libraryRoot: string;
  /** last folder used by a save dialog, keyed "<tool>:<ext>" */
  exportFolders: Record<string, string>;
};

/** Per-tool workspace file (renderer-owned JSON, main just stores it). */
export type WorkspaceState = {
  toolId: ToolId;
  docVersion: number;
  /** for doc-kind tools: the item the document is linked to, owned or detached */
  itemId?: string | null;
  /**
   * doc-kind tools, when `doc` is kept because the file may not hold it: the link as it stood
   * (stamp last read or written, the tool that took the item), so a restart restores that state
   */
  link?: { name: string; collection: string; stamp: FileStamp; lostTo?: ToolId };
  /** doc-kind tools: the last write's error, when that is why `doc` is kept */
  failed?: string;
  /** for image tools: the whole document; for doc-kind tools: kept only while not safely in its file */
  doc?: unknown;
  view?: unknown;
};
