// The parts of the Halftone document the core reads. Structural, so the tool's own doc types
// (renderer/tools/halftone/doc.ts) pass as they are.
import type { Oklch } from '../color/index.ts';

export type Shape = 'round' | 'ellipse' | 'square' | 'line' | 'diamond' | 'cross' | 'stochastic';
/** the shapes drawn cell by cell (stochastic is pixel by pixel) */
export type CellShape = Exclude<Shape, 'stochastic'>;
export type Mode = 'process' | 'spot';
export type Overlap = 'overprint' | 'knockout';
export type Process = 'c' | 'm' | 'y' | 'k';

/** the physical output: w and h in mm whatever `unit` shows */
export type Size = { w: number; h: number; unit: 'mm' | 'in'; dpi: number };
/** minDot 0..0.2 and gain 0..0.3 are coverage fractions */
export type Screen = { shape: Shape; lpi: number; minDot: number; gain: number };
/** levels in 0..1, gamma 1 = none, contrast −1..1 with 0 = none; `invert` makes the negative, after the rest (a file saved before it existed has none) */
export type Tone = { black: number; white: number; gamma: number; contrast: number; invert?: boolean };
export type Paper = { colour: Oklch; include: boolean };

/** `opaque`: a spot ink that covers what is under it instead of multiplying it (white ink, spec §6.3) */
export type SeparateInk = { colour: Oklch; curve: [number, number][]; process?: Process; opaque?: boolean };
export type DrawInk = SeparateInk & { name: string; visible: boolean };

/**
 * One ink's screen: a cell per grid point, centres in print pixels from the page's top left.
 * Struct of arrays, so the preview uploads them as instance buffers as they are.
 */
export type Cells = {
  n: number;
  x: Float32Array;
  y: Float32Array;
  /** the plate's mean over the cell, 0..1, before gain compensation and drop-out */
  coverage: Float32Array;
  /** the cell side across the screen in print pixels (dpi / lpi) */
  pitch: number;
  /** the cell side along the screen: the pitch, or a line screen's shorter segments */
  step: number;
  /** degrees, counter-clockwise as seen */
  angle: number;
};
