// The retro palettes and the ten starting looks (spec §5 q2). A look is a palette plus settings;
// applying one never touches the Library (v1 saved 40 palettes behind your back) or the pixel size.
import { hexToOklch, type Oklch } from '../../../shared/color/index.ts';
import { NEUTRAL_TONE, paletteOf, type AlgorithmId, type DitherDoc, type Tone } from './doc.ts';

export type Preset = { id: string; name: string; colours: Oklch[] };

// hardware palettes are defined by their sRGB values, so they are kept as the hex the machines used
const hex = (list: string): Oklch[] => list.split(' ').map(hexToOklch);

export const PRESETS: Preset[] = [
  { id: '1bit', name: '1-bit', colours: hex('000000 ffffff') },
  { id: 'gray4', name: 'Greyscale 4', colours: hex('000000 555555 aaaaaa ffffff') },
  { id: 'gray8', name: 'Greyscale 8', colours: hex('000000 242424 494949 6d6d6d 929292 b6b6b6 dbdbdb ffffff') },
  { id: 'gameboy', name: 'Game Boy', colours: hex('0f380f 306230 8bac0f 9bbc0f') },
  { id: 'cga', name: 'CGA', colours: hex('000000 55ffff ff55ff ffffff') },
  { id: 'cga0', name: 'CGA palette 0', colours: hex('000000 55ff55 ff5555 ffff55') },
  { id: 'ega', name: 'EGA', colours: hex('000000 0000aa 00aa00 00aaaa aa0000 aa00aa aa5500 aaaaaa 555555 5555ff 55ff55 55ffff ff5555 ff55ff ffff55 ffffff') },
  { id: 'pico8', name: 'PICO-8', colours: hex('000000 1d2b53 7e2553 008751 ab5236 5f574f c2c3c7 fff1e8 ff004d ffa300 ffec27 00e436 29adff 83769c ff77a8 ffccaa') },
  { id: 'c64', name: 'Commodore 64', colours: hex('000000 ffffff 880000 aaffee cc44cc 00cc55 0000aa eeee77 dd8855 664400 ff7777 333333 777777 aaff66 0088ff bbbbbb') },
  { id: 'zx', name: 'ZX Spectrum', colours: hex('000000 0000d7 d70000 d700d7 00d700 00d7d7 d7d700 d7d7d7 0000ff ff0000 ff00ff 00ff00 00ffff ffff00 ffffff') },
  { id: 'newsprint', name: 'Newsprint', colours: hex('1a140d efe6d2') },
  // light first: with the gradient map on, the image's darks draw the lines on the blue
  { id: 'blueprint', name: 'Blueprint', colours: hex('dce6ff 0b3d91') },
  // Riso Blue and Fluorescent Pink on cream, and where the two overprint
  { id: 'riso', name: 'Risograph duo', colours: hex('f4f0d8 ff48b0 0078bf 002284') },
];

export type Look = {
  id: string;
  name: string;
  preset: string;
  algorithm: AlgorithmId;
  strength?: number;
  tone?: Partial<Tone>;
  /** what it is, for the tooltip */
  about: string;
};

export const LOOKS: Look[] = [
  { id: 'mac', name: 'Mac 1-bit', preset: '1bit', algorithm: 'atkinson', about: 'Black and white, Atkinson diffusion: the 1984 Macintosh' },
  // the Game Boy Camera laid lightness along its four shades: matched as they are, a sky lands on one green
  { id: 'gameboy', name: 'Game Boy', preset: 'gameboy', algorithm: 'bayer4', tone: { map: true }, about: 'Four greens by lightness on a 4 × 4 Bayer screen, as the Game Boy Camera printed' },
  { id: 'cga', name: 'CGA', preset: 'cga', algorithm: 'bayer4', about: 'Cyan, magenta, black and white on a 4 × 4 Bayer screen' },
  { id: 'ega', name: 'EGA', preset: 'ega', algorithm: 'floyd-steinberg', about: 'The 16 EGA colours with Floyd–Steinberg diffusion' },
  { id: 'pico8', name: 'PICO-8', preset: 'pico8', algorithm: 'bayer8', about: 'The PICO-8 palette on an 8 × 8 Bayer screen' },
  { id: 'c64', name: 'C64', preset: 'c64', algorithm: 'bayer8', about: 'The Commodore 64 colours on an 8 × 8 Bayer screen' },
  { id: 'newsprint', name: 'Newsprint', preset: 'newsprint', algorithm: 'clustered-dot', tone: { contrast: 0.15 }, about: 'Ink on newsprint, a clustered-dot screen' },
  { id: 'blueprint', name: 'Blueprint', preset: 'blueprint', algorithm: 'line', tone: { map: true, contrast: 0.2 }, about: 'Pale lines on blueprint blue, a 45° line screen' },
  { id: 'riso', name: 'Risograph duo', preset: 'riso', algorithm: 'blue-noise', about: 'Blue and fluorescent pink on cream, grained with blue noise' },
  { id: 'gray4', name: 'Greyscale 4', preset: 'gray4', algorithm: 'jarvis', about: 'Four greys, Jarvis–Judice–Ninke diffusion' },
];

export const presetOf = (id: string | undefined): Preset | undefined => PRESETS.find((p) => p.id === id);
export const lookOf = (id: string | null): Look | undefined => LOOKS.find((l) => l.id === id);

/** the look's settings over `d`, keeping the image, the pixel size and the resampling */
export function withLook(d: DitherDoc, look: Look): DitherDoc {
  const p = presetOf(look.preset)!;
  return {
    ...d,
    algorithm: look.algorithm,
    strength: look.strength ?? 1,
    serpentine: true,
    palette: paletteOf(p.name, p.colours),
    paletteSource: { kind: 'preset', id: p.id },
    // looks start from neutral, so switching never leaves a stray setting from the last one
    tone: { ...NEUTRAL_TONE, ...look.tone },
    look: look.id,
  };
}

const sameTone = (a: Tone, b: Tone) => a.black === b.black && a.white === b.white && a.gamma === b.gamma && a.contrast === b.contrast && a.map === b.map && !!a.invert === !!b.invert;

/** true when `d` still has every setting its look gave it */
export function isLook(d: DitherDoc, look: Look): boolean {
  const w = withLook(d, look);
  const colours = (x: DitherDoc) => JSON.stringify(x.palette.colours);
  return d.algorithm === w.algorithm && d.strength === w.strength && d.serpentine && colours(d) === colours(w) && sameTone(d.tone, w.tone);
}

/** Mac 1-bit Atkinson at pixel size 2 (spec §5 q5), with no image */
export const emptyDoc = (): DitherDoc =>
  withLook({ source: null, pixel: 2, resample: 'area', algorithm: 'atkinson', strength: 1, serpentine: true, seed: 1, palette: paletteOf('', []), paletteSource: { kind: 'preset' }, tone: NEUTRAL_TONE, look: null }, LOOKS[0]);
