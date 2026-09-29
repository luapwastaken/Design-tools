import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  assetHashes,
  cantOpen,
  importSummary,
  itemProblem,
  openTarget,
  rasterises,
  receiveLabel,
  sendKindOf,
  sentMessage,
  targetsFor,
  toolForShortcut,
} from '../src/renderer/shell/core/routing.ts';
import type { ToolDefinition } from '../src/renderer/shell/tool.ts';
import type { LibraryItemRef, LoadedItem } from '../src/shared/types.ts';

const tool = (o: Partial<ToolDefinition<any>> & Pick<ToolDefinition<any>, 'id' | 'accepts'>): ToolDefinition<any> => ({
  label: o.id,
  group: 'image',
  icon: 'palette',
  shortcut: 0,
  docVersion: 1,
  createEmptyDoc: () => ({}),
  receive: async (_i, _u, d) => d,
  View: () => null,
  ...o,
});

const design = tool({ id: 'design', itemKind: 'palette', shortcut: 1, accepts: { palette: { mode: 'open', label: 'PALETTE' }, image: { mode: 'apply', label: 'EXTRACT' } } });
const pattern = tool({ id: 'pattern', itemKind: 'pattern', shortcut: 3, accepts: { pattern: { mode: 'open', label: 'PATTERN' }, logo: { mode: 'apply', label: 'AS SHAPE' } } });
const dither = tool({
  id: 'dither',
  shortcut: 5,
  render: async () => ({ blob: new Blob(), name: 'x', ext: 'png' }),
  accepts: { image: { mode: 'open', label: 'IMAGE' }, pattern: { mode: 'open', label: 'AS IMAGE' }, palette: { mode: 'apply', label: 'PALETTE' } },
});
const tools = [design, pattern, dither];

test('Send to lists the tools that accept a kind, with their use', () => {
  assert.deepEqual(
    targetsFor('palette', tools).map((t) => [t.tool.id, t.use.label]),
    [
      ['design', 'PALETTE'],
      ['dither', 'PALETTE'],
    ],
  );
  assert.deepEqual(targetsFor('svg', tools), []);
});

test('open routing: the active tool if it accepts the kind, else the tool whose itemKind it is', () => {
  assert.equal(openTarget('palette', dither, tools)?.tool.id, 'dither');
  assert.equal(openTarget('palette', dither, tools)?.use.mode, 'apply');
  assert.equal(openTarget('pattern', design, tools)?.tool.id, 'pattern');
  assert.equal(openTarget('logo', pattern, tools)?.use.label, 'AS SHAPE');
  // an image with no accepting active tool can't be opened (spec §6.4)
  assert.equal(openTarget('image', pattern, tools), null);
  assert.equal(openTarget('image', design, tools)?.tool.id, 'design');
  assert.equal(openTarget('palette', undefined, tools)?.tool.id, 'design');
});

test('image tools get patterns, logos and SVGs as images; doc tools get them as they are', () => {
  assert.equal(rasterises(dither, 'pattern'), true);
  assert.equal(rasterises(dither, 'logo'), true);
  assert.equal(rasterises(dither, 'svg'), true);
  assert.equal(rasterises(dither, 'image'), false);
  assert.equal(rasterises(dither, 'palette'), false);
  assert.equal(rasterises(pattern, 'logo'), false);
});

test('what a tool sends', () => {
  assert.equal(sendKindOf(design, false), 'palette');
  assert.equal(sendKindOf(design, true), null);
  assert.equal(sendKindOf(dither, false), 'image');
  assert.equal(sendKindOf(tool({ id: 'postfx', accepts: {} }), false), null);
});

test('history labels and the Send to toast', () => {
  assert.equal(receiveLabel('Monolith core', { mode: 'open', label: 'PALETTE' }), 'Open Monolith core');
  assert.equal(receiveLabel('Monolith core', { mode: 'apply', label: 'INKS' }), 'Inks from Monolith core');
  assert.equal(receiveLabel('Monolith core', { mode: 'apply', label: 'PICK COLOURS' }), 'Pick colours from Monolith core');
  assert.equal(receiveLabel('Bracket mark', { mode: 'apply', label: 'AS SHAPE' }), 'Bracket mark as shape');
  // the toast's Undo and Ctrl Z hint say how to go back, so the message doesn't (brief §6)
  assert.equal(sentMessage('Monolith core', { mode: 'open', label: 'PALETTE' }, 'Design'), 'Opened Monolith core in Design.');
  assert.equal(sentMessage('Monolith core', { mode: 'apply', label: 'INKS' }, 'Halftone'), 'Inks from Monolith core in Halftone.');
});

test('Ctrl+<n> finds the tool with that shortcut', () => {
  assert.equal(toolForShortcut(5, tools), 'dither');
  assert.equal(toolForShortcut(9, tools), null);
});

test('asset hashes a document refers to, for this tool only', () => {
  const h1 = 'a'.repeat(64);
  const h2 = 'b'.repeat(64);
  const doc = {
    source: { url: `dt://asset/dither/${h1}.png`, hash: h1 },
    layers: [`dt://asset/dither/${h1}.png`, `dt://asset/halftone/${h2}.png`, `dt://asset/dither/${h2}.tif`],
  };
  assert.deepEqual(assetHashes('dither', doc).sort(), [h1, h2]);
  assert.deepEqual(assetHashes('postfx', doc), []);
  assert.deepEqual(assetHashes('dither', undefined), []);
});

test('an import says what it made, or why not, and what the readers noticed', () => {
  const made = (...names: string[]) => names.map((name) => ({ name }) as LibraryItemRef);
  const none = { failed: [], warnings: [] };
  assert.deepEqual(importSummary({ ...none, made: made('A') }, 'Scratch'), { made: 'Added A to Scratch.', failed: null, warned: null });
  assert.equal(importSummary({ ...none, made: made('A', 'B') }, '').made, 'Added A and B to the Library root.');
  assert.equal(importSummary({ ...none, made: made('A', 'B', 'C') }, 'M').made, 'Added A, B and C to M.');
  assert.equal(importSummary({ ...none, made: made('A', 'B', 'C', 'D', 'E') }, 'M').made, 'Added A, B and 3 more to M.');
  const psd = "PSD files aren't supported. Export a PNG or TIFF.";
  const r = importSummary(
    {
      made: made('chalk'),
      failed: [
        { name: 'x.psd', reason: psd },
        { name: 'y.psd', reason: psd },
        { name: 'gone.png', reason: "The file isn't there any more" },
      ],
      warnings: [{ name: 'chalk', messages: ['Skipped 2 colours in wide CMYK', 'CMYK colours are shown as an estimate; the original values are kept.'] }],
    },
    'M',
  );
  // one sentence per reason, no nested brackets; every sentence ends in a full stop
  assert.equal(r.failed, `Couldn't import x.psd and y.psd. ${psd} Couldn't import gone.png. The file isn't there any more.`);
  assert.equal(r.warned, 'chalk: Skipped 2 colours in wide CMYK. CMYK colours are shown as an estimate; the original values are kept.');
});

test('an item file is checked before a tool gets it', () => {
  const ref = { name: 'Brand' } as LibraryItemRef;
  const palette = (payload: unknown) => ({ ref, kind: 'palette', payload }) as LoadedItem;
  const w = { id: 'a', name: 'Ink', role: null, oklch: [0.5, 0.1, 30], type: 'process' };
  assert.equal(itemProblem(palette({ swatches: [w], notes: '' })), null);
  assert.equal(itemProblem(palette({ swatches: [] })), null);
  // an Illustration palette: its ramps and each swatch's ramp, step and hand-edit mark pass through
  const ramp = { id: 'r', base: [0.5, 0.1, 30], light: [0.95, 0.05, 85], shadow: [0.4, 0.08, 275], material: 'cloth', intensity: 'grounded', steps: 3, hueShift: 0, chromaCurve: 0, hero: true };
  assert.equal(itemProblem(palette({ swatches: [{ ...w, group: 'r', step: 0 }, { ...w, id: 'b', group: 'r', step: 1, edited: true }], notes: '', ramps: [ramp] })), null);
  assert.equal(itemProblem(palette({ swatches: null })), "Brand isn't a readable palette.");
  assert.equal(itemProblem(palette({ swatches: [{ ...w, oklch: [0.5, 'x', 30] }] })), "Brand isn't a readable palette.");
  assert.equal(itemProblem(palette({ swatches: [{ ...w, oklch: [0.5, 0.1] }] })), "Brand isn't a readable palette.");
  assert.equal(itemProblem(palette(undefined)), "Brand isn't a readable palette.");
  const pattern = (preview: unknown) => ({ ref, kind: 'pattern', payload: { preview } }) as LoadedItem;
  assert.equal(itemProblem(pattern({ svg: '<svg/>', tileWidth: 10, tileHeight: 10 })), null);
  assert.equal(itemProblem(pattern({ svg: '<svg/>', tileWidth: 10 })), "Brand isn't a readable pattern.");
  const logo = (preview: unknown) => ({ ref, kind: 'logo', payload: { preview } }) as LoadedItem;
  assert.equal(itemProblem(logo({ svg: '<svg/>' })), null);
  assert.equal(itemProblem(logo(null)), "Brand isn't a readable logo.");
  assert.equal(itemProblem({ ref, kind: 'svg', url: 'dt://item/x' }), null);
});

test('a double-click nothing takes says where the kind does open', () => {
  assert.equal(cantOpen('image', ['Dither', 'Halftone', 'Post FX']), 'Images open in Dither, Halftone or Post FX. Switch to one, or use Send to.');
  assert.equal(cantOpen('svg', ['Dither']), 'SVGs open in Dither. Switch to it, or use Send to.');
  assert.equal(cantOpen('logo', []), 'No tool opens logos yet.');
});
