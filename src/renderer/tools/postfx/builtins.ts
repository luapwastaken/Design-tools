// The built-in presets (spec §3): a handful of starting stacks, each naming only what differs from
// its effects' defaults. None strobes or flickers (spec §5 q3): the moving ones only boil, drift and wobble.
import type { EffectId, Layer, ParamValue } from './doc.ts';
import type { Preset } from './presets.ts';
import { layersFrom } from './share.ts';

type Recipe = { name: string; about: string; layers: { effect: EffectId; params?: Record<string, ParamValue>; opacity?: number; blend?: Layer['blend'] }[] };

/** read through share.ts like any stack from outside, so a recipe can't hold what a layer can't */
const builtIns = (recipes: Recipe[]): (Preset & { about: string })[] =>
  recipes.map((r, n) => ({ id: `builtin:${n}`, name: r.name, about: r.about, layers: layersFrom(r.layers.map((l) => ({ on: true, ...l })), r.name) }));

/** the recipes as written, for the test that every setting they name is one their effect has */
export const RECIPES: Recipe[] = [
  {
    name: 'Film',
    about: 'Lifted blacks, a little less colour, fine grain and a soft vignette',
    layers: [
      { effect: 'grade', params: { lift: 4, gamma: 1.05, gain: 96, saturation: 86 } },
      { effect: 'grain', params: { amount: 12, size: 1.4 } },
      { effect: 'vignette', params: { amount: 30, softness: 70 } },
    ],
  },
  {
    name: 'VHS tape',
    about: 'A worn tape: wobble, colour bleed, tracking noise and a little fringing',
    layers: [{ effect: 'vhs' }, { effect: 'chromatic', params: { amount: 3 } }],
  },
  {
    name: 'CRT monitor',
    about: 'Scanlines, a phosphor mask, a curved glass and its glow, steady as a still',
    layers: [
      { effect: 'crt', params: { scanlines: 45, mask: 30, curve: 20 } },
      { effect: 'bloom', params: { threshold: 60, intensity: 60, radius: 16 } },
    ],
  },
  {
    name: 'Dreamy glow',
    about: 'A big soft bloom over lifted shadows and warmer colour',
    layers: [
      { effect: 'bloom', params: { threshold: 50, intensity: 120, radius: 40 } },
      { effect: 'grade', params: { lift: 3, saturation: 110 } },
      { effect: 'vignette', params: { amount: 25 } },
    ],
  },
  {
    name: 'Glitch',
    about: 'Bands that jump sideways and split into red, green and blue',
    layers: [
      { effect: 'glitch', params: { amount: 50, split: 8 } },
      { effect: 'chromatic', params: { amount: 5, mode: 1 } },
    ],
  },
  {
    name: 'Risograph',
    about: 'Blue ink on cream, as a two-colour print, with its grain',
    layers: [
      { effect: 'duotone', params: { dark: [0.42, 0.14, 258], light: [0.95, 0.03, 90], contrast: 15 } },
      { effect: 'grain', params: { amount: 18, size: 1.2 } },
    ],
  },
  {
    name: 'Miniature',
    about: 'A sharp band with blur either side and brighter colour, like a model town',
    layers: [
      { effect: 'tilt-shift' },
      { effect: 'grade', params: { gain: 104, saturation: 125 } },
      { effect: 'vignette', params: { amount: 20 } },
    ],
  },
  {
    name: 'Comic',
    about: 'Flat bands of colour with ink outlines',
    layers: [
      { effect: 'posterize', params: { levels: 5 } },
      { effect: 'edge', params: { threshold: 15 } },
    ],
  },
];

export const BUILT_INS = builtIns(RECIPES);
