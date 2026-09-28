import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { strFromU8, unzipSync } from 'fflate';
import { readPaletteFile } from '../src/shared/color/palette-readers.ts';
import { hexToOklch, toHex } from '../src/shared/color/index.ts';
import type { Swatch } from '../src/shared/types.ts';
import {
  cssNames,
  writeAco,
  writeAse,
  writeCss,
  writeGpl,
  writeJson,
  writeProcreate,
  writeSheetSvg,
  writeTailwind,
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
