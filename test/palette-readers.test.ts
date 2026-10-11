import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { readPaletteFile } from '../src/shared/color/palette-readers.ts';
import { hexToOklch, toHex } from '../src/shared/color/index.ts';

const fixture = (name: string) => new Uint8Array(readFileSync(new URL(`fixtures/${name}`, import.meta.url)));
const hexes = (f: ReturnType<typeof readPaletteFile>) => f.swatches.map((s) => toHex(s.oklch));
const near = (a: number[] | undefined, b: number[]) =>
  assert.ok(a && a.length === b.length && a.every((v, i) => Math.abs(v - b[i]) < 1e-6), `${a} ≈ ${b}`);

// ── byte builders (big-endian) ───────────────────────────────────────────────────────────────────

const u16 = (v: number) => [(v >> 8) & 255, v & 255];
const u32 = (v: number) => [...u16(v >>> 16), ...u16(v & 0xffff)];
const f32 = (v: number) => {
  const d = new DataView(new ArrayBuffer(4));
  d.setFloat32(0, v);
  return [...new Uint8Array(d.buffer)];
};
const ascii = (s: string) => [...s].map((c) => c.charCodeAt(0));
const utf8 = (s: string) => new TextEncoder().encode(s);
const utf16z = (s: string) => [...s, '\0'].flatMap((c) => u16(c.charCodeAt(0)));

const aseBlock = (type: number, body: number[]) => [...u16(type), ...u32(body.length), ...body];
const aseName = (s: string) => [...u16(s.length + 1), ...utf16z(s)];
const aseColour = (name: string, model: string, values: number[], type: number) =>
  aseBlock(1, [...aseName(name), ...ascii(model), ...values.flatMap(f32), ...u16(type)]);
const aseFile = (blocks: number[][]) =>
  Uint8Array.from([...ascii('ASEF'), ...u16(1), ...u16(0), ...u32(blocks.length), ...blocks.flat()]);

type AcoEntry = { space: number; w: number[]; name?: string };
const acoSection = (version: 1 | 2, entries: AcoEntry[]) => [
  ...u16(version),
  ...u16(entries.length),
  ...entries.flatMap((e) => [
    ...u16(e.space),
    ...e.w.flatMap(u16),
    ...(version === 2 ? [...u32((e.name ?? '').length + 1), ...utf16z(e.name ?? '')] : []),
  ]),
];
/** 8-bit channel to the 16-bit value that divides back exactly */
const w8 = (v: number) => v * 257;

// ── ASE ──────────────────────────────────────────────────────────────────────────────────────────

test('ASE: chalk_palette.ase reads names and exact colours', () => {
  const f = readPaletteFile('ase', fixture('chalk_palette.ase'), 'chalk_palette');
  assert.equal(f.name, 'chalk_palette');
  assert.deepEqual(f.warnings, []);
  assert.deepEqual(f.swatches.map((s) => s.name), ['Amaranth', 'Midnight', 'Gunmetal', 'Fawn', 'Snow']);
  assert.deepEqual(hexes(f), ['#e72a50', '#0c0427', '#412046', '#e6b16d', '#fff9f2']);
  for (const s of f.swatches) {
    assert.equal(s.type, 'process');
    assert.equal(s.role, null);
    assert.equal(s.source?.space, 'rgb');
    assert.equal(s.source?.values.length, 3);
  }
  near(f.swatches[0].source?.values, [0xe7 / 255, 0x2a / 255, 0x50 / 255].map(Math.fround));
});

test('ASE: glossy-pastic_palette.ase colours match their hex names', () => {
  const f = readPaletteFile('ase', fixture('glossy-pastic_palette.ase'), 'glossy-pastic_palette');
  assert.equal(f.swatches.length, 7);
  assert.deepEqual(hexes(f), f.swatches.map((s) => s.name));
});

test('ASE: reads from a view into a larger buffer (pooled Node Buffers)', () => {
  const file = fixture('chalk_palette.ase');
  const big = new Uint8Array(file.length + 10);
  big.set(file, 3);
  const f = readPaletteFile('ase', big.subarray(3, 3 + file.length), 'x');
  assert.deepEqual(hexes(f), ['#e72a50', '#0c0427', '#412046', '#e6b16d', '#fff9f2']);
});

test('ASE: groups flatten into names; global and spot flags and original values kept', () => {
  const f = readPaletteFile(
    'ase',
    aseFile([
      aseBlock(0xc001, aseName('Brand')),
      aseColour('Ink', 'CMYK', [1, 0.5, 0, 0.2], 0),
      aseColour('Seal', 'LAB ', [0.5, 20, -30], 1),
      aseBlock(0xc002, []),
      aseColour('Paper', 'Gray', [0.8], 2),
      aseColour('Odd', 'XYZ ', [0.1, 0.2, 0.3], 2),
    ]),
    'brand',
  );
  assert.deepEqual(f.swatches.map((s) => s.name), ['Ink', 'Seal', 'Paper'], 'one group: its folder, not part of the names');
  assert.deepEqual(f.swatches.map((s) => s.type), ['global', 'spot', 'process']);
  const [ink, seal, paper] = f.swatches;
  assert.equal(ink.source?.space, 'cmyk');
  near(ink.source?.values, [1, 0.5, 0, 0.2].map(Math.fround));
  assert.equal(toHex(ink.oklch), '#0066cc');
  assert.equal(seal.source?.space, 'lab');
  near(seal.source?.values, [50, 20, -30]);
  assert.equal(toHex(seal.oklch), '#856caa', 'Lab is D50 (Bradford to sRGB)');
  assert.equal(paper.source?.space, 'gray');
  assert.equal(toHex(paper.oklch), '#cccccc');
  assert.ok(f.warnings.some((w) => w.includes('XYZ')), 'unsupported model named');
  assert.ok(f.warnings.some((w) => w.includes('CMYK')), 'CMYK estimate noted');
});

test('ASE: with several groups, each swatch name carries its group', () => {
  const f = readPaletteFile(
    'ase',
    aseFile([
      aseBlock(0xc001, aseName('Light')),
      aseColour('Paper', 'Gray', [0.9], 2),
      aseBlock(0xc002, []),
      aseBlock(0xc001, aseName('Dark')),
      aseColour('Paper', 'Gray', [0.1], 2),
      aseBlock(0xc002, []),
    ]),
    'modes',
  );
  assert.deepEqual(f.swatches.map((s) => s.name), ['Light / Paper', 'Dark / Paper']);
});

test('ASE: a truncated file keeps the colours before the cut and says so', () => {
  const f = readPaletteFile('ase', fixture('chalk_palette.ase').subarray(0, 150), 'x');
  assert.deepEqual(f.swatches.map((s) => s.name), ['Amaranth', 'Midnight', 'Gunmetal']);
  assert.ok(f.warnings.some((w) => w.includes('ends early')));
});

test('ASE: junk and empty files throw a readable reason', () => {
  assert.throws(() => readPaletteFile('ase', utf8('GIMP Palette\n'), 'x'), /isn't an Adobe swatch exchange/);
  assert.throws(() => readPaletteFile('ase', new Uint8Array(0), 'x'), /isn't an Adobe/);
  assert.throws(() => readPaletteFile('ase', aseFile([aseBlock(0xc001, aseName('Empty')), aseBlock(0xc002, [])]), 'x'), /No colours/);
});

// ── ACO ──────────────────────────────────────────────────────────────────────────────────────────

const ACO: AcoEntry[] = [
  { space: 0, w: [w8(0xe7), w8(0x2a), w8(0x50), 0], name: 'Amaranth' },
  { space: 1, w: [21845, 65535, 65535, 0], name: 'Green (HSB)' },
  { space: 2, w: [0, 65535, 65535, 65535], name: 'Cyan' }, // 0 = 100% ink
  { space: 7, w: [5000, 2000, -3000 & 0xffff, 0], name: 'Seal' },
  { space: 8, w: [2000, 0, 0, 0], name: '20% grey' },
  { space: 3, w: [1, 2, 3, 4], name: 'Some Pantone' },
];

test('ACO v1: colours in every supported space, no names', () => {
  const f = readPaletteFile('aco', Uint8Array.from(acoSection(1, ACO)), 'swatches');
  assert.equal(f.name, 'swatches');
  assert.deepEqual(f.swatches.map((s) => s.name), ['', '', '', '', '']);
  const [rgb, hsb, cmyk, lab, gray] = f.swatches;
  assert.equal(toHex(rgb.oklch), '#e72a50');
  near(rgb.source?.values, [0xe7 / 255, 0x2a / 255, 0x50 / 255]);
  assert.equal(toHex(hsb.oklch), '#00ff00');
  near(hsb.source?.values, [0, 1, 0]); // HSB is kept as the sRGB it makes, so a file's colours all count as imported
  assert.equal(toHex(cmyk.oklch), '#00ffff');
  assert.deepEqual(cmyk.source, { space: 'cmyk', values: [1, 0, 0, 0] });
  assert.deepEqual(lab.source, { space: 'lab', values: [50, 20, -30] });
  assert.equal(toHex(lab.oklch), '#856caa');
  assert.deepEqual(gray.source, { space: 'gray', values: [0.8] });
  assert.equal(toHex(gray.oklch), '#cccccc');
  assert.ok(f.warnings.some((w) => w.includes('Pantone')));
  assert.ok(f.swatches.every((s) => s.type === 'process'));
});

test('ACO v1 + v2: names come from the v2 section', () => {
  const f = readPaletteFile('aco', Uint8Array.from([...acoSection(1, ACO), ...acoSection(2, ACO)]), 'x');
  assert.deepEqual(f.swatches.map((s) => s.name), ['Amaranth', 'Green (HSB)', 'Cyan', 'Seal', '20% grey']);
  assert.equal(toHex(f.swatches[0].oklch), '#e72a50');
});

test('ACO v2 on its own', () => {
  const f = readPaletteFile('aco', Uint8Array.from(acoSection(2, ACO.slice(0, 1))), 'x');
  assert.deepEqual(f.swatches.map((s) => s.name), ['Amaranth']);
});

test('ACO: a cut-off v2 section falls back to the complete v1 colours', () => {
  const bytes = [...acoSection(1, ACO), ...acoSection(2, ACO)];
  const f = readPaletteFile('aco', Uint8Array.from(bytes.slice(0, bytes.length - 20)), 'x');
  assert.equal(f.swatches.length, 5);
  assert.deepEqual(f.swatches.map((s) => s.name), ['', '', '', '', '']);
  assert.ok(f.warnings.some((w) => w.includes('ends early')));
});

test('ACO: junk throws', () => {
  assert.throws(() => readPaletteFile('aco', Uint8Array.from([0, 5, 0, 0]), 'x'), /isn't a Photoshop swatches/);
  assert.throws(() => readPaletteFile('aco', Uint8Array.from(acoSection(1, [])), 'x'), /No colours/);
});

// ── GPL ──────────────────────────────────────────────────────────────────────────────────────────

test('GPL: name, colours, optional names, bad lines counted', () => {
  const f = readPaletteFile(
    'gpl',
    utf8('GIMP Palette\nName: Sunset\nColumns: 4\n#\n255   0   0\tRed\n  0 128 255 Sky blue\n12 34 56\n300 0 0 Too bright\nnot a colour\n'),
    'fallback',
  );
  assert.equal(f.name, 'Sunset');
  assert.deepEqual(f.swatches.map((s) => s.name), ['Red', 'Sky blue', '']);
  assert.deepEqual(hexes(f), ['#ff0000', '#0080ff', '#0c2238']);
  assert.deepEqual(f.swatches[0].source, { space: 'rgb', values: [1, 0, 0] });
  assert.deepEqual(f.warnings, ["Skipped 2 lines that couldn't be read."]);
});

test('GPL: Aseprite RGBA drops empty slots and makes partial alpha opaque, and says so', () => {
  const f = readPaletteFile(
    'gpl',
    utf8('GIMP Palette\nChannels: RGBA\n#\n254  91  89 255\tRed\n  0   0   0   0\tTransparent\n247 165 71 128 Half orange\n247 165 71 255\n'),
    'x',
  );
  assert.deepEqual(f.swatches.map((s) => s.name), ['Red', 'Half orange', '']);
  assert.deepEqual(hexes(f), ['#fe5b59', '#f7a547', '#f7a547']);
  assert.deepEqual(f.warnings, ['Skipped 1 fully transparent colour.', "Made 1 partly transparent colour opaque; transparency isn't kept."]);
});

test('GPL: BOM, CRLF and no Name header', () => {
  const f = readPaletteFile('gpl', utf8('﻿GIMP Palette\r\nChannels: RGB\r\n255 255 255 White\r\n'), 'fallback');
  assert.equal(f.name, 'fallback');
  assert.deepEqual(hexes(f), ['#ffffff']);
  assert.deepEqual(f.warnings, []);
});

test('GPL: junk throws', () => {
  assert.throws(() => readPaletteFile('gpl', utf8('ASEF'), 'x'), /isn't a GIMP palette/);
  assert.throws(() => readPaletteFile('gpl', utf8('GIMP Palette\nName: Empty\n'), 'x'), /No colours/);
});

// ── all ──────────────────────────────────────────────────────────────────────────────────────────

test('every read makes fresh random ids', () => {
  const a = readPaletteFile('ase', fixture('chalk_palette.ase'), 'x').swatches.map((s) => s.id);
  const b = readPaletteFile('ase', fixture('chalk_palette.ase'), 'x').swatches.map((s) => s.id);
  const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
  assert.ok([...a, ...b].every((id) => uuid.test(id)));
  assert.equal(new Set([...a, ...b]).size, a.length + b.length);
});

test('stored OKLCH is the unrounded colour', () => {
  const [s] = readPaletteFile('gpl', utf8('GIMP Palette\n231 42 80 Amaranth\n'), 'x').swatches;
  assert.deepEqual(s.oklch, hexToOklch('#e72a50'));
});

// Spec §12 asks for real .aco files. Photoshop's own swatch presets can't ship in this public repo,
// so they are read where Photoshop is installed, and the test is skipped elsewhere.
const PS_SWATCHES = ['Adobe Photoshop 2026', 'Adobe Photoshop 2025', 'Adobe Photoshop (Beta)']
  .map((v) => `C:/Program Files/Adobe/${v}/Presets/Color Swatches`)
  .find((d) => existsSync(d));

test("Photoshop's own .aco presets read in full", { skip: !PS_SWATCHES && 'Photoshop is not installed here' }, () => {
  const files = readdirSync(PS_SWATCHES!).filter((f) => f.toLowerCase().endsWith('.aco'));
  assert.ok(files.length > 0);
  for (const f of files) {
    const read = readPaletteFile('aco', new Uint8Array(readFileSync(`${PS_SWATCHES}/${f}`)), f);
    assert.ok(read.swatches.length > 0, f);
    assert.ok(read.swatches.every((w) => /^#[0-9a-f]{6}$/.test(toHex(w.oklch))), f);
    // RGB, HSB, CMYK, Lab and grey are read; only wide CMYK and the named-book spaces are skipped
    assert.ok(read.warnings.every((w) => !/ends early/i.test(w)), `${f}: ${read.warnings}`);
  }
  // a v1 + v2 file keeps its names (v1-only ones, like Windows.aco, have none to keep)
  if (files.includes('ANPA Colors.aco')) {
    const anpa = readPaletteFile('aco', new Uint8Array(readFileSync(`${PS_SWATCHES}/ANPA Colors.aco`)), 'ANPA');
    assert.ok(anpa.swatches.every((w) => w.name.startsWith('ANPA ')));
  }
});
