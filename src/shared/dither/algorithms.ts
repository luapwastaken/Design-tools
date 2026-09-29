// The dither (plan unit A): a linear RGB image and a palette in, a palette index per pixel out. Every
// algorithm matches colours in OKLab and mixes them in the same coordinates (lab.ts), held inside the
// palette's box, so switching family never shifts the tone. Pure and synchronous: the tool's worker,
// its exports and the tests all run this one function.
import { dotDiffusion } from './dot-diffusion.ts';
import { diffuse, KERNELS, type KernelId } from './diffusion.ts';
import { bayer, blueNoise, clusteredDot, lineScreen } from './matrices.ts';
import { ign, noise, screen, tiled, type Threshold } from './ordered.ts';
import { labImage } from './lab.ts';
import { toMix, type OklabPalette } from './palette.ts';
import { nearestAll } from './plans.ts';
import { riemersma } from './riemersma.ts';

export type AlgorithmId =
  | KernelId
  | 'riemersma'
  | 'dot-diffusion'
  | 'bayer2'
  | 'bayer4'
  | 'bayer8'
  | 'clustered-dot'
  | 'line'
  | 'blue-noise'
  | 'threshold'
  | 'random'
  | 'ign';

/**
 * strength 0..1 is how far each algorithm departs from the nearest colour: the error diffused, the
 * spread of the thresholds. At 0 every pixel is its nearest colour.
 * Serpentine and the seed count only where the algorithm's entry says it reads them.
 */
export type AlgoSettings = { algorithm: AlgorithmId; strength: number; serpentine: boolean; seed: number };

export type Algorithm = {
  id: AlgorithmId;
  label: string;
  group: 'diffusion' | 'ordered' | 'noise';
  /** which settings it reads */
  strength: boolean;
  serpentine: boolean;
  seed: boolean;
};

const entry = (id: AlgorithmId, label: string, group: Algorithm['group'], reads: Partial<Algorithm> = {}): Algorithm => ({
  id,
  label,
  group,
  strength: true,
  serpentine: false,
  seed: false,
  ...reads,
});
const kernel = (id: KernelId, label: string) => entry(id, label, 'diffusion', { serpentine: true });

export const ALGORITHMS: Algorithm[] = [
  kernel('floyd-steinberg', 'Floyd–Steinberg'),
  kernel('atkinson', 'Atkinson'),
  kernel('jarvis', 'Jarvis–Judice–Ninke'),
  kernel('stucki', 'Stucki'),
  kernel('burkes', 'Burkes'),
  kernel('sierra', 'Sierra'),
  kernel('sierra-lite', 'Sierra Lite'),
  entry('riemersma', 'Riemersma', 'diffusion'),
  entry('dot-diffusion', 'Dot diffusion', 'diffusion'),
  entry('bayer2', 'Bayer 2 × 2', 'ordered'),
  entry('bayer4', 'Bayer 4 × 4', 'ordered'),
  entry('bayer8', 'Bayer 8 × 8', 'ordered'),
  entry('clustered-dot', 'Clustered dot', 'ordered'),
  entry('line', 'Line 45°', 'ordered'),
  entry('blue-noise', 'Blue noise', 'ordered'),
  entry('threshold', 'Threshold', 'noise', { strength: false }),
  entry('random', 'Random', 'noise', { seed: true }),
  entry('ign', 'Interleaved gradient', 'noise'),
];

const memo = <T>(make: () => T) => {
  let v: T | undefined;
  return () => (v ??= make());
};
const SCREENS: Partial<Record<AlgorithmId, () => Threshold>> = {
  bayer2: memo(() => tiled(bayer(2))),
  bayer4: memo(() => tiled(bayer(4))),
  bayer8: memo(() => tiled(bayer(8))),
  'clustered-dot': memo(() => tiled(clusteredDot())),
  line: memo(() => tiled(lineScreen())),
  'blue-noise': memo(() => tiled(blueNoise())),
  ign: () => ign,
};

/** `img` is linear RGB, w*h*3, and is only read; the result holds an index into `palette` per pixel */
export function dither(img: Float32Array, w: number, h: number, palette: OklabPalette, a: AlgoSettings): Uint8Array {
  if (img.length !== w * h * 3) throw new Error(`A ${w} × ${h} image needs ${w * h * 3} values; this one has ${img.length}.`);
  const id = a.algorithm;
  if (!ALGORITHMS.some((x) => x.id === id)) throw new Error(`There's no dither called "${id}".`);
  const s = Math.max(0, a.strength);
  // the nearest colour of the pixel as it is: with no error carried, holding it in the box buys nothing
  if (id === 'threshold' || s === 0) return nearestAll(labImage(img), w, h, palette);
  const mix = toMix(img, palette);
  if (id in KERNELS) return diffuse(mix, w, h, palette, KERNELS[id as KernelId], s, a.serpentine);
  if (id === 'riemersma') return riemersma(mix, w, h, palette, s);
  if (id === 'dot-diffusion') return dotDiffusion(mix, w, h, palette, s);
  return screen(mix, w, h, palette, id === 'random' ? noise(a.seed) : SCREENS[id]!(), s);
}
