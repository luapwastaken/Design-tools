// The Pattern document and a laid-out tile (plan: docs/superpowers/plans/2026-09-29-pattern-plan.md).
// The document type lives in shared so the pure layout and SVG code need no renderer code; the tool's
// doc.ts re-exports it.
import type { Oklch } from '../color/index.ts';

export type Unit = 'px' | 'mm' | 'in';
export type Arrangement = 'grid' | 'halfdrop' | 'brick' | 'scatter';

export type ShapeSlot = {
  id: string;
  /** namespaced markup (shared/svg namespace()), kept whole */
  svg: string;
  name: string;
  /** 0..10, relative; 0 never appears */
  weight: number;
  /** "Colour from palette": flatten to one fill */
  recolour: boolean;
  /** when recolour is on; null takes the palette colour at this slot's position */
  colour: Oklch | null;
  /** artwork bounds in the SVG's user units */
  bounds: { x: number; y: number; w: number; h: number };
};

export type PatternDoc = {
  slots: ShapeSlot[];
  arrangement: Arrangement;
  /** grid-like: cells per tile; scatter: count = cols × rows */
  cols: number;
  rows: number;
  /** px at 100%; layout keeps the pitch from collapsing whatever these are. Scatter spaces items by their mean, at least 0 */
  gapX: number;
  gapY: number;
  /** px, an item's longest side */
  sizeMin: number;
  sizeMax: number;
  rotation: { mode: 'fixed' | 'random'; angle: number; min: number; max: number };
  /** px either way on each axis; scatter ignores it (it would break the no-overlap rule) */
  jitter: number;
  seed: number;
  background: Oklch | null;
  /** shape colours when slots recolour */
  palette: Oklch[];
  paletteMode: 'by-slot' | 'random';
  exportUnit: Unit;
  dpi: number;
  /** px, whatever unit it is shown and written in (exportUnit) */
  artboard: { w: number; h: number };
};

/** One placed shape, in tile pixels: its artwork's centre, longest side and turn in degrees. */
export type Item = { slot: string; x: number; y: number; size: number; rotation: number; colour: Oklch | null };

export type Tile = { width: number; height: number; items: Item[] };
