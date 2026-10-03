// Palette writers (spec §4), the other half of src/shared/color/palette-readers.ts. Formats carry
// the sRGB colour a screen shows (the hex), except CSS oklch(), which keeps colours wider than sRGB;
// ASE also writes back the values an import brought in.
import { strToU8, zipSync } from 'fflate';
import type { Swatch } from '../types.ts';
import { hsb, rgb255, toHex, type Oklch } from '../color/index.ts';

export { writeSheetSvg, type SheetOptions } from './sheet.ts';

/** a swatch's name for formats that need one: blank names become the hex */
const label = (s: Swatch): string => s.name.trim() || toHex(s.oklch);

/**
 * The palette as sets: each Illustration ramp one set, named after its base, in the order the ramps
 * first appear; the colours in no ramp together under the palette's own name.
 */
function sets(title: string, swatches: Swatch[]): { name: string; list: Swatch[] }[] {
  const by = new Map<string | undefined, Swatch[]>();
  for (const s of swatches) by.set(s.group, [...(by.get(s.group) ?? []), s]);
  return [...by].map(([group, list]) => ({ name: group === undefined ? title : label(list.find((s) => s.step === 0) ?? list[0]), list }));
}

// ── Adobe ASE ────────────────────────────────────────────────────────────────────────────────────

const ASE_TYPE: Record<Swatch['type'], number> = { global: 0, spot: 1, process: 2 };

/** One colour group named after the palette, or one per Illustration ramp (Illustrator shows each as a folder). */
export function writeAse(name: string, swatches: Swatch[]): Uint8Array {
  const blocks = sets(name.trim() || 'Palette', swatches).flatMap((set) => [
    aseBlock(0xc001, aseName(set.name)),
    ...set.list.map((s) => {
      const [model, values] = aseValues(s);
      return aseBlock(0x0001, [...aseName(label(s)), ...ascii(model), ...values.flatMap(f32), ...u16(ASE_TYPE[s.type])]);
    }),
    aseBlock(0xc002, []),
  ]);
  return Uint8Array.from([...ascii('ASEF'), ...u16(1), ...u16(0), ...u32(blocks.length), ...blocks.flat()]);
}

/** the imported values while `source` is still there (it is dropped on the first edit), else RGB */
function aseValues(s: Swatch): [string, number[]] {
  const v = s.source?.values ?? [];
  switch (s.source?.space) {
    case 'cmyk':
      return ['CMYK', v];
    case 'lab':
      return ['LAB ', [v[0] / 100, v[1], v[2]]]; // ASE stores L as 0..1
    case 'gray':
      return ['Gray', v];
    case 'rgb':
      return ['RGB ', v];
    default:
      return ['RGB ', rgb255(s.oklch).map((c) => c / 255)];
  }
}

const aseBlock = (type: number, body: number[]) => [...u16(type), ...u32(body.length), ...body];
const aseName = (s: string) => [...u16(s.length + 1), ...utf16z(s)];

// ── Photoshop ACO ────────────────────────────────────────────────────────────────────────────────

/** a v1 section (every Photoshop reads it) followed by the same colours as v2, which adds names */
export function writeAco(swatches: Swatch[]): Uint8Array {
  const colour = (s: Swatch) => [...u16(0), ...rgb255(s.oklch).flatMap((c) => u16(c * 257)), ...u16(0)];
  const named = (s: Swatch) => [...colour(s), ...u32(label(s).length + 1), ...utf16z(label(s))];
  return Uint8Array.from([
    ...u16(1), ...u16(swatches.length), ...swatches.flatMap(colour),
    ...u16(2), ...u16(swatches.length), ...swatches.flatMap(named),
  ]);
}

// ── GIMP GPL ─────────────────────────────────────────────────────────────────────────────────────

export function writeGpl(name: string, swatches: Swatch[]): string {
  const rows = swatches.map((s) => `${rgb255(s.oklch).map((c) => String(c).padStart(3)).join(' ')}\t${oneLine(label(s))}`);
  return ['GIMP Palette', `Name: ${oneLine(name) || 'Palette'}`, '#', ...rows, ''].join('\n');
}

// ── CSS and Tailwind ─────────────────────────────────────────────────────────────────────────────

/**
 * Custom property names from roles, then names: lowercase, dashes for anything else, and a
 * numbered suffix where two would meet (counting each one's `-hex` twin).
 */
export function cssNames(swatches: Swatch[]): string[] {
  const used = new Set<string>();
  return swatches.map((s) => {
    const base = slug(s.role ?? '') || slug(s.name) || 'colour';
    let key = base;
    for (let n = 2; used.has(key) || used.has(`${key}-hex`); n++) key = `${base}-${n}`;
    used.add(key).add(`${key}-hex`);
    return key;
  });
}

/** `--name: oklch()` with the full colour (it may be wider than sRGB), and `--name-hex` as the sRGB twin */
export function writeCss(swatches: Swatch[]): string {
  const keys = cssNames(swatches);
  const lines = swatches.flatMap((s, i) => {
    const named = slug(s.role ?? '') && s.name.trim() ? ` /* ${s.name.trim().replace(/\*\//g, '* /')} */` : '';
    return [`  --${keys[i]}: ${oklchCss(s.oklch)};${named}`, `  --${keys[i]}-hex: ${toHex(s.oklch)};`];
  });
  return `:root {\n${lines.join('\n')}\n}\n`;
}

export function writeTailwind(swatches: Swatch[]): string {
  const keys = cssNames(swatches);
  const rows = swatches.map((s, i) => `        ${JSON.stringify(keys[i])}: "${toHex(s.oklch)}",`);
  return ['module.exports = {', '  theme: {', '    extend: {', '      colors: {', ...rows, '      },', '    },', '  },', '};', ''].join('\n');
}

/** 5 decimals, as `cssColor`: 4 can move a colour one 8-bit step off its hex */
const oklchCss = ([l, c, h]: Oklch) => `oklch(${+l.toFixed(5)} ${+c.toFixed(5)} ${+h.toFixed(3)})`;

const slug = (s: string) =>
  s.normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');

// ── JSON and Procreate ───────────────────────────────────────────────────────────────────────────

export function writeJson(name: string, swatches: Swatch[]): string {
  // an Illustration ramp step says which ramp and where in it; other formats have no place for that
  const list = swatches.map((s) => ({ name: s.name, role: s.role, type: s.type, hex: toHex(s.oklch), oklch: s.oklch, ...(s.group !== undefined && { group: s.group, step: s.step }) }));
  return JSON.stringify({ name, swatches: list }, null, 2) + '\n';
}

/** Procreate holds 30 swatches per palette, so longer ones continue as "Name 2", "Name 3" */
const PROCREATE_MAX = 30;

/**
 * A zip holding Swatches.json: an array of palettes, each [{ hue, saturation, brightness, alpha,
 * colorSpace }] (0..1, sRGB). A palette breaks between Illustration ramps, never inside one.
 */
export function writeProcreate(name: string, swatches: Swatch[]): Uint8Array {
  const title = name.trim() || 'Palette';
  const pages: Swatch[][] = [[]];
  for (const { list } of sets(title, swatches)) {
    for (let i = 0; i < list.length; i += PROCREATE_MAX) {
      const part = list.slice(i, i + PROCREATE_MAX);
      if (pages.at(-1)!.length + part.length > PROCREATE_MAX) pages.push([]);
      pages.at(-1)!.push(...part);
    }
  }
  const palettes = pages.map((page, i) => ({
    name: i ? `${title} ${i + 1}` : title,
    swatches: page.map((s) => {
      const [h, saturation, brightness] = hsb(s.oklch);
      return { hue: h / 360, saturation, brightness, alpha: 1, colorSpace: 0 };
    }),
  }));
  return zipSync({ 'Swatches.json': strToU8(JSON.stringify(palettes)) });
}

// ── Krita KPL ────────────────────────────────────────────────────────────────────────────────────

/** the colours in no ramp fill the palette's own group this many to a row */
const KPL_ROW = 16;
/** Krita clamps a palette's columns here; a longer ramp wraps onto more rows */
const KPL_MAX_COLUMNS = 4096;
/** the profile Krita's own 8-bit sRGB colours name; every Krita ships it */
const KPL_SPACE = 'sRGB-elle-V2-srgbtrc.icc';
const XML_ESCAPES: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' };

/** one line (a tab or newline in an attribute reads back as a space anyway), minus the characters XML 1.0 can't hold */
const xmlText = (s: string) => oneLine(s.replace(/[\u0000-\u0008\u000e-\u001f\u007f-\u009f￾￿]/g, ''));
const xmlAttr = (s: string) => xmlText(s).replace(/[&<>"]/g, (ch) => XML_ESCAPES[ch]);

/**
 * A Krita palette: a zip of mimetype, colorset.xml and profiles.xml. Each Illustration ramp is a
 * group laid out light to dark, and the colours in no ramp fill the palette's own group. Krita
 * sniffs the raw bytes for the mimetype, so that entry comes first and STORED. It drops swatches
 * silently where a group has no `rows`, and fails the whole file on an empty profiles.xml.
 */
export function writeKpl(name: string, swatches: Swatch[]): Uint8Array {
  const loose = swatches.filter((s) => s.group === undefined);
  const ramps = sets(name, swatches.filter((s) => s.group !== undefined));
  const columns = Math.min(KPL_MAX_COLUMNS, Math.max(1, Math.min(KPL_ROW, loose.length), ...ramps.map((r) => r.list.length)));

  const entries = (list: Swatch[], width: number, pad: string) =>
    list.flatMap((s, i) => {
      const [r, g, b] = rgb255(s.oklch).map((c) => c / 255);
      return [
        `<ColorSetEntry spot="false" name="${xmlAttr(label(s))}" id="" bitdepth="U8">`,
        ` <RGB r="${r}" g="${g}" b="${b}" space="${KPL_SPACE}"/>`,
        ` <Position row="${Math.floor(i / width)}" column="${i % width}"/>`,
        '</ColorSetEntry>',
      ].map((line) => pad + line);
    });

  // two ramps can share a base name, and Krita merges groups of one name
  const taken = new Set<string>();
  const groups = ramps.flatMap(({ name: ramp, list }) => {
    const base = xmlText(ramp) || 'Ramp';
    let unique = base;
    for (let n = 2; taken.has(unique); n++) unique = `${base} ${n}`;
    taken.add(unique);
    const lightToDark = [...list].sort((a, b) => (a.step ?? 0) - (b.step ?? 0));
    return [` <Group name="${xmlAttr(unique)}" rows="${Math.ceil(list.length / columns)}">`, ...entries(lightToDark, columns, '  '), ' </Group>'];
  });

  const xml = [
    `<ColorSet version="2.0" name="${xmlAttr(name.trim() || 'Palette')}" comment="" columns="${columns}" rows="${Math.ceil(loose.length / KPL_ROW)}">`,
    ...entries(loose, KPL_ROW, ' '),
    ...groups,
    '</ColorSet>',
    '',
  ].join('\n');

  return zipSync({
    mimetype: [strToU8('application/x-krita-palette'), { level: 0 }],
    'colorset.xml': strToU8(xml),
    'profiles.xml': strToU8('<Profiles/>\n'),
  });
}

// ── bytes (big-endian) ───────────────────────────────────────────────────────────────────────────

const u16 = (v: number) => [(v >>> 8) & 255, v & 255];
const u32 = (v: number) => [...u16(v >>> 16), ...u16(v & 0xffff)];
const ascii = (s: string) => Array.from(s, (ch) => ch.charCodeAt(0));
/** UTF-16 code units with the NUL terminator both Adobe formats expect */
const utf16z = (s: string) => [...Array.from({ length: s.length }, (_, i) => s.charCodeAt(i)), 0].flatMap(u16);
const oneLine = (s: string) => s.replace(/\s+/g, ' ').trim();

function f32(v: number): number[] {
  const d = new DataView(new ArrayBuffer(4));
  d.setFloat32(0, v);
  return [...new Uint8Array(d.buffer)];
}
