// The smoke pass (spec §12), started by main.tsx when main passes --dt-smoke-run (`npm run smoke`
// runs scripts/smoke.mjs). It drives the real shell, IPC and Library in the smoke folder, reports
// each check, and hands the result to main (app.smokeDone), which quits through the close handshake.
// 'full' runs the smoke list; 'quiet' is the relaunch: it restores, checks, and quits with no input.
import { contrast, cssColor, rgb255, toHex, type Oklch } from '../shared/color/index.ts';
import { INKS } from '../shared/palette/inks.ts';
import type { DocController } from '../shared/doc-api.ts';
import { layoutLockup } from '../shared/logo/layout.ts';
import { PAPER } from '../shared/logo/sheet.ts';
import { lockupSvg } from '../shared/logo/svg.ts';
import type { Rect } from '../shared/logo/types.ts';
import { layoutTile, reachOf } from '../shared/pattern/layout.ts';
import { parseSize } from '../shared/svg/index.ts';
import { ALGORITHMS } from '../shared/dither/algorithms.ts';
import type { LibraryItemRef, PatternPayload, Swatch, ToolId } from '../shared/types.ts';
import { saveFile, saveToFolder } from './lib/export.ts';
import { decodeFrames } from './lib/frames.ts';
import { gifWriter, readGif } from './lib/gif.ts';
import { decodeImage } from './lib/load.ts';
import type { Rgba8 } from './lib/png-indexed.ts';
import { shell } from './shell/core/index.ts';
import { select as selectInDesign } from './tools/design/actions.ts';
import { newSwatch as designSwatch, recolour as recolourInDesign, type DesignDoc } from './tools/design/doc.ts';
import { clearProposals, proposals } from './tools/design/proposals.ts';
import { getView as designView, patchView as patchDesign } from './tools/design/view-state.ts';
import { used, type DitherDoc } from './tools/dither/doc.ts';
import { lookOf as ditherLook, withLook } from './tools/dither/looks.ts';
import { dithered, ready as ditherReady, type Result } from './tools/dither/pipeline.ts';
import { status as ditherStatus } from './tools/dither/view-state.ts';
import { emptyDoc as halftoneEmpty, mapInk, opaqueOf, spotInk, type HalftoneDoc } from './tools/halftone/doc.ts';
import { lookOf, Painter } from './tools/halftone/draw.ts';
import { platesFor, pngBlob, svgFor } from './tools/halftone/exports.ts';
import { ready, screen, shownDots, svgOver, totals } from './tools/halftone/screening.ts';
import { status as halftoneStatus } from './tools/halftone/view-state.ts';
import { addRamp, recolour, setSpec, stepsOf, type IllustrationDoc } from './tools/illustration/doc.ts';
import { liveEngine, paintEngineChecks, type PaintEngine } from './tools/illustration/paint/index.ts';
import { paintSettings, type PaintSettings } from './tools/illustration/paint-sources.ts';
import { isEmpty as noParts, lockupOf, shownLockups, type LogoDoc } from './tools/logo/doc.ts';
import { faviconBundle, sheetSvg } from './tools/logo/files.ts';
import { partFromImage, partFromSvg } from './tools/logo/intake.ts';
import { pngSize } from './tools/logo/geometry.ts';
import { drawSvg } from './tools/logo/raster.ts';
import { patchView as patchLogo } from './tools/logo/view-state.ts';
import { clearProposals as clearBases, proposals as bases } from './tools/illustration/proposals.ts';
import { getView as illustrationView, patchView as patchIllustration } from './tools/illustration/view-state.ts';
import { PX_PER, toPayload, withUnit, type PatternDoc } from './tools/pattern/doc.ts';
import { patchView as patchPattern } from './tools/pattern/view-state.ts';
import { addEffect, importCode } from './tools/postfx/actions.ts';
import { layerOf, offered, timeline, type PostFxDoc } from './tools/postfx/doc.ts';
import { datamoshChecks, flickerChecks, loopChecks, pipelineChecks, scaleChecks } from './tools/postfx/effects/checks.ts';
import { Stack } from './tools/postfx/effects/stack.ts';
import { decodeStack, encodeStack } from './tools/postfx/share.ts';
import { togglePlay } from './tools/postfx/Transport.tsx';
import { playhead } from './tools/postfx/view-state.ts';
import { toast } from './ui/index.ts';
import { toastStore } from './ui/toast.ts';

const api = window.api;
const report: string[] = [];
let failures = 0;

function check(name: string, ok: unknown, detail?: unknown): boolean {
  const why = ok || detail === undefined ? '' : ` :: ${typeof detail === 'string' ? detail : JSON.stringify(detail)}`;
  report.push(`${ok ? 'ok  ' : 'FAIL'} ${name}${why}`);
  if (!ok) failures++;
  return !!ok;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** poll until `fn` gives something truthy; null after `ms` */
async function until<T>(fn: () => T | Promise<T>, ms = 8000): Promise<T | null> {
  for (const end = Date.now() + ms; ; await sleep(25)) {
    const v = await fn();
    if (v) return v;
    if (Date.now() > end) return null;
  }
}

const find = async (fn: (i: LibraryItemRef) => boolean) =>
  (await api.invoke('library.index')).collections.flatMap((c) => c.items).find(fn) ?? null;
const stat = (id: string) => api.invoke('library.stat', id).catch(() => null);
const swatchCount = async (id: string) => {
  const item = await api.invoke('library.read', id).catch(() => null);
  return item?.kind === 'palette' ? item.payload.swatches.length : -1;
};
const designDoc = () => shell.doc('design') as DocController<DesignDoc>;
const illustrationDoc = () => shell.doc('illustration') as DocController<IllustrationDoc>;
const patternDoc = () => shell.doc('pattern') as DocController<PatternDoc>;
const ditherDoc = () => shell.doc('dither') as DocController<DitherDoc>;
/** one of Dither's looks by id, over `d` */
const withLookId = (d: DitherDoc, id: string) => withLook(d, ditherLook(id)!);
const addSwatch = (doc: DocController<DesignDoc>, name: string) =>
  doc.transact('Add swatch', (d) => ({ ...d, swatches: [...d.swatches, designSwatch([0.6, 0.12, 40], name)] }));
/** a key as the keyboard sends it (to the focused element), so it goes through the keymap's routing (spec §8) */
const press = (key: string, o: KeyboardEventInit = {}) =>
  (document.activeElement ?? document.body).dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...o }));
const ctrlZ = () => press('z', { code: 'KeyZ', ctrlKey: true });
const ctrlY = () => press('y', { code: 'KeyY', ctrlKey: true });
const host = (id: ToolId) => document.querySelector<HTMLElement>(`[data-tool="${id}"]`);
const shows = (el: Element | null | undefined) => !!el && el.getClientRects().length > 0;
/** a tool's showing button whose text ends with `text` (an icon's name comes first) */
const button = (id: ToolId, text: string) => [...(host(id)?.querySelectorAll('button') ?? [])].find((b) => b.textContent?.trim().endsWith(text) && shows(b));
/** the Check list that shows: its open row, its first row that fails ('' when none does), and its first row */
function openCheck(id: ToolId): { open: string; bad: string; first: string } | null {
  const list = [...(host(id)?.querySelectorAll('[role="tablist"][aria-orientation="vertical"]') ?? [])].find(shows);
  const rows = [...(list?.querySelectorAll<HTMLElement>('[role="tab"]') ?? [])];
  if (!rows.length) return null;
  const label = (r?: HTMLElement) => r?.children[1]?.textContent ?? '';
  return { open: label(rows.find((r) => r.ariaSelected === 'true')), bad: label(rows.find((r) => r.firstElementChild?.textContent === 'error')), first: label(rows[0]) };
}
/** a textarea's text as typing leaves it (React hears the input event) */
function type(el: HTMLTextAreaElement, text: string): void {
  Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!.call(el, text);
  el.dispatchEvent(new Event('input', { bubbles: true }));
}
/** the size of the image Dither holds now, read from its file */
async function imageSize(dt: DocController<DitherDoc>): Promise<[number, number] | null> {
  const url = dt.get().source?.assets[0];
  if (!url) return null;
  const bmp = await decodeImage(await (await fetch(url)).blob());
  const size: [number, number] = [bmp.width, bmp.height];
  bmp.close();
  return size;
}

export async function runSmoke(run: 'full' | 'quiet'): Promise<void> {
  const errors = new Map<string, string>();
  const offToasts = toastStore.subscribe(() => {
    for (const t of toastStore.get()) if (t.kind === 'error') errors.set(t.id, String(t.message));
  });
  try {
    if (check('the shell starts', await until(() => shell.getState().ready, 30_000))) await (run === 'full' ? full() : quiet());
  } catch (e) {
    check('the pass runs to the end', false, e instanceof Error ? (e.stack ?? e.message) : String(e));
  }
  offToasts();
  const s = shell.getState();
  check('no tool crashed', !Object.keys(s.crashed).length, s.crashed);
  check('no error toasts', !errors.size, [...errors.values()]);
  check('no status-bar warning', s.statusWarning === null, s.statusWarning);
  const head = `${run} pass: ${report.length - failures} of ${report.length} checks passed`;
  await api.invoke('app.smokeDone', failures === 0, [head, ...report].join('\n'));
}


async function full(): Promise<void> {
  const info = await api.invoke('app.info');
  check('userData ends in "Design Tools"', /[\\/]Design Tools$/.test(info.userData), info.userData);
  const dir = info.userData.replace(/[\\/]Design Tools$/, '');

  const ids = shell.getState().tools.map((t) => t.id);
  check('Design, Illustration, Pattern, Logo, Dither, Halftone and Post FX are registered, and nothing else', JSON.stringify(ids) === JSON.stringify(['design', 'illustration', 'pattern', 'logo', 'dither', 'halftone', 'postfx']), ids);
  const rail = shell.getState().tools.map((t) => `${t.group}:${t.shortcut}`);
  check('the rail runs Colour 1-2, Make 3-4, Image 5-7, and Ctrl+1 to 7 match', JSON.stringify(rail) === JSON.stringify(['colour:1', 'colour:2', 'make:3', 'make:4', 'image:5', 'image:6', 'image:7']), rail);
  const keyed: string[] = [];
  for (const [n, id] of ids.entries()) {
    press(String(n + 1), { code: `Digit${n + 1}`, ctrlKey: true });
    if (shell.getState().active !== id) keyed.push(`${n + 1} shows ${shell.getState().active}`);
  }
  check('Ctrl+1 to 7 show the tools in rail order', !keyed.length, keyed);
  for (const id of ids) {
    shell.setActive(id);
    await sleep(50);
  }
  const drawn = await until(() => ids.every((id) => document.querySelector(`[data-tool="${id}"]`)?.hasChildNodes()));
  check('every registered tool opens', drawn && ids.every((id) => shell.getState().mounted.includes(id)), shell.getState().mounted);

  // saving: first commit, next commit, undo
  const dp = designDoc();
  shell.setActive('design');
  check('Design starts new', dp.state().t === 'new' && dp.depth() === 0, dp.state());
  check('an empty Design palette opens on Build', (await until(() => button('design', 'Generate'))) && designView().tab === 'build', designView().tab);
  addSwatch(dp, 'Smoke 1');
  const first = await until(() => (dp.state().t === 'saved' ? dp.source() : null));
  if (!check('the first commit creates a palette in Scratch', first?.collection === 'Scratch', first ?? dp.state())) return;
  const id = first!.itemId;
  check('its file holds the swatch', (await swatchCount(id)) === 1);
  const stamp1 = await stat(id);
  addSwatch(dp, 'Smoke 2');
  check('the next commit rewrites the file', await until(async () => (await swatchCount(id)) === 2));
  const stamp2 = await stat(id);
  check('the file changed on disk', stamp1 && stamp2 && (stamp1.mtimeMs !== stamp2.mtimeMs || stamp1.size !== stamp2.size), [stamp1, stamp2]);
  ctrlZ();
  check('Ctrl+Z undoes the commit and writes the file', await until(async () => dp.get().swatches.length === 1 && (await swatchCount(id)) === 1));

  // import (main copied test/fixtures beside userData)
  const fx = `${dir}\\fixtures\\`;
  await shell.importFiles([`${fx}chalk_palette.ase`, `${fx}four-colours.png`], 'Brand');
  const palette = await find((i) => i.collection === 'Brand' && i.kind === 'palette');
  const image = await find((i) => i.collection === 'Brand' && i.kind === 'image');
  check('the .ase imports as a palette', palette && (await swatchCount(palette.id)) > 0, palette);
  if (!check('the PNG imports as an image', image) || !palette || !image) return;

  // Send to between tools: a dither needs two colours, so the palette gets a second
  const dt = ditherDoc();
  dp.transact('Add swatch', (d) => ({ ...d, swatches: [...d.swatches, designSwatch([0.3, 0.08, 250], 'Smoke dark')] }));
  await shell.sendDoc('design', 'dither');
  const got = dt.get().palette;
  check('Send to: Design gives Dither its palette as one step', got.name === first!.name && got.colours.length === 2 && dt.get().paletteSource.kind === 'library' && dt.depth() === 1, got);
  const sent = toastStore.get().findLast((t) => t.icon === 'input');
  check('its toast has Undo and says nothing about Ctrl+Z', sent?.undo && !/Ctrl/.test(String(sent.message)), sent?.message);
  check('Ctrl+Z goes to that toast while Dither shows', toast.activeCtrlZ()?.id === sent?.id);
  shell.setActive('design');
  check('and not once another tool shows', toast.activeCtrlZ()?.id !== sent?.id);
  shell.setActive('dither');
  const undoLabel = () => host('dither')?.querySelector('[aria-label^="Undo: "]')?.getAttribute('aria-label');
  check("the undo button's tooltip names the step", await until(() => undoLabel() === `Undo: Palette from ${first!.name}`, 2000), undoLabel());
  await shell.sendItem(image, 'dither');
  check('Send to: the image opens in Dither', dt.get().source?.name === image.name, dt.get().source);
  const il = illustrationDoc();
  const plain = il.get();
  clearBases();
  await shell.sendDoc('dither', 'illustration');
  const render = await find((i) => i.collection === 'Scratch' && i.kind === 'image');
  check('Send to: Dither renders into Scratch and Illustration offers its colours as bases', render && shell.getState().active === 'illustration' && (bases.get()?.items.length ?? 0) > 0, bases.get()?.items.length);
  check('and leaves the Illustration document alone', il.get() === plain && il.depth() === 0, il.depth());
  clearBases();

  // one palette in two tools
  const owner = () => shell.getState().owners[palette.id];
  await shell.sendItem(palette, 'design');
  check("Open: the palette becomes Design's document", dp.source()?.itemId === palette.id && owner() === 'design', dp.source());
  await shell.sendItem(palette, 'illustration');
  const lost = dp.state();
  check('opening it in Illustration moves ownership there', owner() === 'illustration' && lost.t === 'owned-elsewhere' && lost.by === 'illustration' && il.state().t === 'saved', [owner(), lost, il.state()]);
  check('Illustration opens a flat palette as loose colours, changing nothing', il.get().ramps.length === 0 && il.get().swatches.length === (await swatchCount(palette.id)), il.get().ramps.length);
  await shell.takeBack('design');
  const back = il.state();
  check('Take back moves it back', owner() === 'design' && dp.state().t === 'saved' && back.t === 'owned-elsewhere' && back.by === 'design', [owner(), dp.state(), back]);

  // lock and fork
  const before = await stat(palette.id);
  await shell.setCollectionLocked('Brand', true);
  check('locking Brand shows LOCKED', dp.state().t === 'locked', dp.state());
  addSwatch(dp, 'Smoke fork');
  const fork = await until(() => {
    const s = dp.source();
    return s && s.itemId !== palette.id && dp.state().t === 'saved' ? s : null;
  });
  check('an edit to a locked palette forks a copy into Scratch', fork?.collection === 'Scratch', fork ?? dp.state());
  const after = await stat(palette.id);
  check('the locked file is untouched', before && after && before.mtimeMs === after.mtimeMs && before.size === after.size, [before, after]);
  await shell.setCollectionLocked('Brand', false);

  // move, and Ctrl+Z on its toast
  const at = (collection: string) => () => find((i) => i.kind === 'image' && i.name === image.name && i.collection === collection);
  await shell.createCollection('Moved');
  await shell.moveItem(image, 'Moved');
  check('Move puts the image in Moved', await until(at('Moved')));
  ctrlZ();
  check('Ctrl+Z moves it back', await until(at('Brand')));

  // delete, Ctrl+Z, delete again, then the toast closes
  const untitled = await find((i) => i.id === id);
  if (!check('the first palette is still listed', untitled)) return;
  await shell.deleteItem(untitled!);
  check('Delete hides it from the Library', !(await find((i) => i.id === id)));
  ctrlZ();
  check('Ctrl+Z brings it back', await until(() => find((i) => i.id === id)));
  await shell.deleteItem(untitled!);
  const live = toast.activeCtrlZ();
  if (live) toast.dismiss(live.id); // as its timeout would
  check('closing its Undo toast sends the file to the trash', live && (await until(async () => (await stat(id)) === null)));
  // left pending: the quit trashes it (scripts/smoke.mjs finds it in <smoke folder>/trash)
  if (render) await shell.deleteItem(render);
  check('a delete waits on its Undo toast until the quit', render && !(await find((i) => i.id === render.id)) && (await stat(render.id)) !== null);

  // export, through renderer/lib/export (spec §10.4)
  const exports = `${dir}\\exports\\`;
  const out = await shell.tool('dither').render!(dt.get(), {});
  const bytes = await out.blob.arrayBuffer();
  const saved = await saveFile({ tool: 'dither', suggestedName: 'smoke export', ext: 'png', filterName: 'PNG image', data: bytes });
  check('export.save writes into the smoke exports folder', saved?.startsWith(exports), saved);
  const files = [{ name: 'one.txt', data: 'one' }, { name: 'two.txt', data: 'two' }];
  const folder = await saveToFolder({ tool: 'design', files });
  check('export.toFolder writes every file there', folder?.written.length === 2 && folder.written.every((p) => p.startsWith(exports)), folder);

  await asImage(dt);
  await fieldUndo(dp);
  const open = dp.source();
  if (check('Design still has its fork open', open && dp.state().t === 'saved', dp.state())) await outsideChange(dp, open!.itemId);
  await design(dir, image, dt);
  await pattern(dir, palette, dt);
  await logo(dir);
  await halftone(dir, dt);
  await dither(dir);
  await postfx(dir);
  await illustration();

  // left running, so the quit meets "Quit anyway?" (answered from --smoke-answer, no dialog) and the
  // pending delete is trashed after it (scripts/smoke.mjs checks both)
  void shell.runBusy(() => new Promise(() => {}));
}

/** spec §7.4 "as an image": an SVG at 4096 on its long side, a pattern tiled over a 4096 square */
async function asImage(dt: DocController<DitherDoc>): Promise<void> {
  const svg = new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 100"><rect width="200" height="100"/></svg>');
  const mark = await api.invoke('library.createImage', 'Scratch', 'Smoke mark', 'svg', svg.buffer);
  await shell.sendItem(mark, 'dither');
  check('an SVG comes into Dither at 4096 on its long side', JSON.stringify(await imageSize(dt)) === '[4096,2048]', await imageSize(dt));
  const tile = '<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64"><circle cx="32" cy="32" r="20"/></svg>';
  const pattern: PatternPayload = { kind: 'pattern', id: '', version: 1, preview: { svg: tile, tileWidth: 64, tileHeight: 64 } };
  const { ref } = await api.invoke('library.create', 'Scratch', 'Smoke tile', pattern);
  await shell.sendItem(ref, 'dither');
  check('a pattern comes in as a 4096 square of its tile', JSON.stringify(await imageSize(dt)) === '[4096,4096]', await imageSize(dt));
}

/** spec §8 step 1: a text field holding an unsaved edit keeps Ctrl+Z; the tool's history is untouched */
async function fieldUndo(dp: DocController<DesignDoc>): Promise<void> {
  shell.setActive('design');
  const w = dp.get().swatches[0];
  selectInDesign([w.id]);
  const field = await until(() => [...(host('design')?.querySelectorAll<HTMLInputElement>('input[type="text"]') ?? [])].find((i) => i.value === w.name));
  if (!check('Design shows the swatch name field', field)) return;
  const depth = dp.depth();
  const before = JSON.stringify(dp.get());
  field!.focus();
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(field, 'Typed, not entered');
  field!.dispatchEvent(new Event('input', { bubbles: true }));
  const dirty = await until(() => field!.dataset.dirty === 'true', 2000);
  ctrlZ();
  check('Ctrl+Z in a field with an unsaved edit leaves the tool alone', dirty && dp.depth() === depth && JSON.stringify(dp.get()) === before, [dirty, dp.depth(), depth]);
  press('Escape'); // the field reverts; nothing is committed
  field!.blur();
  check('Esc reverts the field without a step', dp.depth() === depth && JSON.stringify(dp.get()) === before, dp.depth());
}

/** spec §7.3: the file changed outside the app, then Reload from disk; Ctrl+Z brings mine back and writes it */
async function outsideChange(dp: DocController<DesignDoc>, id: string): Promise<void> {
  const mine = dp.get().swatches.length;
  // written behind the app's back: the service takes it as its own write, so nothing is told
  const theirs = { kind: 'palette' as const, id, version: 1 as const, notes: 'from elsewhere', swatches: dp.get().swatches.slice(0, 1) };
  await api.invoke('library.write', id, theirs, null);
  addSwatch(dp, 'Smoke mine');
  check('an edit over an outside change reads CHANGED ON DISK and writes nothing', await until(() => dp.state().t === 'changed-outside') && (await swatchCount(id)) === 1, dp.state());
  await shell.reloadFromDisk('design');
  check('Reload from disk takes the file', dp.state().t === 'saved' && dp.get().swatches.length === 1 && dp.get().notes === 'from elsewhere', [dp.state(), dp.get().swatches.length]);
  ctrlZ();
  check('Ctrl+Z brings mine back and writes it', await until(async () => dp.get().swatches.length === mine + 1 && (await swatchCount(id)) === mine + 1), [dp.get().swatches.length, mine]);
}

/** Colour › Design: open, edit, a contrast fix, Export ASE read back, Send to from Dither (plan: Integrate) */
async function design(dir: string, image: LibraryItemRef, dt: DocController<DitherDoc>): Promise<void> {
  const dd = shell.doc('design') as DocController<DesignDoc>;
  const fx = `${dir}\\fixtures\\`;
  await shell.importFiles([`${fx}glossy-pastic_palette.ase`], 'Design');
  const palette = await find((i) => i.collection === 'Design' && i.kind === 'palette');
  if (!check('a second .ase imports for Design', palette)) return;
  shell.setActive('design');
  await shell.openItem(palette!); // as a double-click: the active tool takes it
  check('Open: the palette becomes Design’s document', dd.source()?.itemId === palette!.id && shell.getState().owners[palette!.id] === 'design' && dd.state().t === 'saved', [dd.source(), dd.state()]);
  const n = dd.get().swatches.length;

  const ground = designSwatch([0.97, 0.01, 90], 'Smoke ground', 'Background');
  const text = designSwatch([0.66, 0.1, 30], 'Smoke text', 'Text');
  dd.transact('Add swatches', (d) => ({ ...d, swatches: [...d.swatches, ground, text] }));
  check('an edit in Design writes the file', await until(async () => (await swatchCount(palette!.id)) === n + 2), n);

  // a visit to Check with no check chosen opens on the first that fails (Smoke text on Smoke ground)
  patchDesign({ tab: 'check', check: null });
  const opened = await until(() => (openCheck('design')?.first === 'Contrast' ? openCheck('design') : null));
  check('Check opens on the first failing check', opened?.bad === 'Contrast' && opened.open === opened.bad, opened);
  patchDesign({ check: 'contrast' });

  const inDesign = (id: string) => dd.get().swatches.find((w) => w.id === id);
  const fixButton = await until(() =>
    [...(host('design')?.querySelectorAll('button') ?? [])].find((b) => /^(Lift|Darken) to L/.test(b.textContent ?? '') && b.parentElement?.parentElement?.textContent?.includes('Smoke text on Smoke ground')),
  );
  if (!check('the contrast check offers a fix for Smoke text on Smoke ground', fixButton)) return;
  const before = dd.get();
  const depth = dd.depth();
  fixButton!.click();
  const fixed = inDesign(text.id)!.oklch;
  check('a contrast fix is one undo step and reaches 4.5:1', dd.depth() === depth + 1 && contrast(fixed, ground.oklch) >= 4.5 && fixed[2] === text.oklch[2], [dd.depth(), depth, contrast(fixed, ground.oklch)]);
  ctrlZ();
  check('Ctrl+Z takes the fix back', dd.get() === before, dd.undoLabel());
  ctrlY();
  check('Ctrl+Y redoes it and writes it', await until(async () => {
    const item = await api.invoke('library.read', palette!.id).catch(() => null);
    const w = item?.kind === 'palette' ? item.payload.swatches.find((x) => x.id === text.id) : null;
    return w && JSON.stringify(w.oklch) === JSON.stringify(fixed);
  }));

  // Export ASE through the doc bar's Export popover, then import the file back through the Library's reader
  patchDesign({ format: 'ase' });
  button('design', 'Export')?.click();
  const popover = () => document.querySelector<HTMLElement>('[role="dialog"][aria-label="Export"]');
  const exportAse = await until(() => [...(popover()?.querySelectorAll('button') ?? [])].find((b) => b.textContent?.trim().endsWith('Export ASE')));
  if (!check('the doc bar’s Export opens its popover, holding Export ASE', exportAse)) return;
  const shown = toastStore.get().length;
  exportAse!.click();
  const done = await until(() => toastStore.get().slice(shown).find((t) => t.icon === 'download'));
  const file = /^Exported (.+)\.$/.exec(String(done?.message ?? ''))?.[1];
  if (!check('Export ASE writes a file, and the popover closes', file && (await until(() => !popover())), done?.message)) return;
  await shell.importFiles([`${dir}\\exports\\${file}`], 'Reimport');
  const back = await find((i) => i.collection === 'Reimport' && i.kind === 'palette');
  const read = back && (await api.invoke('library.read', back.id));
  const got: Swatch[] = read?.kind === 'palette' ? read.payload.swatches : [];
  const want = dd.get().swatches;
  const same = got.length === want.length && want.every((w, i) => toHex(w.oklch) === toHex(got[i].oklch) && got[i].type === w.type && (!w.name || got[i].name === w.name));
  check('its read-back matches the palette (names, colours, global and spot)', same, got.map((w) => [w.name, w.type]));

  // the Krita format is another row of the same popover (the Library reads no .kpl, so only the write is checked)
  patchDesign({ format: 'kpl' });
  button('design', 'Export')?.click();
  const exportKpl = await until(() => [...(popover()?.querySelectorAll('button') ?? [])].find((b) => b.textContent?.trim().endsWith('Export Krita')));
  if (check('the Export popover offers Export Krita', exportKpl)) {
    const shownKpl = toastStore.get().length;
    exportKpl!.click();
    const savedKpl = await until(() => toastStore.get().slice(shownKpl).find((t) => t.icon === 'download'));
    check('Export Krita writes a .kpl file', /^Exported .+\.kpl\.$/.test(String(savedKpl?.message ?? '')) && (await until(() => !popover())), savedKpl?.message);
  }
  patchDesign({ format: 'ase' });

  // each tab keeps its state when switched: Build's half-typed paste is still there after Check and Preview
  patchDesign({ tab: 'build', build: 'paste' });
  const box = await until(() => host('design')?.querySelector<HTMLTextAreaElement>('textarea[aria-label="Colours to parse"]'));
  if (box) type(box, 'Half typed');
  for (const tab of ['check', 'preview', 'build'] as const) {
    patchDesign({ tab });
    await sleep(50);
  }
  const typed = host('design')?.querySelector<HTMLTextAreaElement>('textarea[aria-label="Colours to parse"]');
  check('a tab switch keeps each tab’s state: Build’s typed paste outlasts Check and Preview', box && typed === box && shows(box) && box.value === 'Half typed', typed?.value);
  if (box) type(box, '');
  patchDesign({ build: 'generate' });

  // ≈CMYK's four fields fit their values (100 on a black) at the inspector's narrowest
  const black = designSwatch([0, 0, 0], 'Smoke black');
  dd.transact('Add black', (d) => ({ ...d, swatches: [...d.swatches, black] }));
  selectInDesign([black.id]);
  patchDesign({ inspector: 340 });
  await shell.setPicker({ pickerStyle: 'square', pickerModel: 'cmyk' });
  const inputs = () => [...(host('design')?.querySelectorAll<HTMLInputElement>('aside[aria-label="Inspector"] input') ?? [])].filter(shows);
  const cut = await until(() => (inputs().filter((i) => i.value === '100').length === 1 ? inputs().filter((i) => i.scrollWidth > i.clientWidth).map((i) => i.value) : null));
  check('≈CMYK’s fields fit 100% at the inspector’s narrowest', cut && cut.length === 0, cut ?? inputs().map((i) => i.value));
  patchDesign({ inspector: 380 });
  ctrlZ();
  check('and Ctrl+Z takes the black back out', !dd.get().swatches.some((w) => w.id === black.id));

  // the picker style is one app-wide setting: the inspector header's switch is saved (the relaunch pass looks)
  const wheel = host('design')?.querySelector<HTMLElement>('[role="radio"][aria-label="Wheel"]');
  wheel?.click();
  await shell.setPicker({ pickerModel: 'rgb' });
  const prefs = await api.invoke('settings.get');
  check('the inspector’s Wheel switch draws the wheel and saves it, as the model is saved', wheel && (await until(() => host('design')?.querySelector('[data-picker="wheel"]'))) && prefs.pickerStyle === 'wheel' && prefs.pickerModel === 'rgb', [prefs.pickerStyle, prefs.pickerModel]);

  // New palette: one step to an empty, unlinked document that opens on Build; each first edit makes
  // its own Scratch palette (never writes over the last one); Undo goes back to the palette that was open
  const held = dd.source();
  patchDesign({ tab: 'preview' });
  const newWithSwatch = async (name: string) => {
    await shell.newDoc('design');
    const fresh = dd.get().swatches.length === 0 && !dd.source() && dd.undoLabel() === 'New palette' && !!(await until(() => designView().tab === 'build' && button('design', 'Generate')));
    dd.transact('Add swatch', (d) => ({ ...d, swatches: [designSwatch([0.5, 0.1, 200], name)] }));
    const made = await until(() => dd.state().t === 'saved' && dd.source()?.collection === 'Scratch' && dd.source());
    return { fresh, id: made ? made.itemId : null };
  };
  const first = await newWithSwatch('Smoke new 1');
  const second = await newWithSwatch('Smoke new 2');
  check('New palette: an empty, unlinked document in one step, open on Build', first.fresh && second.fresh);
  check('each New palette’s first edit makes its own Scratch item', first.id && second.id && first.id !== second.id && first.id !== held?.itemId && (await swatchCount(first.id)) === 1, [first.id, second.id]);
  for (let i = 0; i < 4; i++) ctrlZ();
  check('Undo goes back to the palette that was open', await until(() => dd.source()?.itemId === held?.itemId && dd.state().t === 'saved'), dd.source());

  // Send to Design from Dither: the dithered colours as proposals, the document untouched (the CGA
  // look, so four colours show)
  await shell.sendItem(image, 'dither');
  dt.transact('Use the CGA look', (d) => withLookId(d, 'cga'));
  clearProposals();
  const doc = dd.get();
  const steps = dd.depth();
  await shell.sendDoc('dither', 'design');
  const ghosts = proposals.get();
  check('Send to Design from Dither proposes its colours', shell.getState().active === 'design' && (ghosts?.items.length ?? 0) >= 2, ghosts?.items.length);
  check('and leaves the document and its history alone', dd.get() === doc && dd.depth() === steps && dt.depth() > 0, [dd.depth(), steps]);
  const sent = toastStore.get().findLast((t) => t.icon === 'input');
  check('its toast offers no Undo (there is no step)', sent && !sent.undo, sent?.message);
  clearProposals();
}

/** a tool's Export button in the row named `row`, then the file it wrote, read back through the Library (import copies it in) */
async function toolExport(dir: string, tool: ToolId, collection: string): Promise<(row: string) => Promise<Response | null>> {
  await shell.createCollection(collection);
  return async (row) => {
    const button = await until(() => [...(host(tool)?.querySelectorAll('button') ?? [])].find((b) => b.textContent?.trim().endsWith('Export') && !b.disabled && b.parentElement?.querySelector('b')?.textContent === row));
    if (!button) return null;
    const shown = toastStore.get().length;
    button.click();
    const done = await until(() => toastStore.get().slice(shown).find((t) => t.icon === 'download'));
    const file = /^Exported (.+)\.$/.exec(String(done?.message ?? ''))?.[1];
    if (!file) return null;
    await shell.importFiles([`${dir}\\exports\\${file}`], collection);
    const ref = await until(() => find((i) => i.collection === collection && `${i.name}.${i.ext}` === file));
    const item = ref && (await api.invoke('library.read', ref.id));
    return item && 'url' in item ? fetch(item.url) : null;
  };
}

/** a PNG's pixel size and its pHYs resolution in dpi (null without one) */
function pngInfo(bytes: Uint8Array): { w: number; h: number; dpi: number | null } {
  const v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let dpi: number | null = null;
  for (let at = 8; at + 12 <= bytes.length; at += 12 + v.getUint32(at)) {
    if (String.fromCharCode(...bytes.subarray(at + 4, at + 8)) === 'pHYs' && bytes[at + 16] === 1) dpi = v.getUint32(at + 8) * 0.0254;
  }
  return { w: v.getUint32(16), h: v.getUint32(20), dpi };
}

/**
 * Make › Pattern (plan: Then): the first edit saves the pattern with its preview, a Library SVG and
 * a palette come in, the Illustrator swatch repeats exactly, the artboard is in mm, the PNG carries
 * its DPI, Surprise me leaves shapes and colours alone, and Dither takes the pattern as an image.
 */
async function pattern(dir: string, palette: LibraryItemRef, dt: DocController<DitherDoc>): Promise<void> {
  const pd = patternDoc();
  const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
  shell.setActive('pattern');
  check('Pattern starts new, one shape on screen', pd.state().t === 'new' && pd.depth() === 0 && pd.get().slots.length === 1, pd.state());
  // a layout whose shapes run over the tile's edges: odd half-drop columns, overlap, jitter, turns
  pd.transact('Smoke layout', (d) => ({ ...d, arrangement: 'halfdrop', cols: 3, rows: 2, gapX: -6, gapY: 10, jitter: 18, rotation: { ...d.rotation, mode: 'random', min: -40, max: 40 } }));
  const made = await until(() => (pd.state().t === 'saved' ? pd.source() : null));
  if (!check('the first Pattern edit makes a pattern in Scratch', made?.collection === 'Scratch', made ?? pd.state())) return;
  const id = made!.itemId;
  const read = async () => {
    const item = await api.invoke('library.read', id).catch(() => null);
    return item?.kind === 'pattern' ? item.payload : null;
  };
  const preview = toPayload(pd.get()).preview;
  const file = await until(read);
  check('its file holds the settings and a preview tile', file?.arrangement === 'halfdrop' && file.preview.svg.includes('<svg') && file.preview.tileWidth > 0 && same(file.preview, preview), file?.preview.tileWidth);

  // a Library SVG with its own ids comes in as a shape: namespaced, measured by its artwork
  const stop = (at: number, c: Oklch) => `<stop offset="${at}" stop-color="${toHex(c)}"/>`;
  const art = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 120 80"><defs><linearGradient id="g">${stop(0, [0.6, 0.2, 25])}${stop(1, [0.5, 0.2, 265])}</linearGradient></defs><rect x="10" y="20" width="100" height="40" fill="url(#g)"/></svg>`;
  const mark = await api.invoke('library.createImage', 'Scratch', 'Smoke shape', 'svg', new TextEncoder().encode(art).buffer);
  const depth = pd.depth();
  await shell.sendItem(mark, 'pattern');
  const shape = pd.get().slots.at(-1)!;
  const b = shape.bounds;
  const near = (v: number, w: number) => Math.abs(v - w) < 0.5;
  check(
    'an SVG sent from the Library becomes a shape in one step, its ids its own, measured by its artwork',
    pd.get().slots.length === 2 && shape.name === 'Smoke shape' && !shape.recolour && !/id="g"/.test(shape.svg) && /url\(#s\w+-g\)/.test(shape.svg) && near(b.x, 10) && near(b.y, 20) && near(b.w, 100) && near(b.h, 40) && pd.depth() === depth + 1,
    [shape.name, b, pd.depth() - depth],
  );
  check('and the file holds it', await until(async () => ((await read())?.slots as unknown[] | undefined)?.length === 2));

  // a palette: its colours go to the shape that takes palette colours; the SVG keeps its own
  const swatches = await api.invoke('library.read', palette.id).then((i) => (i.kind === 'palette' ? i.payload.swatches : []));
  await shell.sendItem(palette, 'pattern');
  const pc = pd.get();
  check(
    'a palette sent to Pattern becomes its shape colours, the SVG shape keeping its own',
    pc.palette.length > 0 && pc.palette.every((c) => swatches.some((w) => same(w.oklch, c))) && pc.slots[0].recolour && !pc.slots[1].recolour && pd.depth() === depth + 2,
    [pc.palette.length, pd.undoLabel()],
  );

  // the Illustrator swatch, read back from its file: every shape over an edge is on the far side too
  const exported = await toolExport(dir, 'pattern', 'Pattern out');
  const swatch = await exported('Illustrator swatch');
  const svg = swatch && new DOMParser().parseFromString(await swatch.text(), 'image/svg+xml').documentElement;
  if (!check('Export writes the Illustrator swatch', svg?.nodeName === 'svg')) return;
  const d = pd.get();
  const tile = layoutTile(d);
  const reach = reachOf(d.slots);
  const uses = [...svg!.querySelectorAll('use')].flatMap((u) => {
    const m = /translate\(([-\d.e]+) ([-\d.e]+)\)/.exec(u.getAttribute('transform') ?? '');
    return m ? [[+m[1], +m[2]]] : [];
  });
  const at = (x: number, y: number) => uses.some(([ux, uy]) => Math.abs(ux - x) < 0.01 && Math.abs(uy - y) < 0.01);
  let crossing = 0;
  let missing = 0;
  for (const it of tile.items) {
    const r = reach(it);
    if (it.x - r < 0 || it.x + r > tile.width || it.y - r < 0 || it.y + r > tile.height) crossing++;
    for (const i of [-1, 0, 1]) {
      for (const j of [-1, 0, 1]) {
        const [x, y] = [it.x + i * tile.width, it.y + j * tile.height];
        if (x + r > 0 && x - r < tile.width && y + r > 0 && y - r < tile.height && !at(x, y)) missing++;
      }
    }
  }
  const edge = svg!.querySelector(':scope > rect');
  const box = `0 0 ${+tile.width.toFixed(3)} ${+tile.height.toFixed(3)}`;
  check(
    'the swatch repeats exactly: its tile is the layout’s, and every shape over an edge comes back on the opposite one',
    crossing > 0 && !missing && svg!.getAttribute('viewBox') === box && edge?.getAttribute('fill') === 'none' && edge.getAttribute('stroke') === 'none',
    { crossing, missing, viewBox: svg!.getAttribute('viewBox'), box },
  );

  // the artboard in mm: its size on paper, one clip at its edge
  pd.transact('Export in mm', (x) => withUnit(x, 'mm'));
  pd.transact('Change the artboard', (x) => ({ ...x, artboard: { w: 210 * PX_PER.mm, h: 297 * PX_PER.mm } }));
  await until(() => host('pattern')?.querySelector('input[value="210.0"]'));
  const board = await exported('Artboard SVG');
  const boardSvg = board && new DOMParser().parseFromString(await board.text(), 'image/svg+xml').documentElement;
  check('the artboard SVG is written in mm, clipped once at its edge', boardSvg?.getAttribute('width') === '210mm' && boardSvg.getAttribute('height') === '297mm' && boardSvg.querySelectorAll('clipPath').length === 1, boardSvg?.getAttribute('width'));

  // one tile as a PNG at 300 dpi: that many pixels, and the DPI written into the file
  patchPattern({ png: 'tile' });
  pd.transact('Change the DPI', (x) => ({ ...x, dpi: 300 }));
  const px = [Math.round((tile.width * 300) / 96), Math.round((tile.height * 300) / 96)];
  await until(() => host('pattern')?.textContent?.includes(`${px[0]} × ${px[1]} px`));
  const png = await exported('PNG');
  const info = png && pngInfo(new Uint8Array(await png.arrayBuffer()));
  check('the PNG carries its DPI in a pHYs chunk and is that many pixels', info && Math.round(info.dpi ?? 0) === 300 && info.w === px[0] && info.h === px[1], [info, px]);

  // Surprise me: a new layout, the shapes and colours as they were
  const before = pd.get();
  const steps = pd.depth();
  const kept = (x: PatternDoc) => JSON.stringify([x.slots, x.palette, x.background, x.paletteMode]);
  const layout = (x: PatternDoc) => JSON.stringify([x.arrangement, x.cols, x.rows, x.gapX, x.gapY, x.sizeMin, x.sizeMax, x.rotation, x.jitter, x.seed]);
  [...(host('pattern')?.querySelectorAll('button') ?? [])].find((x) => x.textContent?.trim().endsWith('Surprise me'))?.click();
  const after = pd.get();
  check('Surprise me changes the layout in one step and leaves the shapes and colours alone', pd.depth() === steps + 1 && pd.undoLabel() === 'Surprise me' && kept(after) === kept(before) && layout(after) !== layout(before), [pd.depth() - steps, pd.undoLabel()]);
  check('and writes the file', await until(async () => (await read())?.seed === after.seed));

  // Send to: Dither takes the pattern as a 4096 square of its tile; over a background, not one clear pixel at a seam
  const name = (await find((i) => i.id === id))?.name;
  await shell.sendDoc('pattern', 'dither');
  const url = dt.get().source?.assets[0];
  const bmp = url ? await decodeImage(await (await fetch(url)).blob()) : null;
  let clear = -1;
  if (bmp) {
    const c = new OffscreenCanvas(bmp.width, bmp.height).getContext('2d')!;
    c.drawImage(bmp, 0, 0);
    const rgba = c.getImageData(0, 0, bmp.width, bmp.height).data;
    clear = 0;
    for (let i = 3; i < rgba.length; i += 4) if (rgba[i] < 255) clear++;
  }
  check(
    'Send to: Dither receives the pattern as an image, a 4096 square with no gap at the seams',
    shell.getState().active === 'dither' && dt.get().source?.name === name && bmp?.width === 4096 && bmp.height === 4096 && after.background && clear === 0,
    [dt.get().source?.name, name, bmp?.width, bmp?.height, clear],
  );
  bmp?.close();
}

// Logo parts, neutral and synthetic (the repo is public): a ring-and-diamond icon, the same icon as
// an Illustrator export on a padded artboard (Layer_1, .cls-1 rules), and a wordmark drawn as paths
// on its own padded artboard: caps 100 tall on a baseline at 100, one descender to 130.
const [NAVY, AMBER, INK] = ([[0.35, 0.07, 255], [0.77, 0.14, 70], [0.33, 0.07, 275]] as Oklch[]).map(toHex);
const RING = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 92 92"><circle cx="46" cy="46" r="46" fill="${NAVY}"/><rect x="27" y="27" width="38" height="38" fill="${AMBER}" transform="rotate(45 46 46)"/></svg>`;
const RING_PADDED = `<svg xmlns="http://www.w3.org/2000/svg" id="Layer_1" data-name="Layer 1" width="400px" height="300px" viewBox="0 0 400 300"><defs><style>.cls-1{fill:${NAVY};}.cls-2{fill:${AMBER};}</style></defs><circle class="cls-1" cx="190" cy="140" r="46"/><rect class="cls-2" x="171" y="121" width="38" height="38" transform="rotate(45 190 140)"/></svg>`;
const LUMP = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="-20 -30 324 190"><g fill="${INK}" fill-rule="evenodd"><path d="M0 0h14v86h46v14H0z"/><path d="M76 36h14v50h32V36h14v64H76z"/><path d="M152 36h60v64h-14V50h-9v50h-14V50h-9v50h-14z"/><path d="M228 36h56v50h-42v44h-14zM242 50v22h28V50z"/></g></svg>`;

/** an ICO's entries as [its directory size, the PNG's width, height]; null when it doesn't parse */
async function icoEntries(b: Uint8Array): Promise<number[][] | null> {
  const v = new DataView(b.buffer, b.byteOffset, b.byteLength);
  if (b.length < 6 || v.getUint16(0, true) !== 0 || v.getUint16(2, true) !== 1) return null;
  const out: number[][] = [];
  for (let i = 0; i < v.getUint16(4, true); i++) {
    const e = 6 + 16 * i;
    const [len, at] = [v.getUint32(e + 8, true), v.getUint32(e + 12, true)];
    if (at + len > b.length) return null;
    const bmp = await createImageBitmap(new Blob([b.slice(at, at + len)], { type: 'image/png' })).catch(() => null);
    if (!bmp) return null;
    out.push([b[e] || 256, bmp.width, bmp.height]);
    bmp.close();
  }
  return out;
}

/**
 * Make › Logo (plan: Then): parts come in from the Library, a padded artboard lays out as its
 * unpadded twin, the first edit saves the logo with its preview, the exports are real fills at their
 * stated sizes, the favicon ICO parses, and Pattern and Design take the logo. Leaves Logo linked to
 * its logo, so the quiet pass sees it come back as its file.
 */
async function logo(dir: string): Promise<void> {
  const ld = shell.doc('logo') as DocController<LogoDoc>;
  shell.setActive('logo');
  check('Logo starts new, with no parts', ld.state().t === 'new' && ld.depth() === 0 && noParts(ld.get()), ld.state());
  await shell.createCollection('Logo parts');
  const svg = (name: string, text: string) => api.invoke('library.createImage', 'Logo parts', name, 'svg', new TextEncoder().encode(text).buffer);
  const padded = await svg('Ring padded', RING_PADDED);
  const word = await svg('Lump', LUMP);
  const label = () => shell.tool('logo').accepts.svg?.label;
  check('an SVG goes into Logo as the icon first', label() === 'AS ICON', label());
  await shell.sendItem(padded, 'logo');
  const made = await until(() => (ld.state().t === 'saved' ? ld.source() : null));
  if (!check('the first Logo edit makes a logo in Scratch', made?.collection === 'Scratch', made ?? ld.state())) return;
  const file = await until(async () => {
    const item = await api.invoke('library.read', made!.itemId).catch(() => null);
    return item?.kind === 'logo' ? item.payload : null;
  });
  check('its file holds the icon and a preview that draws it', file?.icon?.includes('<circle') && /<circle/.test(file.preview.svg) && !/<image/.test(file.preview.svg), file?.preview.svg.slice(0, 160));
  check('the next SVG goes in as the wordmark', label() === 'AS WORDMARK', label());
  await shell.sendItem(word, 'logo');
  const d = ld.get();
  const t = d.wordmark?.type;
  check('the wordmark comes in with its cap height and baseline, found from its letters', t && Math.abs(t.capTop) < 1.5 && Math.abs(t.baseline - 100) < 1.5, t);
  const on = shownLockups(d).map((l) => l.kind);
  check('the pair proposes horizontal and stacked, the horizontal aligned on the capitals', on.includes('horizontal') && on.includes('stacked') && lockupOf(d, 'horizontal').align === 'cap', on);

  // the padded artboard and its tight twin: the same artwork (to the measure's resolution, a tenth
  // of a percent), the same layout, the same drawing to within antialiasing
  const tight = await partFromSvg(RING, 'Ring', 'icon');
  const twin = { ...d, icon: tight };
  const near = (a: number, b: number, e = 1e-3) => Math.abs(a - b) <= e;
  const same = (a?: Rect, b?: Rect) => (!a && !b) || (!!a && !!b && near(a.x, b.x) && near(a.y, b.y) && near(a.w, b.w) && near(a.h, b.h));
  const box = d.icon!.box;
  const e = tight.box.h * 1e-3;
  const measured = near(box.w, tight.box.w, e) && near(box.h, tight.box.h, e) && near(box.x - tight.box.x, 144, e) && near(box.y - tight.box.y, 94, e);
  const laid = d.lockups.every((l) => {
    const [a, b] = [layoutLockup(d, l), layoutLockup(twin, l)];
    return near(a.w, b.w) && near(a.h, b.h) && same(a.icon, b.icon) && same(a.wordmark, b.wordmark);
  });
  const pixels = async (x: LogoDoc) => {
    const out = lockupSvg(x, lockupOf(x, 'horizontal'), 'original', { padding: 'clearspace', height: 160 });
    const { width, height } = parseSize(out);
    const c = await drawSvg(out, Math.round(width), Math.round(height));
    return c.getContext('2d')!.getImageData(0, 0, c.width, c.height).data;
  };
  const [pa, pb] = await Promise.all([pixels(d), pixels(twin)]);
  // premultiplied, so a nearly clear edge pixel's colour doesn't count as a difference
  let off = pa.length === pb.length ? 0 : 255;
  for (let i = 0; i < pa.length && off < 255; i += 4)
    for (let c = 0; c < 4; c++) off = Math.max(off, Math.abs((c < 3 ? pa[i + c] * pa[i + 3] : 255 * pa[i + 3]) - (c < 3 ? pb[i + c] * pb[i + 3] : 255 * pb[i + 3])) / 255);
  check('a part on a padded artboard lays out as its unpadded twin, and draws the same to a sixteenth of a pixel', measured && laid && off <= 16, { box, tight: tight.box, laid, off });

  // stray art on the pasteboard, two artboards off, never paints into a lockup
  const amber = (px: Uint8ClampedArray) => {
    let n = 0;
    for (let i = 0; i < px.length; i += 4) if (px[i + 3] > 128 && px[i] > 170 && px[i + 2] < 120) n++;
    return n;
  };
  const stray = await partFromSvg(RING.replace('</svg>', `<rect x="200" y="0" width="92" height="92" fill="${AMBER}"/></svg>`), 'Stray', 'icon');
  const [clean, strayed] = [amber(await pixels(twin)), amber(await pixels({ ...d, icon: stray }))];
  check('art off the artboard is clipped, as the file shows on its own', (['x', 'y', 'w', 'h'] as const).every((k) => near(stray.box[k], tight.box[k], e)) && Math.abs(strayed - clean) <= clean * 0.02, { box: stray.box, clean, strayed });
  // an SVG that only wraps a picture is that picture: a PNG part, tinted flat
  const ring = await drawSvg(RING, 92, 92);
  const href = await new Promise<string>((ok) => {
    const r = new FileReader();
    r.onload = () => ok(r.result as string);
    void ring.convertToBlob({ type: 'image/png' }).then((b) => r.readAsDataURL(b));
  });
  const wrapped = await partFromSvg(`<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" viewBox="0 0 92 92"><image width="92" height="92" xlink:href="${href}"/></svg>`, 'Wrapped', 'icon');
  check('an SVG that only wraps a picture comes in as a PNG part, with a silhouette to tint', !wrapped.svg && !!wrapped.png && !!wrapped.silhouette, [!!wrapped.svg, wrapped.box]);
  // an opaque card inside a transparent border would tint to a block
  const card = new OffscreenCanvas(44, 34);
  const cc = card.getContext('2d')!;
  cc.fillStyle = NAVY;
  cc.fillRect(2, 2, 40, 30);
  const refused = await partFromImage(await card.convertToBlob({ type: 'image/png' }), 'Card', 'icon').then(() => null, (e: Error) => e.message);
  check('an opaque picture inside a transparent border is turned away', /no transparent background/.test(String(refused)), refused);
  // a logo made for dark grounds, a white name beside the mark: its brand sheet shows the original on dark
  const whiteName = await partFromSvg(LUMP.replace(`fill="${INK}"`, `fill="${toHex([1, 0, 0])}"`), 'White name', 'wordmark');
  const sheet = await sheetSvg({ ...d, wordmark: whiteName }, 'Dark ground');
  const tile = /<rect [^>]*width="240" height="150" fill="(#[0-9a-f]+)"/.exec(sheet)?.[1];
  check('the brand sheet puts a white-named logo’s original on the dark tile, judged by its edge', tile === PAPER.dark, tile);

  // the exports, read back from the files they wrote
  patchLogo({ mode: 'edit', lockup: 'horizontal', version: 'black', dpi: 300 });
  const row = (name: string) => [...(host('logo')?.querySelectorAll('b') ?? [])].find((b) => b.textContent === name);
  if (!check('Logo shows its Export module', await until(() => row('SVG') && row('Favicon bundle')))) return;
  const exported = await toolExport(dir, 'logo', 'Logo out');
  const vector = await (await exported('SVG'))?.text();
  check(
    'the exported lockup SVG is its parts as paths in black fills: no filter, no <image>, no colour left over',
    vector && /<circle/.test(vector) && /<path/.test(vector) && /fill="#000000"/.test(vector) && !/filter/.test(vector) && !/<image/.test(vector) && ![NAVY, AMBER, INK].some((c) => vector.toLowerCase().includes(c)),
    vector?.slice(0, 240),
  );
  const png = await exported('PNG');
  const info = png && pngInfo(new Uint8Array(await png.arrayBuffer()));
  const size = pngSize(ld.get(), layoutLockup(ld.get(), lockupOf(ld.get(), 'horizontal')));
  check('the PNG export is the set height with its DPI written in', info && info.w === size.w && info.h === size.h && Math.round(info.dpi ?? 0) === 300, [info, size]);

  const bundle = await faviconBundle(ld.get(), 'original', made!.name);
  const ico = bundle.find((f) => f.name === 'favicon.ico')?.data;
  const entries = ico instanceof ArrayBuffer ? await icoEntries(new Uint8Array(ico)) : null;
  check('the favicon ICO parses: 16, 32 and 48 px PNGs, each its stated size', JSON.stringify(entries) === '[[16,16,16],[32,32,32],[48,48,48]]', entries);
  const shown = toastStore.get().length;
  [...(host('logo')?.querySelectorAll('button') ?? [])].find((b) => b.parentElement?.querySelector('b')?.textContent === 'Favicon bundle')?.click();
  const done = await until(() => toastStore.get().slice(shown).find((x) => x.icon === 'download'));
  check('Favicon bundle writes its nine files into one folder', /^Exported 9 files into /.test(String(done?.message)), done?.message);

  // other tools take the logo: Pattern its icon as a shape, Design its colours as proposals
  const pd = patternDoc();
  const shapes = pd.get().slots.length;
  await shell.sendDoc('logo', 'pattern');
  const shape = pd.get().slots.at(-1);
  check(
    'a logo sent to Pattern becomes a shape: its icon, measured by its artwork',
    shell.getState().active === 'pattern' && pd.get().slots.length === shapes + 1 && shape?.name === made!.name && /<circle/.test(shape.svg) && near(shape.bounds.w, 92, 0.5) && near(shape.bounds.h, 92, 0.5),
    [pd.get().slots.length - shapes, shape?.name, shape?.bounds],
  );
  clearProposals();
  await shell.sendDoc('logo', 'design');
  const hexes = (proposals.get()?.items ?? []).map((x) => toHex(x.oklch));
  check('Design extracts the logo’s colours', shell.getState().active === 'design' && [NAVY, AMBER, INK].every((h) => hexes.includes(h)), hexes);
  clearProposals();
  check('and Logo keeps its logo', ld.state().t === 'saved' && ld.source()?.itemId === made!.itemId, ld.state());
}

/** a PNG of w × h from (x, y) → [r, g, b] bytes, opaque (no colour literals: the image is data) */
async function pngFrom(w: number, h: number, px: (x: number, y: number) => number[]): Promise<ArrayBuffer> {
  const img = new ImageData(w, h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const [r, g, b] = px(x, y);
      img.data.set([r, g, b, 255], (y * w + x) * 4);
    }
  }
  const c = new OffscreenCanvas(w, h);
  c.getContext('2d')!.putImageData(img, 0, 0);
  return (await c.convertToBlob({ type: 'image/png' })).arrayBuffer();
}

/** an uncompressed 16-bit RGB TIFF, little-endian, one strip: (x, y) → [r, g, b] 0..65535 */
function tiff16(w: number, h: number, px: (x: number, y: number) => number[]): ArrayBuffer {
  const tags = [[256, 3, 1, w], [257, 3, 1, h], [258, 3, 3, 0], [259, 3, 1, 1], [262, 3, 1, 2], [273, 4, 1, 0], [277, 3, 1, 3], [278, 3, 1, h], [279, 4, 1, w * h * 6]];
  const bps = 8 + 2 + tags.length * 12 + 4;
  const data = bps + 6;
  const v = new DataView(new ArrayBuffer(data + w * h * 6));
  v.setUint16(0, 0x4949);
  v.setUint16(2, 42, true);
  v.setUint32(4, 8, true);
  v.setUint16(8, tags.length, true);
  tags.forEach(([tag, type, count, value], i) => {
    const at = 10 + i * 12;
    v.setUint16(at, tag, true);
    v.setUint16(at + 2, type, true);
    v.setUint32(at + 4, count, true);
    const val = tag === 258 ? bps : tag === 273 ? data : value;
    if (type === 3 && count === 1) v.setUint16(at + 8, val, true);
    else v.setUint32(at + 8, val, true);
  });
  for (let c = 0; c < 3; c++) v.setUint16(bps + 2 * c, 16, true);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) px(x, y).forEach((c, k) => v.setUint16(data + (y * w + x) * 6 + 2 * k, c, true));
  return v.buffer;
}

/** a baseline TIFF's first IFD as tag → value (a RATIONAL as its quotient) */
function tiffTags(b: Uint8Array): Map<number, number> {
  const v = new DataView(b.buffer, b.byteOffset, b.byteLength);
  const le = b[0] === 0x49;
  const [u16, u32] = [(o: number) => v.getUint16(o, le), (o: number) => v.getUint32(o, le)];
  const tags = new Map<number, number>();
  const ifd = u32(4);
  for (let i = 0; i < u16(ifd); i++) {
    const e = ifd + 2 + 12 * i;
    const type = u16(e + 2);
    tags.set(u16(e), type === 3 ? u16(e + 8) : type === 5 ? u32(u32(e + 8)) / u32(u32(e + 8) + 4) : u32(e + 8));
  }
  return tags;
}

/** an image's RGBA bytes, as decoded (full resolution, straight alpha) */
async function pixelsOf(blob: Blob): Promise<{ w: number; h: number; px: Uint8ClampedArray }> {
  const bmp = await decodeImage(blob);
  const c = new OffscreenCanvas(bmp.width, bmp.height).getContext('2d', { willReadFrequently: true })!;
  c.drawImage(bmp, 0, 0);
  const out = { w: bmp.width, h: bmp.height, px: c.getImageData(0, 0, bmp.width, bmp.height).data };
  bmp.close();
  return out;
}

/**
 * Image › Halftone (plan: Then): pure cyan separates to C alone and a 50% grey to half black, the
 * SVG holds one path per visible ink and none for a hidden one, its dots are the view's, the TIFF
 * plates carry the print DPI and the meters' coverage, a 16-bit TIFF opens, and Dither takes the
 * screen PNG. Leaves Halftone with an image, so the quiet pass sees the document come back.
 */
async function halftone(dir: string, dt: DocController<DitherDoc>): Promise<void> {
  const hd = shell.doc('halftone') as DocController<HalftoneDoc>;
  shell.setActive('halftone');
  const d0 = hd.get();
  check(
    'Halftone starts empty: A4 portrait at 300 dpi and 60 lpi, round dots, CMYK on Bone',
    !d0.source && hd.depth() === 0 && d0.size.w === 210 && d0.size.h === 297 && d0.size.dpi === 300 && d0.screen.lpi === 60 && d0.screen.shape === 'round' && d0.inks.map((i) => i.process).join('') === 'cmyk',
    [d0.size, d0.screen],
  );
  check('and shows where to drop an image', await until(() => host('halftone')?.textContent?.includes('Drop an image to screen')));

  await shell.createCollection('Halftone in');
  const put = async (name: string, ext: string, bytes: ArrayBuffer) => api.invoke('library.createImage', 'Halftone in', name, ext, bytes);
  const cyan = await put('Smoke cyan', 'png', await pngFrom(64, 64, () => [0, 255, 255]));
  const grey = await put('Smoke grey', 'png', await pngFrom(64, 64, () => [128, 128, 128]));
  // a hue sweep over a grey ramp, 3:2 like the page, so every ink has dots
  const hue = (t: number, o: number) => Math.round(255 * Math.min(1, Math.max(0, Math.abs(((6 * t + o) % 6) - 3) - 1)));
  const level = (x: number) => Math.round((x / 239) * 255);
  const ramp = await put('Smoke ramp', 'png', await pngFrom(240, 160, (x, y) => (y < 80 ? [hue(x / 240, 0), hue(x / 240, 4), hue(x / 240, 2)] : [level(x), level(x), level(x)])));
  const deep = await put('Smoke 16-bit', 'tif', tiff16(48, 32, (x) => [0, 1, 2].map(() => Math.round((x / 47) * 65535))));

  // a small page, and white paper: tone is relative to the paper, so on Bone a 50% grey needs less black
  hd.transact('Smoke page', (d) => ({ ...d, size: { ...d.size, w: 90, h: 60 }, fit: 'cover', screen: { ...d.screen, lpi: 40 }, paper: { ...d.paper, colour: [1, 0, 0] } }));
  const means = async () => (await screen(hd.get(), true)).stats.map((st) => st.mean);

  await shell.sendItem(cyan, 'halftone');
  check('an image sent from the Library opens in Halftone in one step', shell.getState().active === 'halftone' && hd.get().source?.name === 'Smoke cyan' && hd.depth() === 2, [hd.get().source?.name, hd.depth()]);
  const [c1, m1, y1, k1] = await means();
  check('pure cyan separates to C alone', c1 > 0.97 && m1 < 0.02 && y1 < 0.02 && k1 < 0.02, [c1, m1, y1, k1]);

  await shell.sendItem(grey, 'halftone');
  const greySource = hd.get().source;
  const [c2, m2, y2, k2] = await means();
  check('a 50% grey on white paper takes about 50% black and no colour', Math.abs(k2 - 0.5) < 0.03 && c2 < 0.02 && m2 < 0.02 && y2 < 0.02, [c2, m2, y2, k2]);

  await shell.sendItem(deep, 'halftone');
  const src = hd.get().source;
  const read = src && (await pixelsOf(await (await fetch(src.asset)).blob()));
  const row = read ? [0, 24, 47].map((x) => read.px[x * 4]) : null;
  const deepMeans = await means().catch(() => null);
  check('a 16-bit TIFF opens at its size, its values rounded to 8 bits, and screens', src?.w === 48 && src.h === 32 && JSON.stringify(row) === JSON.stringify([0, Math.round((24 / 47) * 255), 255]) && deepMeans !== null, [src, row]);

  await shell.sendItem(ramp, 'halftone');
  const yellow = hd.get().inks.find((i) => i.process === 'y')!;
  hd.transact('Hide Yellow', (d) => mapInk(d, yellow.id, (i) => ({ ...i, visible: false })));
  const d = hd.get();
  const shown = await until(() => {
    const st = halftoneStatus.get();
    return ready(d) && st && !st.busy && !st.error && hd.get() === d ? st : null;
  }, 20_000);
  if (!check('the view screens the image', shown && shown.dots > 1000, halftoneStatus.get())) return;
  const vp = host('halftone')?.querySelector<HTMLCanvasElement>('canvas');
  const inked = await until(() => {
    if (!vp || !vp.width) return 0;
    const px = vp.getContext('2d')!.getImageData(0, 0, vp.width, vp.height).data;
    let n = 0;
    for (let i = 0; i < px.length; i += 4) if (px[i] + px[i + 1] + px[i + 2] < 300) n++;
    return n > 500 ? n : 0;
  });
  check('and draws its dots', inked, vp?.width);

  const exported = await toolExport(dir, 'halftone', 'Halftone out');
  const file = await exported('SVG for Illustrator');
  const svg = file && new DOMParser().parseFromString(await file.text(), 'image/svg+xml').documentElement;
  if (!check('Export writes the SVG for Illustrator', svg?.nodeName === 'svg')) return;
  const groups = [...svg!.querySelectorAll(':scope > g')];
  const names = groups.map((g) => g.getAttribute('data-name'));
  check(
    'the SVG has one group and one path per visible ink, and nothing for the hidden one',
    JSON.stringify(names) === JSON.stringify(['Cyan', 'Magenta', 'Black']) && groups.every((g) => g.querySelectorAll('path').length === 1) && svg!.querySelectorAll('path').length === 3,
    names,
  );
  check('it is sized in mm', svg!.getAttribute('width') === '90mm' && svg!.getAttribute('height') === '60mm', [svg!.getAttribute('width'), svg!.getAttribute('height')]);
  const subpaths = [...svg!.querySelectorAll('path')].reduce((n, p) => n + (p.getAttribute('d')?.match(/[Mm]/g)?.length ?? 0), 0);
  check("its dots are the view's, one for one", subpaths === shown!.dots, [subpaths, shown!.dots]);

  // the separations, through the module's button; smoke runs write them into exports/halftone
  const plates = [...(host('halftone')?.querySelectorAll('button') ?? [])].find((b) => b.parentElement?.querySelector('b')?.textContent === 'Separations');
  const before = toastStore.get().length;
  plates?.click();
  const done = await until(() => toastStore.get().slice(before).find((t) => t.icon === 'download'), 20_000);
  check('Separations writes a plate per visible ink into one folder', /^Exported 3 plates into /.test(String(done?.message)), done?.message);
  const plateNames = ['C Cyan', 'M Magenta', 'K Black'];
  await shell.importFiles(plateNames.map((n) => `${dir}\\exports\\halftone\\Smoke ramp ${n}.tif`), 'Halftone out');
  const stats = (await screen(d, true)).stats;
  const [W, H] = [Math.round((90 * 300) / 25.4), Math.round((60 * 300) / 25.4)];
  const found = await Promise.all(
    plateNames.map(async (n, i) => {
      const ref = await until(() => find((x) => x.collection === 'Halftone out' && x.name === `Smoke ramp ${n}`));
      const item = ref && (await api.invoke('library.read', ref.id));
      if (!item || !('url' in item)) return null;
      const blob = await (await fetch(item.url)).blob();
      const tags = tiffTags(new Uint8Array(await blob.arrayBuffer()));
      const img = await pixelsOf(blob);
      let ink = 0;
      for (let p = 0; p < img.px.length; p += 4) ink += 1 - img.px[p] / 255;
      return { tags: [256, 257, 258, 262, 282, 283, 296].map((t) => tags.get(t)), size: [img.w, img.h], off: Math.abs(ink / (img.w * img.h) - stats[[0, 1, 3][i]].mean) };
    }),
  );
  check(
    'the TIFF plates parse at print size, 8-bit greyscale with 300 dpi in the file',
    found.every((f) => f && JSON.stringify(f.tags) === JSON.stringify([W, H, 8, 1, 300, 300, 2]) && f.size[0] === W && f.size[1] === H),
    found.map((f) => f && [f.tags, f.size]),
  );
  check("and each carries its meter's coverage", found.every((f) => f && f.off < 0.02), found.map((f) => f?.off));
  const bilevel = await platesFor(d, 1, 'Smoke');
  check('1-bit plates are bilevel at the same size', bilevel.length === 3 && bilevel.every((f) => JSON.stringify([256, 257, 258, 282].map((t) => tiffTags(new Uint8Array(f.data)).get(t))) === JSON.stringify([W, H, 1, 300])), bilevel.map((f) => f.name));
  const bits = await Promise.all(bilevel.map(async (f) => inkOf(await pixelsOf(new Blob([f.data])))));
  check("and each carries its meter's coverage too, light tones included", bits.every((v, i) => Math.abs(v - stats[[0, 1, 3][i]].mean) < 0.01), bits.map((v, i) => [v.toFixed(4), stats[[0, 1, 3][i]].mean.toFixed(4)]));
  await halftonePrint(d, greySource);
  await halftoneFollowUps({ white: await put('Smoke white', 'png', await pngFrom(64, 64, () => [255, 255, 255])), grey, ramp }, hd);

  // Send to: Dither gets the screen PNG at the image's own resolution
  const want = await pixelsOf((await shell.tool('halftone').render!(d, {})).blob);
  await shell.sendDoc('halftone', 'dither');
  const url = dt.get().source?.assets[0];
  const got = url ? await pixelsOf(await (await fetch(url)).blob()) : null;
  let diff = got && got.px.length === want.px.length ? 0 : 255;
  for (let p = 0; got && p < got.px.length && diff < 255; p++) diff = Math.max(diff, Math.abs(got.px[p] - want.px[p]));
  check('Send to: Dither receives the screen PNG, at the image’s own resolution', shell.getState().active === 'dither' && got?.w === 240 && got.h === 160 && diff <= 1, [got?.w, got?.h, diff]);
}

/** a plate's ink, 0..1, from its decoded pixels (black is ink) */
function inkOf(img: { w: number; h: number; px: Uint8ClampedArray }): number {
  let ink = 0;
  for (let p = 0; p < img.px.length; p += 4) ink += 1 - img.px[p] / 255;
  return ink / (img.w * img.h);
}

/**
 * Halftone as it prints: the plates run through a press (each ink multiplied over the sheet) give
 * the view's picture in both overlaps, so knocked-out plates are cut under the inks printed after
 * them; and a flat tint keeps its tone at every zoom for every shape, down to a cell of a pixel.
 */
async function halftonePrint(d: HalftoneDoc, grey: HalftoneDoc['source']): Promise<void> {
  const riso = (name: string) => INKS.riso.find((k) => k.name === name)!;
  const inks = ['Medium Blue', 'Fluorescent Pink', 'Yellow'].map((n, i) => spotInk(n, riso(n).oklch, i));
  const enc = (o: Oklch) => rgb255(o).map((v) => v / 255);
  for (const overlap of ['overprint', 'knockout'] as const) {
    const ds: HalftoneDoc = { ...d, mode: 'spot', inks, overlap };
    const plates = await Promise.all((await platesFor(ds, 8, 'Press')).map((f) => pixelsOf(new Blob([f.data]))));
    const { w, h } = plates[0];
    const view = await pixelsOf(await pngBlob(ds, w));
    const [paper, cols] = [enc(ds.paper.colour), inks.map((k) => enc(k.colour))];
    // an opaque ink (Riso Yellow is near-white) covers what is under it on the press, as in the view; its plate is the same
    const covers = inks.map((k) => overlap === 'overprint' && opaqueOf(k));
    let [off, n] = [0, 0];
    for (let by = 0; by + 8 <= Math.min(h, view.h); by += 8) {
      for (let bx = 0; bx + 8 <= w; bx += 8) {
        for (let c = 0; c < 3; c++) {
          let [press, shown] = [0, 0];
          for (let y = by; y < by + 8; y++) {
            for (let x = bx; x < bx + 8; x++) {
              const p = y * w + x;
              press += plates.reduce((v, pl, i) => {
                const a = 1 - pl.px[p * 4] / 255;
                return covers[i] ? v * (1 - a) + cols[i][c] * a : v * (1 - a * (1 - cols[i][c]));
              }, paper[c]) * 255;
              shown += view.px[p * 4 + c];
            }
          }
          off += Math.abs(press - shown) / 64;
          n++;
        }
      }
    }
    check(`Halftone, ${overlap}: the plates as a press prints them are the view (8 px blocks)`, off / n < 4, (off / n).toFixed(2));
    const meters = totals(await screen(ds, true), ds).stats;
    const inked = plates.map(inkOf);
    check(`and each ${overlap} plate carries what its meter says prints`, inked.every((v, i) => Math.abs(v - meters[i].mean) < 0.015), inked.map((v, i) => [v.toFixed(3), meters[i].mean.toFixed(3)]));
  }

  const painter = new Painter('smoke tone');
  const misses: string[] = [];
  for (const shape of ['round', 'ellipse', 'square', 'diamond', 'line', 'cross'] as const) {
    const ds: HalftoneDoc = { ...d, source: grey, mode: 'spot', inks: [spotInk('Black', [0, 0, 0], 0)], paper: { colour: [1, 0, 0], include: true }, screen: { ...d.screen, shape } };
    const s = await screen(ds, true);
    const want = 255 * (1 - s.stats[0].mean);
    for (const k of [0.2, 0.5, 1, 4]) {
      const [w, h] = k < 4 ? [Math.round(s.page.w * k), Math.round(s.page.h * k)] : [240, 240];
      const at: [number, number] = k < 4 ? [0, 0] : [Math.round(s.page.w * 1.5), Math.round(s.page.h * 1.5)];
      const bmp = painter.bitmap(s, lookOf(ds, false), at, k, w, h);
      const c = new OffscreenCanvas(w, h).getContext('2d', { willReadFrequently: true })!;
      if (bmp) c.drawImage(bmp, 0, 0);
      bmp?.close();
      const px = c.getImageData(0, 0, w, h).data;
      let sum = 0;
      for (let p = 0; p < px.length; p += 4) sum += px[p];
      const got = sum / (w * h);
      if (!(Math.abs(got - want) <= 2)) misses.push(`${shape} at ${k}: ${got.toFixed(1)} for ${want.toFixed(1)}`);
    }
  }
  painter.release();
  check('a flat tint keeps its tone in the view at 20%, 50%, 100% and 400%, every shape (within 2 of 255)', !misses.length, misses);
}

/**
 * The three Halftone decisions of 2026-09-29 (spec §6), in the app. Bone is the image's white, so a
 * white image takes no ink and a grey no ink to cancel the tint. Only the SVG has a dot cap, counted
 * over the inks that show; the screen PNG and the plates go through without it. An opaque ink
 * covers in the screen PNG and the SVG (normal blend, not multiply) while its plate is its plate.
 * Leaves Halftone on the ramp, as the Send to Dither check after it expects.
 */
async function halftoneFollowUps(img: Record<'white' | 'grey' | 'ramp', LibraryItemRef>, hd: DocController<HalftoneDoc>): Promise<void> {
  const open = async (ref: LibraryItemRef) => {
    await shell.sendItem(ref, 'halftone');
    return hd.get().source;
  };
  const [white, grey, ramp] = [await open(img.white), await open(img.grey), await open(img.ramp)];
  const base = halftoneEmpty();
  const page = { ...base.size, w: 90, h: 60 };
  const small = (source: HalftoneDoc['source']): HalftoneDoc => ({ ...base, source, size: page, fit: 'cover', screen: { ...base.screen, lpi: 40 } });
  const means = async (d: HalftoneDoc) => (await screen(d, true)).stats.map((st) => st.mean);

  const bare = await means(small(white));
  const [c, m, y, k] = await means(small(grey));
  check('Halftone on Bone: the image’s white is the paper, so a white image takes no ink', Math.max(...bare) < 0.005, bare);
  check('and a 50% grey takes about 50% black and no colour to cancel the tint', Math.abs(k - 0.5) < 0.03 && Math.max(c, m, y) < 0.02, [c, m, y, k]);

  // the cap, on a page with far more cells than the SVG may hold
  const riso = (name: string) => INKS.riso.find((x) => x.name === name)!;
  const two = ['Black', 'Medium Blue'].map((n, i) => spotInk(n, riso(n).oklch, i));
  const big: HalftoneDoc = { ...small(ramp), mode: 'spot', inks: two, size: { ...page, w: 841, h: 1189, dpi: 72 }, screen: { ...base.screen, lpi: 150 } };
  const held = { ...big, inks: [two[0], { ...two[1], visible: false }] };
  const s = await screen(big, true);
  const all = shownDots(s, big);
  check('the dot cap counts only the inks that show', all > 12e6 && svgOver(all, true) !== null && shownDots(s, held) === s.inks[0].count && s.inks[0].count < all, [all, s.inks.map((i) => i.count)]);
  const refused = await svgFor(big).then(() => null, (e: Error) => e.message);
  check('the SVG refuses a page past 12 million dots in plain words', /million dots is more than the SVG takes/.test(String(refused)), refused);
  const png = await pngBlob(big, 600).then((b) => b.size, (e: Error) => e.message);
  check('but the screen PNG of the same page has no cap', typeof png === 'number' && png > 1000, png);
  const plates = await platesFor(big, 8, 'Smoke big').then((f) => f.length, (e: Error) => e.message);
  check('and neither do its plates', plates === 2, plates);

  // opaque white on dark paper
  const dark: Oklch = [0.2, 0.03, 280];
  const ink = (opaque: boolean) => ({ ...spotInk('White', [1, 0, 0], 1), opaque });
  const onDark = (inks: HalftoneDoc['inks']): HalftoneDoc => ({ ...small(grey), mode: 'spot', inks, paper: { colour: dark, include: true } });
  const meanRed = async (d: HalftoneDoc) => {
    const { px } = await pixelsOf(await pngBlob(d, 180));
    let sum = 0;
    for (let i = 0; i < px.length; i += 4) sum += px[i];
    return sum / (px.length / 4);
  };
  const [lit, unlit] = [await meanRed(onDark([ink(true)])), await meanRed(onDark([ink(false)]))];
  check('a white ink prints the lights on dark paper when it is opaque, and is lost on it when it is not', lit > 90 && unlit < 40, [lit, unlit]);

  const black = spotInk('Black', riso('Black').oklch, 0);
  const blends = async (opaque: boolean) => {
    const doc = new DOMParser().parseFromString(new TextDecoder().decode(await svgFor(onDark([black, ink(opaque)]))), 'image/svg+xml');
    return ['Black', 'White'].map((n) => /multiply/.test(doc.querySelector(`g[data-name="${n}"]`)?.getAttribute('style') ?? ''));
  };
  const [opaqueBlend, plainBlend] = [await blends(true), await blends(false)];
  check('the SVG draws an opaque ink with normal blending and a transparent one with Multiply', JSON.stringify(opaqueBlend) === '[true,false]' && JSON.stringify(plainBlend) === '[true,true]', [opaqueBlend, plainBlend]);

  const cover = onDark([black, ink(true)]);
  const meters = totals(await screen(cover, true), cover).stats;
  const carried = (await platesFor(cover, 8, 'Smoke opaque')).map(async (f) => inkOf(await pixelsOf(new Blob([f.data]))));
  const got = await Promise.all(carried);
  check('and its plate is just its plate: neither plate is cut where the white covers', got.length === 2 && got.every((v, i) => Math.abs(v - meters[i].mean) < 0.015), got.map((v, i) => [v.toFixed(3), meters[i].mean.toFixed(3)]));
  await open(img.ramp);
}

/** a PNG's chunks by type, the first of each */
function pngChunks(b: Uint8Array): Map<string, Uint8Array> {
  const v = new DataView(b.buffer, b.byteOffset, b.byteLength);
  const out = new Map<string, Uint8Array>();
  for (let at = 8; at + 12 <= b.length; at += 12 + v.getUint32(at)) {
    const type = String.fromCharCode(...b.subarray(at + 4, at + 8));
    if (!out.has(type)) out.set(type, b.subarray(at + 8, at + 8 + v.getUint32(at)));
  }
  return out;
}

/** pixels of `img` that aren't their block's colour in the result drawn at `k` px a block; -1 at the wrong size */
function offBlocks(img: { w: number; h: number; px: Uint8ClampedArray }, r: Result, k: number): number {
  if (img.w !== r.w * k || img.h !== r.h * k) return -1;
  const rgb = r.colours.map(rgb255);
  let off = 0;
  for (let y = 0; y < img.h; y++) {
    for (let x = 0; x < img.w; x++) {
      const c = rgb[r.indices[Math.floor(y / k) * r.w + Math.floor(x / k)]];
      const p = (y * img.w + x) * 4;
      if (img.px[p] !== c[0] || img.px[p + 1] !== c[1] || img.px[p + 2] !== c[2]) off++;
    }
  }
  return off;
}

/** an animated GIF of a bar crossing a ramp, a frame for each delay (hundredths) */
function barGif(w: number, h: number, delays: number[]): ArrayBuffer {
  const greys: Rgba8[] = Array.from({ length: 16 }, (_, i) => [i * 17, i * 17, i * 17]);
  const gif = gifWriter();
  delays.forEach((cs, i) => {
    const indices = Uint8Array.from({ length: w * h }, (_, p) => (Math.abs((p % w) - 8 - i * 10) < 4 ? 15 : Math.floor(((p % w) / w) * 12)));
    gif.add({ indices, w, h, palette: greys }, cs);
  });
  return gif.finish().slice().buffer;
}

/** an image's pixels as one number, to tell frames apart */
const hashOf = (px: Uint8ClampedArray) => new Uint32Array(px.buffer, px.byteOffset, px.length / 4).reduce((h, v) => (Math.imul(h, 31) + v) | 0, 7);

/**
 * Image › Dither (plan: Then): pixel size 8 exports 8 px blocks, the indexed PNG is a true palette
 * file of the palette, every algorithm renders through the view, an animated GIF round-trips with
 * its frame count and loop length, a second paste of another picture with the same name re-renders,
 * and Halftone takes the result. Leaves Dither with the GIF, so the quiet pass sees it come back.
 */
async function dither(dir: string): Promise<void> {
  const dt = ditherDoc();
  shell.setActive('dither');
  await shell.createCollection('Dither in');
  const put = async (name: string, ext: string, bytes: ArrayBuffer) => api.invoke('library.createImage', 'Dither in', name, ext, bytes);
  /** the view's result for the document as it is now */
  const shown = (frame = 0) => until(() => ditherReady(dt.get(), frame), 20_000);
  const why = () => ditherStatus.get() ?? 'no status';

  // a grey ramp under a hue sweep, 96 × 64: at pixel size 8, 12 × 8 blocks
  const hue = (t: number, o: number) => Math.round(255 * Math.min(1, Math.max(0, Math.abs(((6 * t + o) % 6) - 3) - 1)));
  const ramp = await put('Smoke dither ramp', 'png', await pngFrom(96, 64, (x, y) => (y < 32 ? [hue(x / 96, 0), hue(x / 96, 4), hue(x / 96, 2)] : [0, 1, 2].map(() => Math.round((x / 95) * 255)))));
  await shell.sendItem(ramp, 'dither');
  dt.transact('Game Boy at 8 px', (d) => ({ ...withLookId(d, 'gameboy'), pixel: 8 }));
  const r = await shown();
  if (!check('Dither dithers the image in its view', r && r.w === 12 && r.h === 8 && new Set(r.indices).size >= 3, [r?.w, r?.h, why()])) return;

  const exported = await toolExport(dir, 'dither', 'Dither out');
  const png = await exported('PNG');
  const img = png && (await pixelsOf(await png.blob()));
  const off = img ? offBlocks(img, r!, 8) : null;
  check('pixel size 8 exports 8 px blocks: 96 × 64 px, every pixel its block’s colour in the view', off === 0, [img?.w, img?.h, off]);

  const indexed = await exported('Indexed PNG');
  const bytes = indexed && new Uint8Array(await indexed.arrayBuffer());
  const chunks = bytes ? pngChunks(bytes) : null;
  const [ihdr, plte] = [chunks?.get('IHDR'), chunks?.get('PLTE')];
  const greens = used(dt.get()).flatMap(rgb255);
  check(
    'the indexed PNG is a true palette file: 2 bit, its PLTE the four Game Boy greens in order, the same pixels',
    ihdr?.[8] === 2 && ihdr[9] === 3 && plte && JSON.stringify([...plte]) === JSON.stringify(greens) && bytes && offBlocks(await pixelsOf(new Blob([bytes])), r!, 8) === 0,
    [ihdr?.[8], ihdr?.[9], plte && [...plte], greens],
  );

  // every algorithm, through the view, on the ramp at 2 px blocks
  dt.transact('Pixel size 2', (d) => ({ ...d, pixel: 2 }));
  const bad: string[] = [];
  for (const a of ALGORITHMS) {
    dt.transact(`Dither with ${a.label}`, (d) => ({ ...d, algorithm: a.id }));
    const x = await shown();
    const n = x ? new Set(x.indices).size : 0;
    if (!x || x.w !== 48 || x.indices.some((v) => v >= x.colours.length) || n < 2) bad.push(`${a.id}: ${x ? `${n} colours` : JSON.stringify(why())}`);
  }
  check(`all ${ALGORITHMS.length} algorithms render through the view, each with more than one colour on the ramp`, ALGORITHMS.length === 18 && !bad.length, bad);

  // an animated GIF with its own uneven timing, 6 frames
  const CS = [7, 13, 10, 10, 20, 6];
  const anim = await put('Smoke anim', 'gif', barGif(64, 40, CS));
  await shell.sendItem(anim, 'dither');
  const src = dt.get().source;
  check('an animated GIF opens with its frames and its own timing', src?.frames === 6 && JSON.stringify(src.delays) === JSON.stringify(CS.map((c) => c * 10)), src && [src.frames, src.delays]);
  dt.transact('Mac 1-bit at 2 px', (d) => ({ ...withLookId(d, 'mac'), pixel: 2 }));
  await shown();
  const gif = await exported('GIF');
  const back = gif && new Uint8Array(await gif.arrayBuffer());
  const info = back && readGif(back);
  check(
    'its GIF has every frame, each timed as the source so the loop is exactly as long, looping forever',
    info?.frames.length === 6 && JSON.stringify(info.frames.map((f) => f.delay)) === JSON.stringify(CS) && info.loop === 0 && info.w === 64 && info.h === 40,
    info && [info.frames.map((f) => f.delay), info.loop, info.w, info.h],
  );
  if (back) {
    const frames = await decodeFrames(new Blob([back], { type: 'image/gif' }));
    const offs: number[] = [];
    const seen = new Set<number>();
    for (let i = 0; i < frames.count; i++) {
      const bmp = await frames.frame(i);
      const c = new OffscreenCanvas(bmp.width, bmp.height).getContext('2d', { willReadFrequently: true })!;
      c.drawImage(bmp, 0, 0);
      bmp.close();
      const px = c.getImageData(0, 0, 64, 40).data;
      offs.push(offBlocks({ w: 64, h: 40, px }, await dithered(dt.get(), i, 'export'), 2));
      seen.add(hashOf(px));
    }
    frames.close();
    check('each GIF frame is that frame’s dither pixel for pixel, and no two are the same', offs.length === 6 && offs.every((o) => o === 0) && seen.size === 6, offs);
  }
  const shown0 = toastStore.get().length;
  [...(host('dither')?.querySelectorAll('button') ?? [])].find((b) => b.parentElement?.querySelector('b')?.textContent === 'PNG frames')?.click();
  const done = await until(() => toastStore.get().slice(shown0).find((t) => t.icon === 'download'), 20_000);
  check('PNG frames writes all six into one folder', /^Exported 6 frames into /.test(String(done?.message)), done?.message);
  await shell.importFiles([1, 6].map((n) => `${dir}\\exports\\dither\\Smoke anim dither 000${n}.png`), 'Dither out');
  const frameOff = await Promise.all(
    [1, 6].map(async (n) => {
      const ref = await until(() => find((x) => x.collection === 'Dither out' && x.name === `Smoke anim dither 000${n}`));
      const item = ref && (await api.invoke('library.read', ref.id));
      return item && 'url' in item ? offBlocks(await pixelsOf(await (await fetch(item.url)).blob()), await dithered(dt.get(), n - 1, 'export'), 2) : null;
    }),
  );
  check('and the first and last are those frames’ dithers', frameOff.every((o) => o === 0), frameOff);

  // a second paste of another picture, both named image.png as a browser names them, re-renders
  const paste = (bytes: ArrayBuffer) => {
    const data = new DataTransfer();
    data.items.add(new File([bytes], 'image.png', { type: 'image/png' }));
    (document.activeElement as HTMLElement | null)?.blur();
    window.dispatchEvent(new ClipboardEvent('paste', { clipboardData: data, cancelable: true }));
  };
  const rendered = async () => new Uint8Array(await (await shell.tool('dither').render!(dt.get(), {})).blob.arrayBuffer()).join();
  const was = dt.get().source;
  paste(await pngFrom(64, 48, (x) => [0, 1, 2].map(() => x * 4)));
  const one = await until(() => (dt.get().source !== was && dt.get().source?.name === 'image' ? dt.get().source : null));
  const [r1, png1] = [await shown(), await rendered()];
  paste(await pngFrom(64, 48, (_, y) => [0, 1, 2].map(() => 255 - y * 5)));
  const two = await until(() => (dt.get().source !== one && dt.get().source?.name === 'image' ? dt.get().source : null));
  const [r2, png2] = [await shown(), await rendered()];
  check(
    'a second paste named image.png, another picture, opens as its own image and re-renders, and the render follows',
    one && two && one.assets[0] !== two.assets[0] && r1 && r2 && r1.src !== r2.src && r1.indices.join() !== r2.indices.join() && png1 !== png2,
    [one?.assets, two?.assets, r1?.src, r2?.src],
  );

  // Send to Halftone: the dithered PNG, each block the pixel size
  const hd = shell.doc('halftone') as DocController<HalftoneDoc>;
  await shell.sendDoc('dither', 'halftone');
  const hs = hd.get().source;
  const got = hs && (await pixelsOf(await (await fetch(hs.asset)).blob()));
  check('Send to Halftone: it opens the dithered PNG at the export size, every block as the view has it', shell.getState().active === 'halftone' && r2 && got && offBlocks(got, r2, 2) === 0, [hs?.name, got?.w, got?.h, got && r2 && offBlocks(got, r2, 2)]);

  await shell.sendItem(anim, 'dither');
}

const postfxDoc = () => shell.doc('postfx') as DocController<PostFxDoc>;
/** the button of a tool's export row (the row's name is its bold text) */
const exportRow = (tool: ToolId, row: string) => [...(host(tool)?.querySelectorAll('button') ?? [])].find((b) => !b.disabled && b.parentElement?.querySelector('b')?.textContent === row);

/** an input's text as typing leaves it (React hears the input event) */
function typeInto(el: HTMLInputElement, text: string): void {
  el.focus();
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(el, text);
  el.dispatchEvent(new Event('input', { bubbles: true }));
}

/** a PNG of w × h from (x, y) → [r, g, b, a] bytes, straight alpha */
async function pngRgba(w: number, h: number, px: (x: number, y: number) => number[]): Promise<ArrayBuffer> {
  const img = new ImageData(w, h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) img.data.set(px(x, y), (y * w + x) * 4);
  const c = new OffscreenCanvas(w, h);
  c.getContext('2d')!.putImageData(img, 0, 0);
  return (await c.convertToBlob({ type: 'image/png' })).arrayBuffer();
}

/** a frame's index is drawn into it as 8 blocks of 16 px along the top: white for a 1, bit 0 at the left */
const BLOCK = 16;
const readIndex = (img: { w: number; px: Uint8ClampedArray }) =>
  [...Array(8).keys()].reduce((n, b) => n | ((img.px[((BLOCK / 2) * img.w + b * BLOCK + BLOCK / 2) * 4] > 127 ? 1 : 0) << b), 0);

/**
 * A WebM of exactly `n` frames at `fps`, made in the page: VP8 frames from WebCodecs (each a key frame),
 * muxed by hand so every frame time and the frame duration are exact (MediaRecorder times its frames by
 * the clock, and a clip measured off those can come out a frame or a rate away). Frame i holds a moving
 * scene under its index.
 */
async function makeWebm(w: number, h: number, n: number, fps: number): Promise<File> {
  const joined = (...parts: Uint8Array[]) => {
    const out = new Uint8Array(parts.reduce((len, p) => len + p.length, 0));
    parts.reduce((at, p) => (out.set(p, at), at + p.length), 0);
    return out;
  };
  const be = (v: number, bytes: number) => Uint8Array.from({ length: bytes }, (_, i) => Math.floor(v / 2 ** (8 * (bytes - 1 - i))) & 255);
  // an EBML element: its id, its size in 8 bytes, its body
  const el = (id: number[], ...body: Uint8Array[]) => {
    const b = joined(...body);
    return joined(Uint8Array.from(id), Uint8Array.of(1), be(b.length, 7), b);
  };
  const uint = (id: number[], v: number) => el(id, be(v, 4));
  const text = (id: number[], s: string) => el(id, new TextEncoder().encode(s));
  const float = (id: number[], v: number) => el(id, new Uint8Array(new Float64Array([v]).buffer).reverse());

  const canvas = new OffscreenCanvas(w, h);
  const g = canvas.getContext('2d')!;
  const frames: { key: boolean; data: Uint8Array }[] = [];
  const encoder = new VideoEncoder({
    output: (c) => {
      const data = new Uint8Array(c.byteLength);
      c.copyTo(data);
      frames.push({ key: c.type === 'key', data });
    },
    error: (e) => {
      throw e;
    },
  });
  encoder.configure({ codec: 'vp8', width: w, height: h, bitrate: 3e6, framerate: fps });
  for (let i = 0; i < n; i++) {
    const img = new ImageData(w, h);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const bar = Math.abs(x - ((i * 7) % w)) < 6;
        const code = y < BLOCK && x < 8 * BLOCK ? ((i >> Math.floor(x / BLOCK)) & 1) * 255 : null;
        const v = code ?? (bar ? 230 : 60 + ((x + y + i * 3) % 90));
        img.data.set([v, code === null ? v >> 1 : v, code === null ? 255 - v : v, 255], (y * w + x) * 4);
      }
    }
    g.putImageData(img, 0, 0);
    const frame = new VideoFrame(canvas, { timestamp: Math.round((i * 1e6) / fps) });
    encoder.encode(frame, { keyFrame: true });
    frame.close();
  }
  await encoder.flush();
  encoder.close();

  const ms = 1000 / fps;
  const header = el([0x1a, 0x45, 0xdf, 0xa3], uint([0x42, 0x86], 1), uint([0x42, 0xf7], 1), uint([0x42, 0xf2], 4), uint([0x42, 0xf3], 8), text([0x42, 0x82], 'webm'), uint([0x42, 0x87], 4), uint([0x42, 0x85], 2));
  const info = el([0x15, 0x49, 0xa9, 0x66], uint([0x2a, 0xd7, 0xb1], 1e6), float([0x44, 0x89], n * ms), text([0x4d, 0x80], 'smoke'), text([0x57, 0x41], 'smoke'));
  const track = el(
    [0x16, 0x54, 0xae, 0x6b],
    el([0xae], uint([0xd7], 1), uint([0x73, 0xc5], 1), uint([0x83], 1), uint([0x9c], 0), text([0x86], 'V_VP8'), uint([0x23, 0xe3, 0x83], Math.round(1e9 / fps)), el([0xe0], uint([0xb0], w), uint([0xba], h))),
  );
  const blocks = frames.map((f, i) => {
    const at = Math.round(i * ms);
    return el([0xa3], Uint8Array.of(0x81, at >> 8, at & 255, f.key ? 0x80 : 0), f.data);
  });
  const segment = el([0x18, 0x53, 0x80, 0x67], info, track, el([0x1f, 0x43, 0xb6, 0x75], uint([0xe7], 0), ...blocks));
  return new File([joined(header, segment)], 'smoke clip.webm', { type: 'video/webm' });
}

/**
 * Image › Post FX (plan: Then): a PNG at full resolution keeps its alpha; a still with grain exports
 * a loop of exactly N frames and its frame N is its frame 0; a share code round-trips and one with an
 * effect this version lacks is refused; datamosh is unavailable on a still; nothing plays until play
 * and switching tools pauses; no moving effect flickers; a WebM made here opens, and its PNG
 * sequence has every frame, in order, as the index drawn in it says. Leaves Post FX with a still
 * and a grain loop, so the quiet pass sees the document come back.
 */
async function postfx(dir: string): Promise<void> {
  const pd = postfxDoc();
  shell.setActive('postfx');
  const d0 = pd.get();
  check('Post FX starts empty: no image, no effects', !d0.source && !d0.stack.length && pd.depth() === 0, d0);
  check('and shows where to drop an image', await until(() => host('postfx')?.textContent?.includes('Drop an image, a GIF or a video')));

  await shell.createCollection('Post FX in');
  const put = async (name: string, bytes: ArrayBuffer) => api.invoke('library.createImage', 'Post FX in', name, 'png', bytes);
  const exported = await toolExport(dir, 'postfx', 'Post FX out');

  // full resolution, with alpha: wider than v1's 1600 px cap, a clear corner and a half-clear band
  const [BW, BH] = [1800, 1000];
  const clear = (x: number, y: number) => (x < 90 && y < 60 ? 0 : y >= BH - 40 ? 128 : 255);
  const wide = await put('Smoke wide', await pngRgba(BW, BH, (x, y) => [x % 256, Math.floor((y * 255) / BH), ((x + y) >> 2) & 255, clear(x, y)]));
  await shell.sendItem(wide, 'postfx');
  check('an image sent from the Library opens in Post FX in one step', pd.get().source?.kind === 'image' && pd.get().source?.w === BW && pd.depth() === 1, [pd.get().source, pd.depth()]);
  pd.transact('Add Grade', (d) => ({ ...d, stack: [layerOf('grade', { saturation: 140 })] }));
  const whole = await exported('PNG');
  const big = whole && (await pixelsOf(await whole.blob()));
  const alphaAt = (x: number, y: number) => big!.px[(y * big!.w + x) * 4 + 3];
  check(
    'the PNG is the full 1800 × 1000 px (v1 stopped at 1600) and keeps its alpha: clear, half clear, solid',
    !!big && big.w === BW && big.h === BH && alphaAt(10, 10) === 0 && Math.abs(alphaAt(900, BH - 10) - 128) <= 1 && alphaAt(900, 500) === 255,
    big && [big.w, big.h, alphaAt(10, 10), alphaAt(900, BH - 10), alphaAt(900, 500)],
  );

  // a still with grain: a loop of exactly N frames, and frame N is frame 0
  const card = await put('Smoke fx card', await pngRgba(256, 160, (x, y) => [x, Math.floor((y * 255) / 159), (x ^ y) & 255, x < 40 && y < 24 ? 0 : 255]));
  await shell.sendItem(card, 'postfx');
  pd.transact('Grain loop', (d) => ({ ...d, stack: [layerOf('grain', { amount: 30, boil: 12 })], loop: { seconds: 1, fps: 10 } }));
  const loop = timeline(pd.get());
  check('a still with grain becomes a loop of 10 frames over 1 second', loop.kind === 'loop' && loop.count === 10 && loop.seconds === 1, [loop.kind, loop.count, loop.seconds]);
  const gif = await exported('GIF');
  const gifInfo = gif && readGif(new Uint8Array(await gif.arrayBuffer()));
  check(
    'its GIF has 10 frames of 10 hundredths, looping forever, so it is exactly one second',
    gifInfo?.frames.length === 10 && gifInfo.frames.every((f) => f.delay === 10) && gifInfo.loop === 0 && gifInfo.w === 256,
    gifInfo && [gifInfo.frames.map((f) => f.delay), gifInfo.loop],
  );
  const asked = toastStore.get().length;
  exportRow('postfx', 'PNG sequence')?.click();
  const wrote = await until(() => toastStore.get().slice(asked).find((t) => t.icon === 'download'), 20_000);
  check('PNG sequence writes all 10 frames into one folder', /^Exported 10 frames into /.test(String(wrote?.message)), wrote?.message);
  const numbered = (name: string, n: number) => `${name} ${String(n).padStart(4, '0')}`;
  await shell.importFiles([1, 2, 10].map((n) => `${dir}\\exports\\postfx\\${numbered('Smoke fx card fx', n)}.png`), 'Post FX out');
  const frameOf = async (n: number) => {
    const ref = await until(() => find((x) => x.collection === 'Post FX out' && x.name === numbered('Smoke fx card fx', n)));
    const item = ref && (await api.invoke('library.read', ref.id));
    return item && 'url' in item ? pixelsOf(await (await fetch(item.url)).blob()) : null;
  };
  const stack = new Stack('smoke post fx');
  try {
    const bmp = await decodeImage(await (await fetch(pd.get().source!.asset)).blob());
    const src = stack.g.texture(bmp, 'rgba16f');
    bmp.close();
    const at = (t: number) => stack.bytes(stack.render(src, pd.get().stack, { t, scale: 1 })).slice();
    const [f0, f1, fN, f9] = [at(0), at(0.1), at(1), at(0.9)];
    check('frame N of the loop is frame 0 to the byte: the grain comes round exactly', f0.every((v, i) => v === fN[i]) && f0.some((v, i) => v !== f1[i]), f0.filter((v, i) => v !== fN[i]).length);
    const [first, second, last] = [await frameOf(1), await frameOf(2), await frameOf(10)];
    // straight-alpha pixels come back from a canvas exactly where alpha is 255
    const sameAs = (img: Awaited<ReturnType<typeof pixelsOf>> | null, want: Uint8Array) => !!img && img.px.length === want.length && img.px.every((v, i) => want[i - (i % 4) + 3] !== 255 || v === want[i]);
    check('and the files are those frames: the first is frame 0, the second is frame 1, the last is frame 9', sameAs(first, f0) && sameAs(second, f1) && sameAs(last, f9) && !!first && !!last && first.px.join() !== last.px.join(), [!!first, !!second, !!last]);
  } finally {
    stack.release();
  }

  // share codes
  pd.transact('A stack', (d) => ({ ...d, stack: [layerOf('grade', { lift: 7 }), layerOf('vhs', { wobble: 5, speed: 2 }), layerOf('duotone')] }));
  const made = pd.get().stack;
  const bare = (l: typeof made) => JSON.stringify(l.map(({ effect, on, opacity, blend, params }) => ({ effect, on, opacity, blend, params })));
  const code = encodeStack(made);
  check('a share code is PFX2. and the stack, and it round-trips with every setting', code.startsWith('PFX2.') && bare(decodeStack(code)) === bare(made), code.slice(0, 24));
  pd.transact('Empty the stack', (d) => ({ ...d, stack: [] }));
  const field = await until(() => host('postfx')?.querySelector<HTMLInputElement>('input[placeholder^="Paste a PFX2"]'));
  if (field) {
    typeInto(field, code);
    press('Enter');
  }
  check('pasting the code into the field brings the stack back', await until(() => bare(pd.get().stack) === bare(made)), pd.get().stack.map((l) => l.effect));
  const sparkle = `PFX2.${btoa(JSON.stringify({ v: 2, layers: [{ effect: 'sparkle', on: true, opacity: 1, blend: 'normal', params: {} }] })).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')}`;
  let why = '';
  try {
    decodeStack(sparkle);
  } catch (e) {
    why = e instanceof Error ? e.message : String(e);
  }
  const kept = pd.get();
  if (field) {
    typeInto(field, sparkle);
    press('Enter');
  }
  check('a code with an effect this version lacks is refused by name, in the field, and the stack stays', /“sparkle”/.test(why) && !!(await until(() => field?.getAttribute('aria-invalid') === 'true')) && pd.get() === kept, why);
  field?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));

  // datamosh needs a clip
  const stillDoc = pd.get();
  addEffect(pd, 'datamosh');
  host('postfx')?.querySelector<HTMLButtonElement>('button[aria-label="Add an effect"]')?.click();
  const row = await until(() => [...document.querySelectorAll<HTMLElement>('[role="dialog"][aria-label="Add an effect"] [role="option"]')].find((o) => o.textContent?.includes('Datamosh')));
  press('Escape');
  check('datamosh is unavailable on a still: adding it does nothing and the picker greys it', !offered(stillDoc, 'datamosh') && pd.get() === stillDoc && row?.getAttribute('aria-disabled') === 'true', [pd.get().stack.length, row?.getAttribute('aria-disabled')]);

  // nothing plays until play is pressed, and leaving the tool pauses
  pd.transact('Grain', (d) => ({ ...d, stack: [layerOf('grain')] }));
  await sleep(600);
  const rest = playhead.get();
  check('nothing plays until play is pressed: a moving stack rests on its first frame', !rest.playing && rest.frame === 0, rest);
  togglePlay(pd, timeline(pd.get()));
  const ran = playhead.get().playing && !!(await until(() => playhead.get().frame > 0, 10_000));
  shell.setActive('dither');
  check('Play plays the loop, and switching to another tool pauses it', ran && !!(await until(() => !playhead.get().playing, 3000)), playhead.get());
  shell.setActive('postfx');

  // no flicker, exact loops, half floats, a preview that is the export
  const flicker = flickerChecks();
  check(`no moving effect flickers: ${flicker.length} runs of 60 frames, the mean luminance moving under 2% a frame`, flicker.length >= 10 && flicker.every((c) => c.ok), flicker.filter((c) => !c.ok));
  const gpu = [...loopChecks(), ...pipelineChecks(), ...datamoshChecks(), ...scaleChecks()];
  check(`every moving effect loops exactly; stacks stay in half floats; datamosh repeats; a small preview is the export (${gpu.length} checks)`, gpu.every((c) => c.ok), gpu.filter((c) => !c.ok));

  // a clip made here: its frame count and rate, and a PNG sequence of exactly those frames in order
  const N = 12;
  await shell.runBusy(async () => shell.tool('postfx').onFiles!([await makeWebm(160, 96, N, 25)], 'drop', pd));
  const vid = await until(() => (pd.get().source?.kind === 'video' ? pd.get().source : null), 30_000);
  check(`a WebM made in the page opens as a clip of its ${N} frames at 25 fps`, vid?.frames === N && vid.fps === 25 && vid.w === 160 && vid.h === 96, vid);
  pd.transact('Grade', (d) => ({ ...d, stack: [layerOf('grade')] }));
  check('and datamosh is offered on it', offered(pd.get(), 'datamosh'));
  const before = toastStore.get().length;
  exportRow('postfx', 'PNG sequence')?.click();
  const clipDone = await until(() => toastStore.get().slice(before).find((t) => t.icon === 'download'), 60_000);
  check(`its PNG sequence has one file for each of its ${N} frames`, new RegExp(`^Exported ${N} frames into `).test(String(clipDone?.message)), clipDone?.message);
  const names = Array.from({ length: N }, (_, i) => numbered('smoke clip fx', i + 1));
  await shell.importFiles(names.map((n) => `${dir}\\exports\\postfx\\${n}.png`), 'Post FX out');
  const indices = await Promise.all(
    names.map(async (n) => {
      const ref = await until(() => find((x) => x.collection === 'Post FX out' && x.name === n));
      const item = ref && (await api.invoke('library.read', ref.id));
      return item && 'url' in item ? readIndex(await pixelsOf(await (await fetch(item.url)).blob())) : -1;
    }),
  );
  check(`and the index drawn in each frame, read back from the PNGs, runs 0 to ${N - 1} with none repeated or missing`, indices.every((v, i) => v === i), indices);

  // leave a still with a grain loop, and hand its first frame on: Send to renders the effects in, full size
  await shell.sendItem(card, 'postfx');
  pd.transact('Grain loop', (d) => ({ ...d, stack: [layerOf('grain', { amount: 30, boil: 12 })], loop: { seconds: 1, fps: 10 } }));
  const hd = shell.doc('halftone') as DocController<HalftoneDoc>;
  await shell.sendDoc('postfx', 'halftone');
  const sent = hd.get().source;
  const [plain, grainy] = sent ? [await pixelsOf(await (await fetch(pd.get().source!.asset)).blob()), await pixelsOf(await (await fetch(sent.asset)).blob())] : [null, null];
  let moved = 0;
  for (let p = 0; plain && grainy && p < plain.px.length; p += 4) if (plain.px[p + 3] === 255 && Math.abs(plain.px[p] - grainy.px[p]) > 3) moved++;
  check('Send to Halftone hands over the frame on screen with its grain, at full size', shell.getState().active === 'halftone' && grainy?.w === 256 && grainy.h === 160 && moved > 5000, [sent?.name, grainy?.w, grainy?.h, moved]);
}

/**
 * Colour › Illustration (plan: Integrate): an edit writes the file, regenerating keeps hand-edited
 * steps, Design writes an Illustration palette back whole, and a painting is kept with its palette.
 * Ends with Illustration showing its canvas, so the quiet pass can see the painting come back.
 */
async function illustration(): Promise<void> {
  const il = illustrationDoc();
  const dd = designDoc();
  const glossy = dd.source();
  shell.setActive('illustration');
  await shell.newDoc('illustration');
  il.transact('Add base colours', (d) => addRamp(addRamp(d, [0.62, 0.12, 40]).doc, [0.55, 0.1, 250]).doc);
  const made = await until(() => (il.state().t === 'saved' ? il.source() : null));
  if (!check('an Illustration edit makes a palette in Scratch', made?.collection === 'Scratch', made ?? il.state())) return;
  const id = made!.itemId;
  const payload = async () => {
    const item = await api.invoke('library.read', id).catch(() => null);
    return item?.kind === 'palette' ? item.payload : null;
  };
  const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
  const whole = await until(async () => {
    const p = await payload();
    return p?.ramps?.length === 2 && p.swatches.length === 10 && p.swatches.every((w) => typeof w.group === 'string' && Number.isInteger(w.step));
  });
  check('its file holds two 5-step ramps, each swatch with its ramp and step', whole, await payload());
  patchIllustration({ tab: 'check', check: null });
  const opened = await until(() => openCheck('illustration'));
  check('Illustration’s Check lists problems first and opens on the first, or on its first check', opened && opened.open === (opened.bad || opened.first) && (!opened.bad || opened.first === opened.bad), opened);

  // a hand-edited step stays put when its ramp regenerates; the others follow the new settings
  const ramp = il.get().ramps[0].id;
  const shadow = stepsOf(il.get(), ramp)[3];
  const mine: Oklch = [0.4, 0.06, 300];
  il.transact('Change shadow', (d) => recolour(d, shadow.id, mine));
  const before = stepsOf(il.get(), ramp);
  il.transact('Change the material', (d) => setSpec(d, ramp, { material: 'metal', intensity: 'extreme' }));
  const after = stepsOf(il.get(), ramp);
  const kept = after.find((w) => w.id === shadow.id);
  const moved = after.filter((w, i) => w.step !== 0 && !w.edited && !same(w.oklch, before[i].oklch));
  check('regenerating keeps the hand-edited step and moves the others', kept?.edited && same(kept.oklch, mine) && moved.length === 3, after.map((w) => [w.step, w.edited, w.oklch]));
  check('and writes the file', await until(async () => same((await payload())?.swatches, il.get().swatches)));

  // Design opens it, changes a step and writes it back whole
  const ref = await find((i) => i.id === id);
  if (!check('the Illustration palette is listed', ref)) return;
  await shell.sendItem(ref!, 'design');
  check('Design opens the Illustration palette', dd.source()?.itemId === id && shell.getState().owners[id] === 'design', dd.source());
  const light = stepsOf(il.get(), ramp)[1];
  dd.transact('Change colour', (d) => recolourInDesign(d, { [light.id]: [0.8, 0.07, 60] }));
  const written = await until(async () => {
    const p = await payload();
    return p?.swatches.find((w) => w.id === light.id)?.oklch[0] === 0.8 ? p : null;
  });
  const was = il.get(); // detached now: the palette as Illustration last wrote it
  const kept2 = was.swatches.every((w) => {
    const x = written?.swatches.find((y) => y.id === w.id);
    return x && x.group === w.group && x.step === w.step && (x.id === light.id || !!x.edited === !!w.edited);
  });
  check('Design writes it back with its ramps, groups and steps', written && same(written.ramps, was.ramps) && written.swatches.length === was.swatches.length && kept2, written);
  check('the step Design changed is marked hand-edited', written?.swatches.find((w) => w.id === light.id)?.edited === true);
  await shell.takeBack('illustration');
  const back = stepsOf(il.get(), ramp).find((w) => w.id === light.id);
  check('Illustration takes it back with that step hand-edited', il.state().t === 'saved' && il.get().ramps.length === 2 && back?.edited === true && same(back.oklch, [0.8, 0.07, 60]), il.state());
  if (glossy) await shell.sendItem((await find((i) => i.id === glossy.itemId))!, 'design');
  check('Design goes back to its own palette', dd.source()?.itemId === glossy?.itemId && dd.state().t === 'saved', dd.state());

  // the painting: one gouache stroke, kept as a workspace PNG under the palette's id
  shell.setActive('illustration');
  patchIllustration({ tab: 'paint', canvas: { ...illustrationView().canvas, tool: 'paint', medium: 'dry' } });
  await paintEngineChecks(check);
  if (!check('Paint starts the painting engine', await until(() => liveEngine.get(), 10_000), host('illustration')?.querySelector('[role="alert"]')?.textContent)) return;
  if (!check('Paint shows the canvas', await stroke(0.5))) return;
  check('the stroke is on the canvas', await until(painted), liveEngine.get()?.state);
  check('and is saved under its palette', await until(() => illustrationView().paintings[id], 6000), illustrationView().paintings);
  for (const tab of ['light', 'check', 'paint'] as const) {
    patchIllustration({ tab });
    await sleep(50);
  }
  check('a tab switch keeps the painting: Paint, Light, Check, Paint', painted(), liveEngine.get()?.state);
  await paintUi(id);

  // an edit while Design holds the palette forks it: the painting stays on screen and goes with the fork
  await shell.sendItem(ref!, 'design');
  shell.setActive('illustration');
  il.transact('Add base colour', (d) => addRamp(d, [0.5, 0.1, 140]).doc);
  const fork = await until(() => (il.state().t === 'saved' && il.source()?.itemId !== id ? il.source() : null));
  check('an Illustration edit of a palette Design holds forks it into Scratch', fork?.collection === 'Scratch', il.state());
  await sleep(500); // a canvas that lost it would have cleared by now
  check('the painting stays on the canvas through the fork', painted(), liveEngine.get()?.state);
  check('and is kept under the fork, the original keeping its own', fork && (await until(() => illustrationView().paintings[fork.itemId], 6000)) && illustrationView().paintings[id], illustrationView().paintings);
  if (glossy) await shell.sendItem((await find((i) => i.id === glossy.itemId))!, 'design');

  // a new palette's first stroke: the quit, straight after this pass, must save it (the quiet pass looks)
  shell.setActive('illustration');
  patchIllustration({ check: 'vision' });
  await shell.newDoc('illustration');
  il.transact('Add base colours', (d) => addRamp(d, [0.62, 0.12, 40]).doc);
  const last = await until(() => (il.state().t === 'saved' ? il.source() : null));
  if (!check('a new Illustration palette for the last painting', last && last.itemId !== id && last.itemId !== fork?.itemId, il.state())) return;
  check('it lets the check chosen on the last palette go, so Check opens on its own first problem', await until(() => illustrationView().check === null), illustrationView().check);
  check('its canvas starts blank', await until(() => liveEngine.get()?.state.blank), liveEngine.get()?.state);
  await stroke(0.5);
  check('the last stroke is on the canvas', await until(painted), liveEngine.get()?.state);
  // not waited for: the save comes a second after the lift
  check('and not saved yet', !illustrationView().paintings[last!.itemId], illustrationView().paintings);
}

const paperCanvas = () => {
  const c = host('illustration')?.querySelector<HTMLCanvasElement>('canvas[aria-label^="Painting"]');
  return c && c.getBoundingClientRect().width > 0 ? c : null;
};
const frame = () => new Promise((r) => requestAnimationFrame(r));
/** the painting has paint on it (the engine knows: paper grain is not paint) */
const painted = () => liveEngine.get()?.state.blank === false;
const paint = () => paintSettings(illustrationView().canvas);
const setPaint = (patch: Partial<PaintSettings>) => patchIllustration({ canvas: { ...paint(), ...patch } });
const toastSays = (text: string) => toastStore.get().find((t) => !t.leaving && String(t.message).includes(text));

/** a pointer event on the paper at (x, y), 0..1 across it */
function pointer(canvas: HTMLCanvasElement, type: string, x: number, y: number): void {
  const r = canvas.getBoundingClientRect();
  canvas.dispatchEvent(
    new PointerEvent(type, { bubbles: true, cancelable: true, pointerId: 1, pointerType: 'mouse', isPrimary: true, button: type === 'pointermove' ? -1 : 0, buttons: type === 'pointerup' ? 0 : 1, clientX: r.left + x * r.width, clientY: r.top + y * r.height }),
  );
}

/** one horizontal stroke across the Illustration canvas at height `y` (0..1), lifted; false when it isn't showing */
async function stroke(y: number): Promise<boolean> {
  // the paper takes input once the engine is up and the palette's painting is on it
  const canvas = await until(() => (liveEngine.get() && !paperCanvas()?.hasAttribute('aria-disabled') ? paperCanvas() : null));
  if (!canvas) return false;
  pointer(canvas, 'pointerdown', 0.2, y);
  for (let i = 1; i <= 20; i++) {
    pointer(canvas, 'pointermove', 0.2 + i * 0.03, y);
    await sleep(16);
  }
  pointer(canvas, 'pointerup', 0.8, y);
  return true;
}

/** a hash of the paper as the canvas shows it */
function shownHash(canvas: HTMLCanvasElement): number {
  const px = new Uint32Array(canvas.getContext('2d')!.getImageData(0, 0, canvas.width, canvas.height).data.buffer);
  let h = 0;
  for (let i = 0; i < px.length; i++) h = (Math.imul(h, 31) + px[i]) | 0;
  return h;
}

/** a 1024 × 640 painting as the old canvas saved it: opaque, painted on white, a red square at 100..300 */
async function v1Painting(): Promise<Blob> {
  const c = new OffscreenCanvas(1024, 640);
  const ctx = c.getContext('2d')!;
  ctx.fillStyle = cssColor([1, 0, 0]);
  ctx.fillRect(0, 0, 1024, 640);
  ctx.fillStyle = cssColor([0.6, 0.2, 29]);
  ctx.fillRect(100, 100, 200, 200);
  return c.convertToBlob({ type: 'image/png' });
}

/**
 * The paint canvas's own UI (engine plan §5, §6): nothing on the paper changes after the lift, the
 * ring leaves with the pointer, the brush follows the palette and the tray, Try it, the canvas's
 * undo keys wherever the focus is, the tool bar on one line, Clear's Undo, and an old painting.
 */
async function paintUi(id: string): Promise<void> {
  const il = illustrationDoc();
  const e = liveEngine.get() as PaintEngine;
  const canvas = paperCanvas()!;
  const section = canvas.closest('section')!;
  const view = canvas.parentElement!;

  // the lift: the stroke as painted is the painting; not one more present, not one pixel different
  pointer(canvas, 'pointerdown', 0.2, 0.3);
  for (let i = 1; i <= 20; i++) pointer(canvas, 'pointermove', 0.2 + i * 0.03, 0.3 + (i % 5) * 0.01);
  for (let i = 0; i < 3; i++) await frame();
  pointer(canvas, 'pointerup', 0.8, 0.34);
  const [presents, shown] = [e.probe.presents, shownHash(canvas)];
  let frames = 0;
  let changed = 0;
  // 60 frames, or two seconds of them: a window that is never shown gets few
  for (const t0 = performance.now(); frames < 60 && performance.now() - t0 < 2000; frames++) {
    await frame();
    if (shownHash(canvas) !== shown) changed++;
  }
  check('after the lift nothing on the paper changes: no present, the same pixels', frames > 0 && e.probe.presents === presents && !changed, { frames, changed, presents: [presents, e.probe.presents] });
  check('and the stroke is one undo step', e.state.depth > 0 && !e.stroking, e.state);
  check('the ring leaves the fresh paint at the lift', view.querySelector<HTMLElement>('[data-ring]')?.hidden === true);

  // a ramp colour loads the brush, even the one already selected
  const step = host('illustration')?.querySelector<HTMLButtonElement>('[data-step]');
  step?.click();
  check('clicking a ramp colour loads it on the brush', step && (await until(() => paint().paint === `swatch:${step.dataset.step}`)), paint().paint);
  setPaint({ paint: 'hansa' });
  step?.click();
  check('and clicking it again, already selected, loads it again', step && (await until(() => paint().paint === `swatch:${step.dataset.step}`)), paint().paint);

  // the loaded paint unticked: the brush goes to its neighbour, says so, and stays there
  setPaint({ paint: 'ultra' });
  await sleep(50);
  const owned = illustrationView().owned;
  patchIllustration({ owned: owned.filter((x) => x !== 'ultra') });
  const moved = await until(() => paint().paint === 'phthaloB');
  check('unticking the loaded paint moves the brush to its neighbour, with a notice', moved && toastSays('Ultramarine Blue is off the tray, so the brush holds Phthalo Blue now.'), [paint().paint, toastStore.get().map((t) => String(t.message))]);
  patchIllustration({ owned });
  await sleep(50);
  check('re-ticking it leaves the brush where it went', paint().paint === 'phthaloB', paint().paint);

  // Try it: a recipe into the well and onto the brush; a mix it replaced comes back from the toast
  setPaint({ well: [{ id: 'hansa', parts: 1 }], paint: 'ultra', tool: 'smudge' });
  const tryIt = await until(() => [...(host('illustration')?.querySelectorAll('button') ?? [])].find((b) => b.textContent?.trim().endsWith('Try it') && shows(b)));
  tryIt?.click();
  const tried = await until(() => (paint().paint === 'well' && paint().tool === 'paint' && paint().well.length && paint().well[0].id !== 'hansa' ? paint().well : null));
  check('Try it puts the recipe in the well, loads it and switches to Paint', tried, paint());
  const back = toastSays('The well holds this recipe now.');
  if (back) toastStore.undo(back.id);
  check('and its Undo puts the mix that was there back', back && (await until(() => paint().well[0]?.id === 'hansa' && paint().paint === 'ultra')), paint());

  // the canvas's undo keys, with the focus on a tray chip and the pointer over the paper
  setPaint({ tool: 'paint' });
  await stroke(0.6);
  await until(() => !e.stroking);
  const depth = e.state.depth;
  const swatches = il.get().swatches.length;
  const history = il.depth();
  host('illustration')?.querySelector<HTMLElement>('[aria-label="Paints for the brush"] [tabindex="0"]')?.focus();
  view.dispatchEvent(new PointerEvent('pointerenter'));
  ctrlZ();
  const undone = await until(() => e.state.depth === depth - 1);
  check('Ctrl+Z over the paper undoes the stroke, with the focus on the tray; the palette is untouched', undone && il.get().swatches.length === swatches && il.depth() === history, [e.state, il.get().swatches.length, il.depth()]);
  ctrlY();
  check('and Ctrl+Y redoes it', await until(() => e.state.depth === depth && !e.state.redoDepth), e.state);
  view.dispatchEvent(new PointerEvent('pointerleave'));

  // the tool bar: one line at 1000px with the paint's name, and still one line at 724px
  const head = section.querySelector('header')!;
  const oneLine = () => {
    const r = head.getBoundingClientRect();
    const mid = r.top + r.height / 2;
    return r.height <= 36.5 && head.scrollWidth <= head.clientWidth + 1 && [...head.children].every((c) => Math.abs(c.getBoundingClientRect().top + c.getBoundingClientRect().height / 2 - mid) <= 2);
  };
  for (const w of [1000, 724]) {
    section.style.width = `${w}px`;
    const fits = await until(() => head.dataset.fit === (w >= 1000 ? 'full' : 'compact') && oneLine(), 5000);
    check(`the tool bar is one line at ${w}px`, fits && (w < 1000 || head.textContent?.includes('Ultramarine Blue')), [head.dataset.fit, head.getBoundingClientRect().height, head.scrollWidth, head.clientWidth]);
  }
  section.style.width = '';

  // Clear, then its toast's Undo: the painting comes back
  host('illustration')?.querySelector<HTMLButtonElement>('[aria-label="Clear the painting"]')?.click();
  (await until(() => button('illustration', 'Clear')))?.click();
  const cleared = await until(() => e.state.blank && toastSays('Painting cleared.'));
  if (cleared) toastStore.undo(cleared.id);
  check("Clear empties the paper and its toast's Undo brings the painting back", cleared && (await until(painted)) && !e.state.lastIsClear, e.state);

  // a painting saved by the old 1024 × 640 canvas loads upscaled onto the paper
  const keep = await e.snapshot();
  await e.load(await v1Painting());
  const [red, bare] = [await e.pick(400, 400), await e.pick(1600, 1000)];
  check('a 1024 × 640 painting loads upscaled: its paint where it was, its white as bare paper', !e.state.blank && red[0] > 0.5 && red[1] < 0.4 && bare.every((c) => c > 0.85), { red, bare });
  await e.load(keep);
  check('and the painting on the paper comes back', painted() && illustrationView().paintings[id], e.state);
}

/** the relaunch: nothing is touched; scripts/smoke.mjs checks no Library or workspace file changed */
async function quiet(): Promise<void> {
  await sleep(1500); // anything a restore wrongly writes lands before the quit
  for (const t of shell.getState().tools) {
    const doc = shell.doc(t.id);
    check(`${t.label}: no undo history`, doc.depth() === 0 && !doc.canRedo(), doc.depth());
    check(`${t.label}: its document came back`, JSON.stringify(doc.get()) !== JSON.stringify(t.createEmptyDoc()));
    if (!t.itemKind) continue;
    const src = doc.source();
    check(`${t.label}: still linked to its item`, src, doc.state());
    if (!src || doc.state().t !== 'saved') continue;
    const item = await api.invoke('library.read', src.itemId);
    const file = ('payload' in item ? item.payload : {}) as Record<string, unknown>;
    const body = t.toItem!(doc.get()) as Record<string, unknown>;
    check(`${t.label}: the document is its file`, Object.keys(body).every((k) => JSON.stringify(body[k]) === JSON.stringify(file[k])));
  }
  const prefs = shell.getState().settings;
  shell.setActive('design');
  check('the picker style and model chosen in the first pass came back', prefs?.pickerStyle === 'wheel' && prefs.pickerModel === 'rgb' && (await until(() => host('design')?.querySelector('[data-picker="wheel"]'), 5000)), [prefs?.pickerStyle, prefs?.pickerModel]);
  // the GIF comes back from the workspace, as it was left, and every frame dithers again
  const dt = ditherDoc();
  shell.setActive('dither');
  check('Dither: the GIF comes back with its six frames and its own timing', dt.get().source?.frames === 6 && dt.get().source?.delays?.length === 6, dt.get().source);
  const frames = await until(() => [0, 1, 2, 3, 4, 5].every((i) => ditherReady(dt.get(), i)), 20_000);
  check('Dither: and every frame dithers again', frames, ditherStatus.get());
  const id = illustrationDoc().source()?.itemId;
  check("Illustration: the quit saved the last stroke as its palette's painting", id && illustrationView().paintings[id], illustrationView().paintings);
  // showing a tool is no edit: smoke.mjs still finds every file as it was
  shell.setActive('illustration');
  check('Illustration: the painting comes back on the canvas', await until(painted, 10_000), liveEngine.get()?.state);
}
