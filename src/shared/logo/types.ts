// The Logo document (plan: docs/superpowers/plans/2026-09-29-logo-plan.md). In shared so the pure
// layout, SVG and sheet code need no renderer code; the tool's doc.ts re-exports it.
import type { Oklch } from '../color/index.ts';

export type Rect = { x: number; y: number; w: number; h: number };

export type Part = {
  /** namespaced markup (shared/svg namespace()), kept whole for the editable export */
  svg: string | null;
  /** data URL when the part is raster: the trimmed image, so `box` is 0 0 its pixel size */
  png: string | null;
  /**
   * a raster part's shape for the one-colour versions, as a data URL: white where it paints, clear
   * elsewhere and where it is near-white paper. A luminance mask, which every SVG reader applies.
   */
  silhouette?: string;
  name: string;
  /** ARTWORK bounds in the part's own units, never the file's box */
  box: Rect;
  /** wordmark only, found from the artwork, in part units (y grows down) */
  type?: { capTop: number; baseline: number; xTop?: number };
};

/** `compact`: the icon over a short wordmark set about as wide as it (spec §3) */
export type LockupKind = 'horizontal' | 'horizontal-rev' | 'stacked' | 'compact' | 'icon' | 'wordmark';
export type Align = 'center' | 'cap' | 'baseline' | 'top' | 'bottom' | 'start' | 'end';

export type Lockup = {
  kind: LockupKind;
  on: boolean;
  /**
   * icon height ÷ wordmark cap height (÷ the wordmark's artwork height when it has no type metrics).
   * The wordmark alone takes the main pair's, so its clearspace is in the same icon heights.
   */
  ratio: number;
  /** in icon heights, artwork to artwork */
  gap: number;
  align: Align;
};

export type Version = 'original' | 'black' | 'white' | 'colour' | 'knockout';

export type LogoDoc = {
  icon: Part | null;
  wordmark: Part | null;
  /** all six kinds, `on` per proposal or user */
  lockups: Lockup[];
  /** the ones that are on */
  versions: Version[];
  /** the one-colour fill and the knockout field */
  colour: Oklch;
  /** × icon height (0.25..2) */
  clearspace: number;
  exportPadding: 'clearspace' | 'tight';
  /** px */
  pngHeight: number;
};

export const KINDS: LockupKind[] = ['horizontal', 'stacked', 'horizontal-rev', 'compact', 'icon', 'wordmark'];
export const VERSIONS: Version[] = ['original', 'black', 'white', 'colour', 'knockout'];

export const KIND_LABEL: Record<LockupKind, string> = {
  horizontal: 'Horizontal',
  'horizontal-rev': 'Horizontal, reversed',
  stacked: 'Stacked',
  compact: 'Compact',
  icon: 'Icon',
  wordmark: 'Wordmark',
};
export const VERSION_LABEL: Record<Version, string> = {
  original: 'Original',
  black: 'Black',
  white: 'White',
  colour: 'One colour',
  knockout: 'Knockout',
};

/** side by side aligns vertically, stacked horizontally; a single part has nothing to align */
export const ALIGNS: Record<LockupKind, Align[]> = {
  horizontal: ['cap', 'baseline', 'center', 'top', 'bottom'],
  'horizontal-rev': ['cap', 'baseline', 'center', 'top', 'bottom'],
  stacked: ['start', 'center', 'end'],
  compact: ['start', 'center', 'end'],
  icon: ['center'],
  wordmark: ['center'],
};

export const needsIcon = (k: LockupKind): boolean => k !== 'wordmark';
export const sideBySide = (k: LockupKind): boolean => k === 'horizontal' || k === 'horizontal-rev';
export const needsWordmark = (k: LockupKind): boolean => k !== 'icon';
