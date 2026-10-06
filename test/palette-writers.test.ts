import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { strFromU8, unzipSync } from 'fflate';
import { readPaletteFile } from '../src/shared/color/palette-readers.ts';
import { hexToOklch, rgb255, toHex } from '../src/shared/color/index.ts';
import type { Swatch } from '../src/shared/types.ts';
import {
  cssNames,
  writeAco,
  writeAse,
  writeCss,
  writeGpl,
  writeJson,
  writeKpl,
  writeProcreate,
  writeSheetSvg,
  writeTailwind,
  writeTailwind4,
} from '../src/shared/palette/writers.ts';

const fixture = (name: string) => new Uint8Array(readFileSync(new URL(`fixtures/${name}`, import.meta.url)));
const sw = (hex: string, name = '', role: string | null = null, type: Swatch['type'] = 'process'): Swatch =>
  ({ id: crypto.randomUUID(), name, role, oklch: hexToOklch(hex), type });
const hexes = (list: Swatch[]) => list.map((s) => toHex(s.oklch));
const near = (a: number[] | undefined, b: number[]) =>
  assert.ok(a && a.length === b.length && a.every((v, i) => Math.abs(v - b[i]) < 1e-6), `${a} ≈ ${b}`);

// ── ASE ──────────────────────────────────────────────────────────────────────────────────────────

for (const file of ['chalk_palette.ase', 'glossy-pastic_palette.ase']) {
  test(`ASE: ${file} survives write → read`, () => {
    const read = readPaletteFile('ase', fixture(file), 'x');
    const back = readPaletteFile('ase', writeAse('Brand', read.swatches), 'y');
    assert.deepEqual(back.warnings, []);
    assert.deepEqual(back.swatches.map((s) => s.name), read.swatches.map((s) => s.name), 'names come back as they were: the one group is the palette');
    const again = readPaletteFile('ase', writeAse('Brand', back.swatches), 'z');
    assert.deepEqual(again.swatches.map((s) => s.name), read.swatches.map((s) => s.name), 'and stay so, round after round');
    assert.deepEqual(hexes(back.swatches), hexes(read.swatches));
    back.swatches.forEach((s, i) => assert.deepEqual(s.source, read.swatches[i].source));
  });
}

test('ASE: global/spot/process and unedited CMYK, Lab and grey values are written back', () => {
  const src: Swatch[] = [
    { ...sw('#0066cc', 'Ink', null, 'global'), source: { space: 'cmyk', values: [1, 0.5, 0, 0.2] } },
    { ...sw('#856caa', 'Seal', 'Accent', 'spot'), source: { space: 'lab', values: [50, 20, -30] } },
    { ...sw('#cccccc', 'Paper'), source: { space: 'gray', values: [0.8] } },
    sw('#e72a50', 'Edited'),
    sw('#123456'),
  ];
  const back = readPaletteFile('ase', writeAse('P', src), 'x').swatches;
  assert.deepEqual(back.map((s) => s.type), ['global', 'spot', 'process', 'process', 'process']);
  assert.deepEqual(back.map((s) => s.source?.space), ['cmyk', 'lab', 'gray', 'rgb', 'rgb']);
  near(back[0].source?.values, [1, 0.5, 0, 0.2].map(Math.fround));
  near(back[1].source?.values, [50, 20, -30]);
  near(back[2].source?.values, [Math.fround(0.8)]);
  assert.deepEqual(hexes(back), ['#0066cc', '#856caa', '#cccccc', '#e72a50', '#123456']);
  assert.equal(back[4].name, '#123456', 'a blank name becomes the hex');
});

test('ASE: names outside the BMP keep both UTF-16 halves', () => {
  const [s] = readPaletteFile('ase', writeAse('P', [sw('#ff0000', 'Rot 🍅')]), 'x').swatches;
  assert.equal(s.name, 'Rot 🍅');
});

// ── ACO ──────────────────────────────────────────────────────────────────────────────────────────

test('ACO: v2 names round trip, and the v1 section alone still reads', () => {
  const src = [sw('#e72a50', 'Amaranth'), sw('#0c0427', 'Midnight'), sw('#fff9f2', '')];
  const bytes = writeAco(src);
  const back = readPaletteFile('aco', bytes, 'x');
  assert.deepEqual(back.warnings, []);
  assert.deepEqual(back.swatches.map((s) => s.name), ['Amaranth', 'Midnight', '#fff9f2']);
  assert.deepEqual(hexes(back.swatches), hexes(src));
  const v1 = readPaletteFile('aco', bytes.subarray(0, 4 + 10 * src.length), 'x');
  assert.deepEqual(hexes(v1.swatches), hexes(src));
  assert.deepEqual(v1.swatches.map((s) => s.name), ['', '', '']);
});

// ── GPL ──────────────────────────────────────────────────────────────────────────────────────────

test('GPL: name, padded channels, names; reads back', () => {
  const src = [sw('#ff0000', 'Red'), sw('#0080ff', 'Sky\nblue'), sw('#0c2238')];
  const text = writeGpl('Sunset', src);
  assert.match(text, /^GIMP Palette\nName: Sunset\n#\n255   0   0\tRed\n  0 128 255\tSky blue\n 12  34  56\t#0c2238\n$/);
  const back = readPaletteFile('gpl', new TextEncoder().encode(text), 'x');
  assert.equal(back.name, 'Sunset');
  assert.deepEqual(back.swatches.map((s) => s.name), ['Red', 'Sky blue', '#0c2238']);
  assert.deepEqual(hexes(back.swatches), hexes(src));
});

// ── CSS and Tailwind ─────────────────────────────────────────────────────────────────────────────

const UI = [
  sw('#14161a', 'Ground', 'Background'),
  sw('#efe9dd', 'Bone', 'Text'),
  sw('#e8643c', 'Ember', 'Accent'),
  sw('#8fb8de', 'Sky', 'Accent'),
  sw('#3f6b4f', 'Moss Green'),
  sw('#6b6f76', 'Crème / Brûlée'),
  sw('#000000', ''),
  sw('#111111', 'accent-2'),
  sw('#222222', 'moss green hex'),
  sw('#333333', 'Iron */ x', 'Muted'),
];

test('CSS names: roles, then names, then "colour"; safe and de-duplicated including -hex twins', () => {
  assert.deepEqual(cssNames(UI), ['background', 'text', 'accent', 'accent-2', 'moss-green', 'creme-brulee', 'colour', 'accent-2-2', 'moss-green-hex-2', 'muted']);
});

test('CSS: oklch() with the full colour plus a -hex twin, names kept in a comment', () => {
  const css = writeCss(UI);
  assert.ok(css.startsWith(':root {\n') && css.endsWith('\n}\n'));
  assert.match(css, /^ {2}--background: oklch\(0\.\d+ 0\.\d+ \d+(\.\d+)?\); \/\* Ground \*\/$/m);
  assert.match(css, /^ {2}--background-hex: #14161a;$/m);
  assert.match(css, /^ {2}--moss-green: oklch\([^)]*\);$/m, 'no comment when the name is the key');
  assert.match(css, /--muted: oklch\([^)]*\); \/\* Iron \* \/ x \*\/$/m, 'a comment end inside a name is defused');
  const wide = writeCss([{ ...sw('#00ff00'), oklch: [0.85, 0.3, 142] }]);
  assert.match(wide, /--colour: oklch\(0\.85 0\.3 142\);/, 'out-of-sRGB colours keep their true value');
  assert.match(wide, /--colour-hex: #[0-9a-f]{6};/);
});

test('Tailwind: a config whose colours are the hex values under the CSS names', () => {
  const module = { exports: {} as { theme?: { extend?: { colors?: Record<string, string> } } } };
  new Function('module', writeTailwind(UI))(module);
  const colors = module.exports.theme?.extend?.colors ?? {};
  assert.deepEqual(Object.keys(colors), cssNames(UI));
  assert.equal(colors.background, '#14161a');
  assert.equal(colors['accent-2'], '#8fb8de');
});

// ── JSON, Procreate, sheet ───────────────────────────────────────────────────────────────────────

test('JSON: name and each swatch with its hex and full OKLCH', () => {
  const data = JSON.parse(writeJson('Monolith', UI.slice(0, 2)));
  assert.equal(data.name, 'Monolith');
  assert.deepEqual(data.swatches[0], { name: 'Ground', role: 'Background', type: 'process', hex: '#14161a', oklch: UI[0].oklch });
});

test('Procreate: a zip with Swatches.json holding an array of palettes in HSB 0..1', () => {
  const files = unzipSync(writeProcreate('Monolith', [sw('#ff0000'), sw('#808080'), sw('#0000ff')]));
  assert.deepEqual(Object.keys(files), ['Swatches.json']);
  const palettes = JSON.parse(strFromU8(files['Swatches.json']));
  assert.ok(Array.isArray(palettes));
  assert.equal(palettes.length, 1);
  assert.equal(palettes[0].name, 'Monolith');
  const [red, grey, blue] = palettes[0].swatches;
  assert.deepEqual(red, { hue: 0, saturation: 1, brightness: 1, alpha: 1, colorSpace: 0 });
  assert.equal(grey.saturation, 0);
  assert.ok(Math.abs(grey.brightness - 128 / 255) < 1e-9);
  assert.ok(Math.abs(blue.hue - 240 / 360) < 1e-9);
});

test('Procreate: more than 30 swatches continue in a second palette', () => {
  const many = Array.from({ length: 31 }, (_, i) => sw(`#${(i * 8).toString(16).padStart(2, '0')}0000`));
  const palettes = JSON.parse(strFromU8(unzipSync(writeProcreate('Big', many))['Swatches.json']));
  assert.deepEqual(palettes.map((p: { name: string; swatches: unknown[] }) => [p.name, p.swatches.length]), [['Big', 30], ['Big 2', 1]]);
});

/** Illustration ramps as export gets them: blank names filled in, each swatch with its ramp and step */
const ramp = (group: string, base: string, n: number): Swatch[] =>
  Array.from({ length: n }, (_, i) => ({ ...sw(`#${(i * 30).toString(16).padStart(2, '0')}4080`, i === 1 ? base : `${base} ${i}`), group, step: i - 1 }));

test('Procreate: a palette breaks between ramps, never inside one', () => {
  const list = [...ramp('a', 'Skin', 9), ...ramp('b', 'Cloth', 9), ...ramp('c', 'Hair', 9), ...ramp('d', 'Sky', 9)];
  const palettes = JSON.parse(strFromU8(unzipSync(writeProcreate('Study', list))['Swatches.json']));
  assert.deepEqual(palettes.map((p: { name: string; swatches: unknown[] }) => [p.name, p.swatches.length]), [['Study', 27], ['Study 2', 9]]);
});

test('ASE: one colour group per ramp, named after its base; loose colours under the palette name', () => {
  const list = [...ramp('a', 'Skin', 3), ...ramp('b', 'Cloth', 3), sw('#123456', 'Loose')];
  const back = readPaletteFile('ase', writeAse('Study', list), 'x').swatches.map((s) => s.name);
  assert.deepEqual(back, ['Skin / Skin 0', 'Skin / Skin', 'Skin / Skin 2', 'Cloth / Cloth 0', 'Cloth / Cloth', 'Cloth / Cloth 2', 'Study / Loose']);
});

test('Sheet SVG: a sized page with one chip per swatch and escaped text', () => {
  const svg = writeSheetSvg('Tom & Jerry <3', UI.slice(0, 5), { columns: 2, theme: 'dark' });
  assert.match(svg, /^<svg xmlns="http:\/\/www\.w3\.org\/2000\/svg" width="\d+" height="\d+" viewBox="0 0 \d+ \d+">/);
  assert.ok(svg.includes('Tom &#38; Jerry &#60;3'));
  assert.ok(!/<text[^>]*>[^<]*[&][^#]/.test(svg), 'no raw ampersand in text');
  for (const s of UI.slice(0, 5)) assert.ok(svg.includes(`fill="${toHex(s.oklch)}"`));
  assert.ok(svg.includes('≈CMYK'));
  const [w, h] = svg.match(/width="(\d+)" height="(\d+)"/)!.slice(1).map(Number);
  assert.ok(w < h, '2 columns of 5 swatches is taller than wide');
  assert.ok(svg.trimEnd().endsWith('</svg>'));
});

// ── Krita KPL ────────────────────────────────────────────────────────────────────────────────────

type El = { tag: string; attrs: Record<string, string>; kids: El[] };
const XML_ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"' };
const XML_VALUE = String.raw`(?:[^"<&\u0000-\u001f]|&(?:amp|lt|gt|quot);)*`;
const XML_TAG = new RegExp(String.raw`<(/)?([A-Za-z][\w-]*)((?:\s+[\w-]+="${XML_VALUE}")*)\s*(/)?>|\s+`, 'y');

/** A strict reader for the XML a .kpl holds: elements and quoted attributes, no text, no bare & or < */
function parseXml(text: string): El {
  const top: El = { tag: '', attrs: {}, kids: [] };
  const open = [top];
  for (let at = 0; at < text.length; ) {
    XML_TAG.lastIndex = at;
    const m = XML_TAG.exec(text);
    assert.ok(m, `not well-formed at ${at}: ${text.slice(at, at + 40)}`);
    at = XML_TAG.lastIndex;
    const [, closing, tag, attrText = '', selfClosing] = m;
    if (!tag) continue;
    if (closing) {
      assert.ok(open.length > 1 && !attrText && !selfClosing, `unexpected </${tag}>`);
      assert.equal(open.pop()!.tag, tag, 'mismatched end tag');
      continue;
    }
    const el: El = { tag, attrs: {}, kids: [] };
    for (const [, key, value] of attrText.matchAll(new RegExp(String.raw`\s+([\w-]+)="(${XML_VALUE})"`, 'g'))) {
      assert.ok(!(key in el.attrs), `repeated attribute ${key}`);
      el.attrs[key] = value.replace(/&(amp|lt|gt|quot);/g, (_, e: string) => XML_ENTITIES[e]);
    }
    open.at(-1)!.kids.push(el);
    if (!selfClosing) open.push(el);
  }
  assert.equal(open.length, 1, 'an element is left open');
  assert.equal(top.kids.length, 1, 'one root element');
  return top.kids[0];
}

/** Krita's own decode of a colour channel: float2int(clamp(v * 255, 0, 255)), which is int(x + 0.5) */
const kritaByte = (v: string) => Math.floor(Math.min(Math.max(Number(v) * 255, 0), 255) + 0.5);

type Entry = { name: string; rgb: number[]; row: number; column: number };
type Group = { name: string | null; rows: number; entries: Entry[] };

function entryOf(el: El): Entry {
  assert.equal(el.tag, 'ColorSetEntry');
  assert.deepEqual([el.attrs.spot, el.attrs.id, el.attrs.bitdepth], ['false', '', 'U8']);
  const [colour, position, ...rest] = el.kids;
  assert.equal(colour.tag, 'RGB', 'the colour comes first: Krita reads the first child element');
  assert.equal(position.tag, 'Position');
  assert.equal(rest.length, 0);
  assert.equal(colour.attrs.space, 'sRGB-elle-V2-srgbtrc.icc');
  const channels = ['r', 'g', 'b'].map((k) => colour.attrs[k]);
  for (const v of channels) assert.match(v, /^(0|1|0\.\d+)$/, 'a 0..1 number with a point for the decimal');
  return { name: el.attrs.name, rgb: channels.map(kritaByte), row: Number(position.attrs.row), column: Number(position.attrs.column) };
}

/** a .kpl read the way Krita's loader does, checking each swatch lands inside its group */
function readKpl(bytes: Uint8Array) {
  const files = unzipSync(bytes);
  const root = parseXml(strFromU8(files['colorset.xml']));
  assert.equal(root.tag, 'ColorSet');
  const columns = Number(root.attrs.columns);
  assert.ok(Number.isInteger(columns) && columns >= 1 && columns <= 4096, `columns ${root.attrs.columns}`);
  const group = (el: El, name: string | null): Group => {
    assert.match(el.attrs.rows ?? '', /^\d+$/, 'rows is written on the root and every group, or Krita drops swatches');
    const rows = Number(el.attrs.rows);
    assert.ok(el.kids.every((k) => k.tag === 'ColorSetEntry'), 'a group holds only entries');
    const entries = el.kids.map(entryOf);
    const cells = new Set(entries.map((e) => `${e.row},${e.column}`));
    assert.equal(cells.size, entries.length, 'no two swatches in one cell');
    for (const e of entries) assert.ok(e.column >= 0 && e.column < columns && e.row >= 0 && e.row < rows, `${e.name} at ${e.row},${e.column} of ${rows}x${columns}`);
    assert.equal(rows, entries.length ? Math.max(...entries.map((e) => e.row)) + 1 : 0, 'rows is the rows used');
    return { name, rows, entries };
  };
  assert.ok(root.kids.every((k) => k.tag === 'ColorSetEntry' || k.tag === 'Group'));
  const own = group({ ...root, kids: root.kids.filter((k) => k.tag === 'ColorSetEntry') }, null);
  const groups = root.kids.filter((k) => k.tag === 'Group').map((g) => group(g, g.attrs.name));
  return { files, root, columns, own, groups };
}

const swatchesAt = (n: number, name = 'c') => Array.from({ length: n }, (_, i) => sw(`#${(i * 10).toString(16).padStart(2, '0')}2040`, `${name}${i}`));

test('KPL: the zip opens with mimetype STORED, then colorset.xml and profiles.xml', () => {
  const bytes = writeKpl('Study', [...ramp('a', 'Skin', 3), sw('#123456', 'Loose')]);
  const head = new DataView(bytes.buffer, bytes.byteOffset);
  assert.equal(head.getUint32(0, true), 0x04034b50, 'a local file header');
  assert.equal(head.getUint16(6, true), 0, 'no flags, so no data descriptor');
  assert.equal(head.getUint16(8, true), 0, 'method 0: stored');
  assert.equal(head.getUint16(26, true), 8, 'name length');
  assert.equal(head.getUint16(28, true), 0, 'no extra field');
  assert.equal(strFromU8(bytes.subarray(30, 38)), 'mimetype');
  assert.equal(strFromU8(bytes.subarray(38, 38 + 27)), 'application/x-krita-palette', 'the data follows the name as it is');
  const files = unzipSync(bytes);
  assert.deepEqual(Object.keys(files), ['mimetype', 'colorset.xml', 'profiles.xml']);
  assert.equal(strFromU8(files.mimetype), 'application/x-krita-palette');
  assert.equal(strFromU8(files['profiles.xml']), '<Profiles/>\n', 'an empty profiles.xml would fail the load');
});

test('KPL: the mimetype string is in the raw bytes, where Krita sniffs for it', () => {
  const raw = Buffer.from(writeKpl('Study', swatchesAt(3))).toString('latin1');
  assert.ok(raw.includes('application/x-krita-palette'));
});

test('KPL: colorset.xml and profiles.xml are well-formed', () => {
  const k = readKpl(writeKpl('Study', [...ramp('a', 'Skin', 3), sw('#123456', 'Loose')]));
  assert.deepEqual(Object.keys(k.root.attrs).sort(), ['columns', 'comment', 'name', 'rows', 'version']);
  assert.deepEqual([k.root.attrs.version, k.root.attrs.name, k.root.attrs.comment], ['2.0', 'Study', '']);
  const profiles = parseXml(strFromU8(k.files['profiles.xml']));
  assert.deepEqual([profiles.tag, profiles.kids.length], ['Profiles', 0]);
});

test('KPL: ramps come back as groups, light to dark along a row, loose colours in the palette’s own group', () => {
  const list = [...[...ramp('a', 'Skin', 5)].reverse(), ...ramp('b', 'Cloth', 3), ...swatchesAt(20, 'Loose ')];
  const k = readKpl(writeKpl('Study', list));
  assert.equal(k.columns, 16, 'the widest row: 16 loose colours beat the 5-step ramp');
  assert.deepEqual(k.groups.map((g) => [g.name, g.rows]), [['Skin', 1], ['Cloth', 1]]);
  assert.deepEqual(k.groups[0].entries.map((e) => [e.name, e.row, e.column]), [['Skin 0', 0, 0], ['Skin', 0, 1], ['Skin 2', 0, 2], ['Skin 3', 0, 3], ['Skin 4', 0, 4]]);
  assert.deepEqual(k.groups[1].entries.map((e) => [e.name, e.row, e.column]), [['Cloth 0', 0, 0], ['Cloth', 0, 1], ['Cloth 2', 0, 2]]);
  assert.equal(k.own.rows, 2);
  assert.deepEqual(k.own.entries.map((e) => [e.name, e.row, e.column]), Array.from({ length: 20 }, (_, i) => [`Loose ${i}`, Math.floor(i / 16), i % 16]));
});

test('KPL: a palette of ramps alone is as wide as its longest ramp, and its own group is empty', () => {
  const k = readKpl(writeKpl('Study', [...ramp('a', 'Skin', 5), ...ramp('b', 'Cloth', 7)]));
  assert.equal(k.columns, 7);
  assert.deepEqual([k.root.attrs.rows, k.own.entries.length], ['0', 0]);
  assert.deepEqual(k.groups.map((g) => [g.name, g.entries.length]), [['Skin', 5], ['Cloth', 7]]);
});

test('KPL: colours decode by Krita’s own rule to the swatch bytes, all 256 levels and one outside sRGB', () => {
  const greys = Array.from({ length: 256 }, (_, i) => sw(`#${i.toString(16).padStart(2, '0').repeat(3)}`, `g${i}`));
  const wide: Swatch = { ...sw('#00ff00', 'Wide'), oklch: [0.85, 0.3, 142] };
  const shades = ramp('a', 'Skin', 5);
  const k = readKpl(writeKpl('Study', [...greys, wide, ...shades]));
  const loose = [...greys, wide];
  assert.deepEqual(k.own.entries.map((e) => e.rgb), loose.map((s) => rgb255(s.oklch)));
  assert.deepEqual(k.own.entries.slice(0, 256).map((e) => e.rgb[0]), greys.map((_, i) => i));
  const byStep = [...shades].sort((a, b) => a.step! - b.step!);
  assert.deepEqual(k.groups[0].entries.map((e) => e.rgb), byStep.map((s) => rgb255(s.oklch)));
});

test('KPL: & < > " in names are escaped and control characters dropped', () => {
  const list = [...ramp('a', 'R&D <1> "x"', 3), sw('#123456', 'Tom & Jerry <3 "quoted"'), sw('#654321', 'tab\tand\u0001bell')];
  const bytes = writeKpl('Acme & "Co" <x>', list);
  const text = strFromU8(unzipSync(bytes)['colorset.xml']);
  assert.ok(text.includes('name="Acme &amp; &quot;Co&quot; &lt;x&gt;"'), text.split('\n')[0]);
  assert.ok(!/&(?!(amp|lt|gt|quot);)/.test(text), 'no bare ampersand');
  assert.ok(!/[\u0000-\u0009\u000b-\u001f]/.test(text), 'no control characters, not even a tab');
  const k = readKpl(bytes);
  assert.equal(k.root.attrs.name, 'Acme & "Co" <x>');
  assert.deepEqual(k.groups.map((g) => g.name), ['R&D <1> "x"']);
  assert.deepEqual(k.own.entries.map((e) => e.name), ['Tom & Jerry <3 "quoted"', 'tab andbell']);
});

test('KPL: ramps with one name get unique, non-empty group names, each keeping its own swatches', () => {
  const list = [...ramp('a', 'Skin', 3), ...ramp('b', 'Skin', 3), ...ramp('c', 'Skin', 2), ...ramp('d', '\u0001', 2), ...ramp('e', 'Skin 2', 2)];
  const k = readKpl(writeKpl('P', list));
  assert.deepEqual(k.groups.map((g) => g.name), ['Skin', 'Skin 2', 'Skin 3', 'Ramp', 'Skin 2 2']);
  assert.deepEqual(k.groups.map((g) => g.entries.length), [3, 3, 2, 2, 2]);
});

test('KPL: an empty palette is still a valid Krita palette', () => {
  const bytes = writeKpl('  ', []);
  const k = readKpl(bytes);
  assert.deepEqual([k.root.attrs.name, k.root.attrs.columns, k.root.attrs.rows, k.root.kids.length], ['Palette', '1', '0', 0]);
  assert.deepEqual(Object.keys(k.files), ['mimetype', 'colorset.xml', 'profiles.xml']);
  assert.equal(new DataView(bytes.buffer, bytes.byteOffset).getUint16(8, true), 0, 'mimetype still stored');
});

test('KPL: a Design palette without ramps fills its own group, 16 to a row', () => {
  const k = readKpl(writeKpl('Brand', swatchesAt(17)));
  assert.deepEqual(k.groups, []);
  assert.deepEqual([k.columns, k.own.rows], [16, 2]);
  assert.deepEqual(k.own.entries.map((e) => [e.row, e.column]).slice(14), [[0, 14], [0, 15], [1, 0]]);
  const few = readKpl(writeKpl('Brand', swatchesAt(4)));
  assert.deepEqual([few.columns, few.own.rows], [4, 1]);
  assert.deepEqual(few.own.entries.map((e) => [e.name, e.row, e.column]), [['c0', 0, 0], ['c1', 0, 1], ['c2', 0, 2], ['c3', 0, 3]]);
});

test('KPL: a ramp longer than Krita’s 4096 columns wraps onto a second row', () => {
  const long = Array.from({ length: 4100 }, (_, i) => ({ ...sw('#336699', `s${i}`), group: 'a', step: i }));
  const k = readKpl(writeKpl('Long', long));
  assert.deepEqual([k.columns, k.groups[0].rows], [4096, 2]);
  assert.deepEqual(k.groups[0].entries.slice(-2).map((e) => [e.name, e.row, e.column]), [['s4098', 1, 2], ['s4099', 1, 3]]);
});

test('CSS: --on-primary beside a Primary, hex twins optional; Tailwind 4 as an @theme block', () => {
  const brand = [sw('#e8643c', 'Ember', 'Primary'), sw('#14161a', 'Ink', 'Text'), sw('#fbf7f0', 'Paper', 'Background')];
  const css = writeCss(brand);
  assert.match(css, /--on-primary: oklch\(/);
  assert.match(css, /--on-primary-hex: #[0-9a-f]{6};/);
  assert.match(writeCss(brand, { hex: false }), /--on-primary: oklch\(/);
  assert.doesNotMatch(writeCss(brand, { hex: false }), /-hex/);
  assert.doesNotMatch(writeCss(UI), /on-primary/, 'no Primary, no on-primary');
  const tw = writeTailwind4(brand);
  assert.ok(tw.startsWith('@theme {\n') && tw.endsWith('\n}\n'));
  assert.match(tw, /^ {2}--color-primary: oklch\(/m);
  assert.match(tw, /^ {2}--color-on-primary: oklch\(/m);
});
