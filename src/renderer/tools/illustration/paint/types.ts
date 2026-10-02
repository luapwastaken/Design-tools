// The painting engine's contract (plan 2026-09-30 §4.1): what the canvas UI builds against.
import type { Paint } from '../../../../shared/paint/km.ts';
import type { Rect } from '../../../lib/gpu/index.ts';

export const WIDTH = 2048;
export const HEIGHT = 1280;
export const UNDO_STEPS = 20;

/** shown as Watercolour | Gouache; saved values stay 'wet' | 'dry' */
export type Medium = 'wet' | 'dry';
/** Round, Flat, Dry brush */
export type BrushKind = 'round' | 'flat' | 'dry';
export type StrokeTool = 'paint' | 'smudge';
/** what a brush holds: km.ts paint plus the traits the engine reads */
export type Loaded = { paint: Paint; opacity: number; granulation: number; staining: number };
/** sRGB, 0..1 */
export type Rgb = [number, number, number];

export type StrokeOptions = {
  tool: StrokeTool;
  /** smudge ignores it */
  medium: Medium;
  brush: BrushKind;
  /** diameter at full pressure, painting px */
  size: number;
  /** 0..1: paint held, or the smudge's strength */
  load: number;
  /** null for smudge */
  loaded: Loaded | null;
  /** fixes the stroke's grain, pooling and edge wander (the sheet); a new one per stroke when left out */
  seed?: number;
};

/** a pointer position in painting px, as toSample() makes it */
export type PointerSample = {
  x: number;
  y: number;
  /** ms, the event's timeStamp */
  t: number;
  /** 0..1 from a pen; null: none (mouse, touch), so speed stands in */
  pressure: number | null;
  /** radians, from a pen that reports them */
  tilt: { altitude: number; azimuth: number } | null;
};

export type PaintingState = { depth: number; redoDepth: number; lastIsClear: boolean; blank: boolean };
export type ChangeKind = 'stroke' | 'undo' | 'redo' | 'clear' | 'load' | 'restored';
/** one drawn frame: when it reached the screen, the engine's CPU time, and the oldest sample it drew (for latency) */
export type FrameLog = { at: number; cpuMs: number; steps: number; bristles: number; oldestSample: number };
export type { Rect };
