// Readers for imported palettes (spec §10.2): Adobe ASE, Photoshop ACO v1/v2, GIMP GPL.
// `Swatch.source.values` use one scale whatever the file: rgb and gray 0..1 (gray 1 = white),
// cmyk 0..1 of ink, lab [L 0..100, a, b] (D50).
import type { Color } from 'culori';
import type { Swatch } from '../types.ts';
import { toOklch } from './index.ts';

export type PaletteFile = { name: string; swatches: Swatch[]; warnings: string[] };
type Source = NonNullable<Swatch['source']>;
type Read = (bytes: Uint8Array, fallbackName: string) => PaletteFile;

const ENDS_EARLY = 'The file ends early; colours after that point are missing.';

/** Throws, with a message fit for the import report, when the file has no readable colours. */
export function readPaletteFile(ext: 'ase' | 'aco' | 'gpl', bytes: Uint8Array, fallbackName: string): PaletteFile {
  const file = { ase: readAse, aco: readAco, gpl: readGpl }[ext](bytes, fallbackName);
  if (!file.swatches.length) throw new Error('No colours in this file.');
  if (file.swatches.some((s) => s.source?.space === 'cmyk'))
    file.warnings.push('CMYK colours are shown as an estimate; the original values are kept.');
  return file;
}

// ── ASE ──────────────────────────────────────────────────────────────────────────────────────────

const ASE_MODELS: Record<string, { space: Source['space']; n: number }> = {
  'RGB ': { space: 'rgb', n: 3 },
  CMYK: { space: 'cmyk', n: 4 },
  'LAB ': { space: 'lab', n: 3 },
  Gray: { space: 'gray', n: 1 },
};
const ASE_TYPES: Swatch['type'][] = ['global', 'spot', 'process'];

const readAse: Read = (bytes, fallbackName) => {
  const c = cursor(bytes);
  if (bytes.length < 12 || c.ascii(4) !== 'ASEF') throw new Error("This isn't an Adobe swatch exchange (.ase) file.");
  c.skip(4); // version
  const count = c.u32();
  const swatches: Swatch[] = [];
  const skipped = new Set<string>();
  const warnings: string[] = [];
  let group = '';
  try {
    for (let i = 0; i < count; i++) {
      const type = c.u16();
      const end = c.u32() + c.pos;
      if (type === 0xc001) group = c.utf16(c.u16());
      else if (type === 0xc002) group = '';
      else if (type === 0x0001) {
        const name = [group, c.utf16(c.u16())].filter(Boolean).join(' / ');
        const model = c.ascii(4);
        const m = ASE_MODELS[model];
        if (!m) skipped.add(model.trim());
        else {
          const values = Array.from({ length: m.n }, () => c.f32());
          if (m.space === 'lab') values[0] *= 100; // ASE stores L as 0..1
          swatches.push(swatch(name, { space: m.space, values }, ASE_TYPES[c.u16()] ?? 'process'));
        }
      }
      c.seek(end);
    }
  } catch (e) {
    warnings.push(endsEarly(e));
  }
  return { name: fallbackName, swatches, warnings: [...skippedNote(skipped), ...warnings] };
};

// ── ACO ──────────────────────────────────────────────────────────────────────────────────────────

type AcoEntry = { space: number; w: number[]; name: string };
const ACO_SPACES: Record<number, string> = { 3: 'Pantone', 4: 'Focoltone', 5: 'Trumatch', 6: 'Toyo', 9: 'wide CMYK', 10: 'HKS' };

const readAco: Read = (bytes, fallbackName) => {
  const c = cursor(bytes);
  const version = bytes.length >= 4 ? c.u16() : 0;
  if (version !== 1 && version !== 2) throw new Error("This isn't a Photoshop swatches (.aco) file.");
  const v1: AcoEntry[] = [];
  const v2: AcoEntry[] = [];
  const warnings: string[] = [];
  try {
    acoSection(c, version, version === 1 ? v1 : v2);
    // a v1 section is usually followed by the same colours again as v2, with names
    if (version === 1 && c.pos < bytes.length && c.u16() === 2) acoSection(c, 2, v2);
  } catch (e) {
    warnings.push(endsEarly(e));
  }
  const skipped = new Set<string>();
  const swatches: Swatch[] = [];
  for (const { space, w, name } of v2.length >= v1.length ? v2 : v1) {
    const made = acoSwatch(space, w, name);
    if (made) swatches.push(made);
    else skipped.add(ACO_SPACES[space] ?? `colour space ${space}`);
  }
  return { name: fallbackName, swatches, warnings: [...skippedNote(skipped), ...warnings] };
};

function acoSection(c: Cursor, version: number, out: AcoEntry[]): void {
  const count = c.u16();
  for (let i = 0; i < count; i++) {
    const space = c.u16();
    const w = [c.u16(), c.u16(), c.u16(), c.u16()];
    out.push({ space, w, name: version === 2 ? c.utf16(c.u32()) : '' });
  }
}

function acoSwatch(space: number, [a, b, c, d]: number[], name: string): Swatch | null {
  const signed = (v: number) => (v << 16) >> 16;
  switch (space) {
    case 0:
      return swatch(name, { space: 'rgb', values: [a / 65535, b / 65535, c / 65535] });
    case 1:
      return make(name, { mode: 'hsv', h: (a / 65535) * 360, s: b / 65535, v: c / 65535 });
    case 2: // 0 = 100% ink
      return swatch(name, { space: 'cmyk', values: [a, b, c, d].map((v) => 1 - v / 65535) });
    case 7:
      return swatch(name, { space: 'lab', values: [a / 100, signed(b) / 100, signed(c) / 100] });
    case 8: // 0 = white, 10000 = black, as GIMP reads it
      return swatch(name, { space: 'gray', values: [1 - a / 10000] });
    default:
      return null;
  }
}

// ── GPL ──────────────────────────────────────────────────────────────────────────────────────────

const GPL_RGB = /^(\d{1,3})\s+(\d{1,3})\s+(\d{1,3})(?:\s+(.*))?$/;
/** after `Channels: RGBA` (Aseprite), alpha follows blue */
const GPL_RGBA = /^(\d{1,3})\s+(\d{1,3})\s+(\d{1,3})\s+(\d{1,3})(?:\s+(.*))?$/;

const readGpl: Read = (bytes, fallbackName) => {
  const [first, ...lines] = new TextDecoder().decode(bytes).split(/\r?\n/);
  if (first.trim() !== 'GIMP Palette') throw new Error("This isn't a GIMP palette (.gpl) file.");
  let name = fallbackName;
  let n = 3;
  let [bad, clear, partly] = [0, 0, 0];
  const swatches: Swatch[] = [];
  for (const raw of lines) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const header = /^([A-Za-z]+):\s*(.*)$/.exec(line); // Name:, Columns:, Channels:
    if (header) {
      const [key, value] = [header[1].toLowerCase(), header[2].trim()];
      if (key === 'name' && value) name = value;
      if (key === 'channels') n = value.toUpperCase() === 'RGBA' ? 4 : 3;
      continue;
    }
    const m = (n === 4 ? GPL_RGBA : GPL_RGB).exec(line);
    const [r, g, b, a = 255] = m ? m.slice(1, n + 1).map(Number) : [];
    if (!m || [r, g, b, a].some((v) => v > 255)) bad++;
    else if (a === 0) clear++; // an empty slot, not a colour
    else {
      if (a < 255) partly++;
      swatches.push(swatch(m[n + 1]?.trim() ?? '', { space: 'rgb', values: [r / 255, g / 255, b / 255] }));
    }
  }
  const warnings = [
    bad && `Skipped ${count(bad, 'line')} that couldn't be read.`,
    clear && `Skipped ${count(clear, 'fully transparent colour')}.`,
    partly && `Made ${count(partly, 'partly transparent colour')} opaque; transparency isn't kept.`,
  ].filter((w) => typeof w === 'string');
  return { name, swatches, warnings };
};

// ── shared ───────────────────────────────────────────────────────────────────────────────────────

function swatch(name: string, source: Source, type: Swatch['type'] = 'process'): Swatch {
  const v = source.values;
  const color: Color =
    source.space === 'rgb' ? { mode: 'rgb', r: v[0], g: v[1], b: v[2] }
    : source.space === 'gray' ? { mode: 'rgb', r: v[0], g: v[0], b: v[0] }
    : source.space === 'lab' ? { mode: 'lab', l: v[0], a: v[1], b: v[2] }
    // naive CMYK; the original values stay in `source`
    : { mode: 'rgb', r: (1 - v[0]) * (1 - v[3]), g: (1 - v[1]) * (1 - v[3]), b: (1 - v[2]) * (1 - v[3]) };
  return { ...make(name, color, type), source };
}

function make(name: string, color: Color, type: Swatch['type'] = 'process'): Swatch {
  return { id: crypto.randomUUID(), name, role: null, oklch: toOklch(color), type };
}

const count = (n: number, noun: string) => `${n} ${noun}${n === 1 ? '' : 's'}`;

const skippedNote = (skipped: Set<string>) =>
  skipped.size ? [`Skipped colours in unsupported colour spaces: ${[...skipped].join(', ')}.`] : [];

/** DataView throws RangeError past the end of the bytes; that is how truncation shows up. */
function endsEarly(e: unknown): string {
  if (e instanceof RangeError) return ENDS_EARLY;
  throw e;
}

type Cursor = ReturnType<typeof cursor>;

/** Big-endian reads that advance through the bytes. */
function cursor(bytes: Uint8Array) {
  const v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let p = 0;
  const take = (n: number) => ((p += n), p - n);
  return {
    get pos() {
      return p;
    },
    seek: (to: number) => void (p = to),
    skip: (n: number) => void take(n),
    u16: () => v.getUint16(take(2)),
    u32: () => v.getUint32(take(4)),
    f32: () => v.getFloat32(take(4)),
    ascii: (n: number) => String.fromCharCode(...Array.from({ length: n }, () => v.getUint8(take(1)))),
    /** `n` UTF-16 code units, with the NUL terminator the formats include dropped */
    utf16: (n: number) => String.fromCharCode(...Array.from({ length: n }, () => v.getUint16(take(2)))).replace(/\0+$/, ''),
  };
}
