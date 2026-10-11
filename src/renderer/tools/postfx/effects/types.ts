// What an effect is (plan unit F): its settings, described once for the inspector, share codes and
// the shaders, and its GPU passes. Types only, so node --test can load every descriptor.
import type { Oklch } from '../../../../shared/color/index.ts';
import type { Gpu, Texture, UniformValue } from '../../../lib/gpu/index.ts';

export const EFFECT_IDS = [
  'grade', 'gradient-map', 'duotone', 'invert',
  'bloom', 'vignette', 'chromatic', 'light-leak', 'lens',
  'grain', 'crt', 'vhs', 'glitch', 'pixel-stretch',
  'posterize', 'edge', 'kuwahara',
  'gaussian', 'tilt-shift',
  'wave', 'twirl', 'kaleidoscope',
  'datamosh',
] as const;
export type EffectId = (typeof EFFECT_IDS)[number];

export type Group = 'colour' | 'light' | 'retro' | 'stylise' | 'blur' | 'distort' | 'video';
export type Blend = 'normal' | 'multiply' | 'screen' | 'overlay' | 'soft-light' | 'add';

/** a number (a choice is its option's index), a switch, or a colour as OKLCH */
export type ParamValue = number | boolean | Oklch;

type Base<K extends string, V extends ParamValue> = {
  kind: K;
  key: string;
  label: string;
  def: V;
  /** any value of this kind put back in range and on the step (the document, share codes, presets) */
  fit(v: ParamValue): ParamValue;
};
/** stored as shown: 15 for 15 %, 24 for 24 px (at the image's full resolution) */
export type NumberParam = Base<'number', number> & { min: number; max: number; step: number; unit?: string; origin?: number };
export type ToggleParam = Base<'toggle', boolean>;
export type ChoiceParam = Base<'choice', number> & { options: readonly string[] };
/** `tone`: where a palette's colour comes from, 0 its darkest to 1 its lightest (fromPalette) */
export type ColourParam = Base<'colour', Oklch> & { tone?: number };
export type Param = NumberParam | ToggleParam | ChoiceParam | ColourParam;

/** what a layer whose effect remembers frames (datamosh) has: the frame it last drew, and how many frames in a row went into it */
export type Memory = { f: number; run: number } | undefined;

export type Effect = {
  id: EffectId;
  label: string;
  group: Group;
  /** one line, for search and tooltips */
  about: string;
  params: readonly Param[];
  /** changes with the loop's time (t) */
  moving?: boolean;
  /** needs the frames of a video: skipped on a still (frame null) */
  videoOnly?: boolean;
  /** draws the effect over ctx.input and returns the result: the whole processed image, before opacity and blend */
  passes(ctx: Ctx): Texture;
};

export type RunOptions = {
  /** samplers besides u_src (the layer's input, always given) */
  inputs?: Record<string, Texture>;
  /** draw into this texture (one of ctx.keep's) instead of a new one */
  into?: Texture;
  /** the size of the new texture, if not the input's */
  size?: { w: number; h: number };
};

export type Ctx = {
  g: Gpu;
  /** the layer's input: straight alpha, sRGB-encoded values in half floats (they may go past 0 to 1) */
  input: Texture;
  w: number;
  h: number;
  /** px of this render per px of the full-resolution image: px settings are multiplied by it */
  scale: number;
  /** where the frame sits in the loop, [0, 1); a moving effect must be periodic in it */
  t: number;
  /** how long the loop is, seconds: a moving effect's rates are a second long (params.ts perLoop), so a clip's pace doesn't depend on its length */
  seconds: number;
  /** the source frame, for video; null for a still */
  frame: number | null;
  /** this layer's settings, in range */
  n(key: string): number;
  on(key: string): boolean;
  /** a colour setting as sRGB-encoded 0..1, what its hex shows */
  rgb(key: string): [number, number, number];
  /** one pass of `fragment` (written after glsl.ts's PRELUDE) into a new texture of the render's, or `into` */
  run(fragment: string, uniforms?: Record<string, UniformValue>, o?: RunOptions): Texture;
  /** done with a texture run() made: the next run() may draw over it (keeps a long chain of passes small) */
  drop(tex: Texture): void;
  /** a texture of this layer's own that lasts from render to render, at the input's size */
  keep(name: string): Texture;
  /** a few numbers of this layer's own that last from render to render; cleared with its textures */
  mem: Record<string, number>;
};
