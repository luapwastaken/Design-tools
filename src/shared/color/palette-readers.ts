// Readers for imported palettes (spec §10.2): Adobe ASE, Photoshop ACO v1/v2, GIMP GPL, Krita KPL,
// Procreate .swatches and Lospec .hex.
// `Swatch.source.values` use one scale whatever the file: rgb and gray 0..1 (gray 1 = white),
// cmyk 0..1 of ink, lab [L 0..100, a, b] (D50).
import type { Color } from 'culori';
import { strFromU8, unzipSync } from 'fflate';
import type { PALETTE_IMPORT_EXTS, Swatch } from '../types.ts';
import { rgb255, toOklch } from './index.ts';

export type PaletteFile = { name: string; swatches: Swatch[]; warnings: string[] };
type Source = NonNullable<Swatch['source']>;
type Read = (bytes: Uint8Array, fallbackName: string) => PaletteFile;

const ENDS_EARLY = 'The file ends early; colours after that point are missing.';

/** Throws, with a message fit for the import report, when the file has no readable colours. */
export function readPaletteFile(ext: (typeof PALETTE_IMPORT_EXTS)[number], bytes: Uint8Array, fallbackName: string): PaletteFile {
  const file = { ase: readAse, aco: readAco, gpl: readGpl, kpl: readKpl, swatches: readProcreate, hex: readHex }[ext](bytes, fallbackName);
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
  const read: { group: string; swatch: Swatch }[] = [];
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
        const name = c.utf16(c.u16());
        const model = c.ascii(4);
        const m = ASE_MODELS[model];
        if (!m) skipped.add(model.trim());
        else {
          const values = Array.from({ length: m.n }, () => c.f32());
          if (m.space === 'lab') values[0] *= 100; // ASE stores L as 0..1
          read.push({ group, swatch: swatch(name, { space: m.space, values }, ASE_TYPES[c.u16()] ?? 'process') });
        }
      }
      c.seek(end);
    }
  } catch (e) {
    warnings.push(endsEarly(e));
  }
  // the group names a swatch only where several groups need telling apart; one group is the
  // palette's own folder (writeAse makes one), and prefixing it would grow on every round trip
  const several = new Set(read.map((r) => r.group).filter(Boolean)).size > 1;
  const swatches = read.map((r) => (several && r.group ? { ...r.swatch, name: `${r.group} / ${r.swatch.name}` } : r.swatch));
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
      return swatch(name, { space: 'rgb', values: hsvToRgb((a / 65535) * 360, b / 65535, c / 65535) });
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

// ── KPL (Krita) ──────────────────────────────────────────────────────────────────────────────────

/** one tag at a time: Krita's colorset.xml is elements and quoted attributes, no text between */
const XML_TAG = /<(\/)?([A-Za-z][\w:-]*)((?:\s+[\w:-]+\s*=\s*"[^"]*")*)\s*(\/)?>/g;
const XML_ATTR = /([\w:-]+)\s*=\s*"([^"]*)"/g;
const XML_ENTITY = /&(?:(amp|lt|gt|quot|apos)|#(\d+)|#x([0-9a-f]+));/gi;
const XML_NAMED: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };

const unescapeXml = (v: string) => v.replace(XML_ENTITY, (_, named?: string, dec?: string, hex?: string) => (named ? XML_NAMED[named.toLowerCase()] : String.fromCodePoint(dec ? Number(dec) : parseInt(hex!, 16))));

type KplEntry = { group: string; name: string; spot: boolean; row: number; column: number; colour: { tag: string; a: Record<string, string> } | null };

const readKpl: Read = (bytes, fallbackName) => {
  let xml: string;
  try {
    const files = unzipSync(bytes, { filter: (f) => f.name === 'colorset.xml' });
    if (!files['colorset.xml']) throw new Error('no colorset');
    xml = strFromU8(files['colorset.xml']);
  } catch {
    throw new Error("This isn't a Krita palette (.kpl) file.");
  }
  let name = fallbackName;
  let group = '';
  let entry: KplEntry | null = null;
  const entries: KplEntry[] = [];
  for (const m of xml.matchAll(XML_TAG)) {
    const [, closing, tag, attrText = '', selfClosing] = m;
    const a: Record<string, string> = {};
    for (const [, k, v] of attrText.matchAll(XML_ATTR)) a[k] = unescapeXml(v);
    if (tag === 'ColorSet' && !closing && a.name?.trim()) name = a.name.trim();
    else if (tag === 'Group') group = closing || selfClosing ? '' : (a.name ?? '');
    else if (tag === 'ColorSetEntry') {
      if (closing) entry = null;
      else {
        entry = { group, name: a.name ?? '', spot: a.spot === 'true', row: 0, column: 0, colour: null };
        entries.push(entry);
        if (selfClosing) entry = null;
      }
    } else if (entry && !closing && tag === 'Position') [entry.row, entry.column] = [Number(a.row) || 0, Number(a.column) || 0];
    else if (entry && !closing && !entry.colour) entry.colour = { tag, a };
  }
  // laid out the way Krita shows them: a group's swatches by row, then column
  const rank = (e: KplEntry) => e.row * 1e6 + e.column;
  const byGroup = new Map<string, KplEntry[]>();
  for (const e of entries) byGroup.set(e.group, [...(byGroup.get(e.group) ?? []), e]);
  const ordered = [...byGroup.values()].flatMap((list) => list.sort((x, y) => rank(x) - rank(y)));
  // as with ASE: the group names a swatch only where several groups need telling apart
  const several = new Set(entries.map((e) => e.group).filter(Boolean)).size > 1;
  const skipped = new Set<string>();
  let otherProfile = false;
  const swatches: Swatch[] = [];
  for (const e of ordered) {
    const made = e.colour ? kplColour(e.colour.tag, e.colour.a, e.name, e.spot ? 'spot' : 'process') : null;
    if (!made) skipped.add(e.colour?.tag ?? 'no colour');
    else {
      if (e.colour!.a.space && !/srgb/i.test(e.colour!.a.space)) otherProfile = true;
      swatches.push(several && e.group ? { ...made, name: `${e.group} / ${made.name}` } : made);
    }
  }
  const warnings = [...skippedNote(skipped), ...(otherProfile ? ['Some colours use another colour profile than sRGB; they are read as sRGB.'] : [])];
  return { name, swatches, warnings };
};

/** RGB, Gray and CMYK entries (channels 0..1, CMYK as ink); Krita's Lab and the rest are left out */
function kplColour(tag: string, a: Record<string, string>, name: string, type: Swatch['type']): Swatch | null {
  const v = (...keys: string[]) => keys.map((k) => Number(a[k]));
  const ok = (values: number[]) => values.every((x) => Number.isFinite(x));
  if (tag === 'RGB' && ok(v('r', 'g', 'b'))) return swatch(name, { space: 'rgb', values: v('r', 'g', 'b').map(unit) }, type);
  if (tag === 'Gray' && ok(v('g'))) return swatch(name, { space: 'gray', values: v('g').map(unit) }, type);
  if (tag === 'CMYK' && ok(v('c', 'm', 'y', 'k'))) return swatch(name, { space: 'cmyk', values: v('c', 'm', 'y', 'k').map(unit) }, type);
  return null;
}

const unit = (x: number) => Math.min(1, Math.max(0, x));

// ── Procreate .swatches ──────────────────────────────────────────────────────────────────────────

const readProcreate: Read = (bytes, fallbackName) => {
  const notProcreate = () => new Error("This isn't a Procreate swatches file.");
  let palettes: unknown;
  try {
    const files = unzipSync(bytes, { filter: (f) => f.name === 'Swatches.json' });
    palettes = JSON.parse(strFromU8(files['Swatches.json']));
  } catch {
    throw notProcreate();
  }
  if (!Array.isArray(palettes)) throw notProcreate();
  const swatches: Swatch[] = [];
  let bad = 0;
  let name = fallbackName;
  for (const [i, p] of palettes.entries()) {
    if (i === 0 && typeof p?.name === 'string' && p.name.trim()) name = p.name.trim();
    // an empty slot is null: a gap in Procreate's grid, not a colour
    for (const w of Array.isArray(p?.swatches) ? (p.swatches as unknown[]) : []) {
      if (w === null) continue;
      const made = procreateSwatch(w as Record<string, unknown>);
      if (made) swatches.push(made);
      else bad++;
    }
  }
  const warnings = [
    palettes.length > 1 && `The file holds ${count(palettes.length, 'palette')}; they are joined into one.`,
    bad && `Skipped ${count(bad, 'swatch', 'swatches')} that couldn't be read.`,
  ].filter((w) => typeof w === 'string');
  return { name, swatches, warnings };
};

/** Procreate keeps hue, saturation and brightness (0..1) in sRGB (colorSpace 0) or Display P3 (1) */
function procreateSwatch(w: Record<string, unknown>): Swatch | null {
  const [h, sat, b] = [w.hue, w.saturation, w.brightness].map(Number);
  if (![h, sat, b].every(Number.isFinite)) return null;
  const rgb = hsvToRgb(unit(h) * 360, unit(sat), unit(b));
  if (w.colorSpace !== 1) return swatch('', { space: 'rgb', values: rgb });
  // a P3 swatch is kept as the sRGB it lands on, so it is locked like the others and written back as that
  const p3 = make('', { mode: 'p3', r: rgb[0], g: rgb[1], b: rgb[2] });
  return { ...p3, source: { space: 'rgb', values: rgb255(p3.oklch).map((c) => c / 255) } };
}

// ── HEX (Lospec) ─────────────────────────────────────────────────────────────────────────────────

/** six hex digits to a line, with or without a "#" */
const readHex: Read = (bytes, fallbackName) => {
  const swatches: Swatch[] = [];
  let bad = 0;
  for (const raw of new TextDecoder().decode(bytes).split(/\r?\n/)) {
    const line = raw.trim().replace(/^#/, '');
    if (!line) continue;
    const m = /^([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(line);
    if (m) swatches.push(swatch('', { space: 'rgb', values: m.slice(1).map((h) => parseInt(h, 16) / 255) }));
    else bad++;
  }
  return { name: fallbackName, swatches, warnings: bad ? [`Skipped ${count(bad, 'line')} that couldn't be read.`] : [] };
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

/** HSB (Photoshop's colour space 1) as sRGB, so the swatch holds its imported values like the others */
function hsvToRgb(h: number, s: number, v: number): number[] {
  const f = (n: number) => {
    const k = (n + h / 60) % 6;
    return v - v * s * Math.max(0, Math.min(k, 4 - k, 1));
  };
  return [f(5), f(3), f(1)];
}

function make(name: string, color: Color, type: Swatch['type'] = 'process'): Swatch {
  return { id: crypto.randomUUID(), name, role: null, oklch: toOklch(color), type };
}

const count = (n: number, noun: string, plural = `${noun}s`) => `${n} ${n === 1 ? noun : plural}`;

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
