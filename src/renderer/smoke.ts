// The smoke pass (spec §12), started by main.tsx when main passes --dt-smoke-run (`npm run smoke`
// runs scripts/smoke.mjs). It drives the real shell, IPC and Library in the smoke folder, reports
// each check, and hands the result to main (app.smokeDone), which quits through the close handshake.
// 'full' runs the smoke list; 'quiet' is the relaunch: it restores, checks, and quits with no input.
import { contrast, toHex, type Oklch } from '../shared/color/index.ts';
import type { DocController } from '../shared/doc-api.ts';
import { layoutLockup } from '../shared/logo/layout.ts';
import { PAPER } from '../shared/logo/sheet.ts';
import { lockupSvg } from '../shared/logo/svg.ts';
import type { Rect } from '../shared/logo/types.ts';
import { layoutTile, reachOf } from '../shared/pattern/layout.ts';
import { parseSize } from '../shared/svg/index.ts';
import type { LibraryItemRef, PatternPayload, Swatch, ToolId } from '../shared/types.ts';
import { saveFile, saveToFolder } from './lib/export.ts';
import { decodeImage } from './lib/load.ts';
import { shell } from './shell/core/index.ts';
import { select as selectInDesign } from './tools/design/actions.ts';
import { newSwatch as designSwatch, recolour as recolourInDesign, type DesignDoc } from './tools/design/doc.ts';
import { clearProposals, proposals } from './tools/design/proposals.ts';
import type { ImageDoc } from './tools/dev-image/index.ts';
import { addRamp, recolour, setSpec, stepsOf, type IllustrationDoc } from './tools/illustration/doc.ts';
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
const addSwatch = (doc: DocController<DesignDoc>, name: string) =>
  doc.transact('Add swatch', (d) => ({ ...d, swatches: [...d.swatches, designSwatch([0.6, 0.12, 40], name)] }));
/** a key as the keyboard sends it (to the focused element), so it goes through the keymap's routing (spec §8) */
const press = (key: string, o: KeyboardEventInit = {}) =>
  (document.activeElement ?? document.body).dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...o }));
const ctrlZ = () => press('z', { code: 'KeyZ', ctrlKey: true });
const ctrlY = () => press('y', { code: 'KeyY', ctrlKey: true });
const host = (id: ToolId) => document.querySelector<HTMLElement>(`[data-tool="${id}"]`);
/** the size of the image Dev image holds now */
async function imageSize(di: DocController<ImageDoc>): Promise<[number, number] | null> {
  const url = di.get().source?.url;
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
  check('Design, Illustration, Pattern, Logo and the dev image tool are registered, and nothing else', JSON.stringify(ids) === JSON.stringify(['design', 'illustration', 'pattern', 'logo', 'dev-image']), ids);
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

  // Send to between tools
  const di = shell.doc('dev-image') as DocController<ImageDoc>;
  await shell.sendDoc('design', 'dev-image');
  check('Send to: Design tints Dev image as one step', di.get().tints.length === 1 && di.depth() === 1, di.get().tints);
  const sent = toastStore.get().findLast((t) => t.icon === 'input');
  check('its toast has Undo and says nothing about Ctrl+Z', sent?.undo && !/Ctrl/.test(String(sent.message)), sent?.message);
  check('Ctrl+Z goes to that toast while Dev image shows', toast.activeCtrlZ()?.id === sent?.id);
  shell.setActive('design');
  check('and not once another tool shows', toast.activeCtrlZ()?.id !== sent?.id);
  shell.setActive('dev-image');
  check("the undo button's tooltip names the step", host('dev-image')?.querySelector('[aria-label^="Undo: "]')?.getAttribute('aria-label') === 'Undo: Tint from Untitled palette');
  await shell.sendItem(image, 'dev-image');
  check('Send to: the image opens in Dev image', di.get().source?.name === image.name, di.get().source);
  const il = illustrationDoc();
  const plain = il.get();
  clearBases();
  await shell.sendDoc('dev-image', 'illustration');
  const render = await find((i) => i.collection === 'Scratch' && i.kind === 'image');
  check('Send to: Dev image renders into Scratch and Illustration offers its colours as bases', render && shell.getState().active === 'illustration' && (bases.get()?.items.length ?? 0) > 0, bases.get()?.items.length);
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
  const out = await shell.tool('dev-image').render!(di.get(), {});
  const bytes = await out.blob.arrayBuffer();
  const saved = await saveFile({ tool: 'dev-image', suggestedName: 'smoke export', ext: 'png', filterName: 'PNG image', data: bytes });
  check('export.save writes into the smoke exports folder', saved?.startsWith(exports), saved);
  const files = [{ name: 'one.txt', data: 'one' }, { name: 'two.txt', data: 'two' }];
  const folder = await saveToFolder({ tool: 'design', files });
  check('export.toFolder writes every file there', folder?.written.length === 2 && folder.written.every((p) => p.startsWith(exports)), folder);

  await asImage(di);
  await fieldUndo(dp);
  const open = dp.source();
  if (check('Design still has its fork open', open && dp.state().t === 'saved', dp.state())) await outsideChange(dp, open!.itemId);
  await design(dir, image, di);
  await pattern(dir, palette, di);
  await logo(dir);
  await illustration();

  // left running, so the quit meets "Quit anyway?" (answered from --smoke-answer, no dialog) and the
  // pending delete is trashed after it (scripts/smoke.mjs checks both)
  void shell.runBusy(() => new Promise(() => {}));
}

/** spec §7.4 "as an image": an SVG at 4096 on its long side, a pattern tiled over a 4096 square */
async function asImage(di: DocController<ImageDoc>): Promise<void> {
  const svg = new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 100"><rect width="200" height="100"/></svg>');
  const mark = await api.invoke('library.createImage', 'Scratch', 'Smoke mark', 'svg', svg.buffer);
  await shell.sendItem(mark, 'dev-image');
  check('an SVG comes into Dev image at 4096 on its long side', JSON.stringify(await imageSize(di)) === '[4096,2048]', await imageSize(di));
  const tile = '<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64"><circle cx="32" cy="32" r="20"/></svg>';
  const pattern: PatternPayload = { kind: 'pattern', id: '', version: 1, preview: { svg: tile, tileWidth: 64, tileHeight: 64 } };
  const { ref } = await api.invoke('library.create', 'Scratch', 'Smoke tile', pattern);
  await shell.sendItem(ref, 'dev-image');
  check('a pattern comes in as a 4096 square of its tile', JSON.stringify(await imageSize(di)) === '[4096,4096]', await imageSize(di));
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

/** Colour › Design: open, edit, a contrast fix, Export ASE read back, Send to from Dev image (plan: Integrate) */
async function design(dir: string, image: LibraryItemRef, di: DocController<ImageDoc>): Promise<void> {
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

  // Export ASE through the Export module, then import the file back through the Library's reader
  const exportButton = [...(host('design')?.querySelectorAll('button') ?? [])].find((b) => b.textContent?.trim().endsWith('Export ASE'));
  if (!check('Design shows Export ASE', exportButton)) return;
  const shown = toastStore.get().length;
  exportButton!.click();
  const done = await until(() => toastStore.get().slice(shown).find((t) => t.icon === 'download'));
  const file = /^Exported (.+)\.$/.exec(String(done?.message ?? ''))?.[1];
  if (!check('Export ASE writes a file', file, done?.message)) return;
  await shell.importFiles([`${dir}\\exports\\${file}`], 'Reimport');
  const back = await find((i) => i.collection === 'Reimport' && i.kind === 'palette');
  const read = back && (await api.invoke('library.read', back.id));
  const got: Swatch[] = read?.kind === 'palette' ? read.payload.swatches : [];
  const want = dd.get().swatches;
  const same = got.length === want.length && want.every((w, i) => toHex(w.oklch) === toHex(got[i].oklch) && got[i].type === w.type && (!w.name || got[i].name === w.name));
  check('its read-back matches the palette (names, colours, global and spot)', same, got.map((w) => [w.name, w.type]));

  // New palette: one step to an empty, unlinked document; each first edit makes its own Scratch
  // palette (never writes over the last one); Undo goes back to the palette that was open
  const held = dd.source();
  const newWithSwatch = async (name: string) => {
    await shell.newDoc('design');
    const fresh = dd.get().swatches.length === 0 && !dd.source() && dd.undoLabel() === 'New palette';
    dd.transact('Add swatch', (d) => ({ ...d, swatches: [designSwatch([0.5, 0.1, 200], name)] }));
    const made = await until(() => dd.state().t === 'saved' && dd.source()?.collection === 'Scratch' && dd.source());
    return { fresh, id: made ? made.itemId : null };
  };
  const first = await newWithSwatch('Smoke new 1');
  const second = await newWithSwatch('Smoke new 2');
  check('New palette: an empty, unlinked document in one step', first.fresh && second.fresh);
  check('each New palette’s first edit makes its own Scratch item', first.id && second.id && first.id !== second.id && first.id !== held?.itemId && (await swatchCount(first.id)) === 1, [first.id, second.id]);
  for (let i = 0; i < 4; i++) ctrlZ();
  check('Undo goes back to the palette that was open', await until(() => dd.source()?.itemId === held?.itemId && dd.state().t === 'saved'), dd.source());

  // Send to Design from Dev image: proposals, the document untouched (untinted, so its four colours show)
  await shell.sendItem(image, 'dev-image');
  di.transact('Clear tints', (d) => ({ ...d, tints: [] }));
  clearProposals();
  const doc = dd.get();
  const steps = dd.depth();
  await shell.sendDoc('dev-image', 'design');
  const ghosts = proposals.get();
  check('Send to Design from Dev image proposes its colours', shell.getState().active === 'design' && (ghosts?.items.length ?? 0) >= 2, ghosts?.items.length);
  check('and leaves the document and its history alone', dd.get() === doc && dd.depth() === steps && di.depth() > 0, [dd.depth(), steps]);
  const sent = toastStore.get().findLast((t) => t.icon === 'input');
  check('its toast offers no Undo (there is no step)', sent && !sent.undo, sent?.message);
  clearProposals();
}

/** a tool's Export button in the row named `row`, then the file it wrote, read back through the Library (import copies it in) */
async function toolExport(dir: string, tool: ToolId, collection: string): Promise<(row: string) => Promise<Response | null>> {
  await shell.createCollection(collection);
  return async (row) => {
    const button = [...(host(tool)?.querySelectorAll('button') ?? [])].find((b) => b.textContent?.trim().endsWith('Export') && b.parentElement?.querySelector('b')?.textContent === row);
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
 * its DPI, Surprise me leaves shapes and colours alone, and Dev image takes the pattern as an image.
 */
async function pattern(dir: string, palette: LibraryItemRef, di: DocController<ImageDoc>): Promise<void> {
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

  // Send to: Dev image takes the pattern as a 4096 square of its tile; over a background, not one clear pixel at a seam
  const name = (await find((i) => i.id === id))?.name;
  await shell.sendDoc('pattern', 'dev-image');
  const url = di.get().source?.url;
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
    'Send to: Dev image receives the pattern as an image, a 4096 square with no gap at the seams',
    shell.getState().active === 'dev-image' && di.get().source?.name === name && bmp?.width === 4096 && bmp.height === 4096 && after.background && clear === 0,
    [di.get().source?.name, name, bmp?.width, bmp?.height, clear],
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

/**
 * One wet stroke; how many times the canvas changes once the brush lifts (unit D: the settled wash
 * swaps in once). Counted in frames, not time: the smoke window is never shown, so its frames come
 * about once a second, and the settle runs a slice a frame.
 */
async function settleSwaps(y: number): Promise<number | null> {
  const canvas = await until(() => {
    const c = host('illustration')?.querySelector<HTMLCanvasElement>('canvas[aria-label^="Painting"]');
    return c && c.getBoundingClientRect().width > 0 ? c : null;
  });
  if (!canvas) return null;
  const ctx = canvas.getContext('2d')!;
  const sum = () => {
    const px = new Uint32Array(ctx.getImageData(0, 0, canvas.width, canvas.height).data.buffer);
    let h = 0;
    for (let i = 0; i < px.length; i++) h = (Math.imul(h, 31) + px[i]) | 0;
    return h;
  };
  const frame = () => new Promise((r) => requestAnimationFrame(r));
  const r = canvas.getBoundingClientRect();
  const pointer = (type: string, x: number) =>
    canvas.dispatchEvent(
      new PointerEvent(type, { bubbles: true, cancelable: true, pointerId: 1, pointerType: 'mouse', isPrimary: true, button: type === 'pointermove' ? -1 : 0, buttons: type === 'pointerup' ? 0 : 1, clientX: r.left + x * r.width, clientY: r.top + y * r.height }),
    );
  pointer('pointerdown', 0.2);
  for (let i = 1; i <= 20; i++) pointer('pointermove', 0.2 + i * 0.03);
  // the stroke as painted, all on screen; then the lift
  for (let i = 0; i < 3; i++) await frame();
  let last = sum();
  pointer('pointerup', 0.8);
  // until it has changed and then held still for 5 frames (a settle drawn as it goes changes every frame)
  let changes = 0;
  let still = 0;
  for (let n = 0; n < 120 && (!changes || still < 5); n++) {
    await frame();
    const now = sum();
    still = now === last ? still + 1 : 0;
    if (now !== last) changes++;
    last = now;
  }
  return changes;
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
  patchIllustration({ lower: 'paint', canvas: { ...illustrationView().canvas, tool: 'paint', medium: 'dry' } });
  if (!check('Paint shows the canvas', await stroke(0.5))) return;
  check('the stroke is on the canvas', await until(() => paintedPixels() > 500), paintedPixels());
  check('and is saved under its palette', await until(() => illustrationView().paintings[id], 6000), illustrationView().paintings);
  patchIllustration({ canvas: { ...illustrationView().canvas, medium: 'wet' } });
  // the brush reads its medium from the last render
  await until(() => host('illustration')?.querySelector('[role="radio"][aria-label^="Wet"]')?.getAttribute('aria-checked') === 'true');
  const swaps = await settleSwaps(0.75);
  check('a wet stroke changes nothing on the canvas after the lift but the one settled wash', swaps === 1, swaps);
  patchIllustration({ canvas: { ...illustrationView().canvas, medium: 'dry' } });

  // an edit while Design holds the palette forks it: the painting stays on screen and goes with the fork
  await shell.sendItem(ref!, 'design');
  shell.setActive('illustration');
  il.transact('Add base colour', (d) => addRamp(d, [0.5, 0.1, 140]).doc);
  const fork = await until(() => (il.state().t === 'saved' && il.source()?.itemId !== id ? il.source() : null));
  check('an Illustration edit of a palette Design holds forks it into Scratch', fork?.collection === 'Scratch', il.state());
  await sleep(500); // a canvas that lost it would have cleared by now
  check('the painting stays on the canvas through the fork', paintedPixels() > 500, paintedPixels());
  check('and is kept under the fork, the original keeping its own', fork && (await until(() => illustrationView().paintings[fork.itemId], 6000)) && illustrationView().paintings[id], illustrationView().paintings);
  if (glossy) await shell.sendItem((await find((i) => i.id === glossy.itemId))!, 'design');

  // a new palette's first stroke: the quit, straight after this pass, must save it (the quiet pass looks)
  shell.setActive('illustration');
  await shell.newDoc('illustration');
  il.transact('Add base colours', (d) => addRamp(d, [0.62, 0.12, 40]).doc);
  const last = await until(() => (il.state().t === 'saved' ? il.source() : null));
  if (!check('a new Illustration palette for the last painting', last && last.itemId !== id && last.itemId !== fork?.itemId, il.state())) return;
  check('its canvas starts blank', await until(() => paintedPixels() === 0), paintedPixels());
  await stroke(0.5);
  check('the last stroke is on the canvas', await until(() => paintedPixels() > 500), paintedPixels());
  // not waited for: the save comes a second after the paint settles
  check('and not saved yet', !illustrationView().paintings[last!.itemId], illustrationView().paintings);
}

/** one horizontal stroke across the Illustration canvas at height `y` (0..1); false when it isn't showing */
async function stroke(y: number): Promise<boolean> {
  const canvas = await until(() => {
    const c = host('illustration')?.querySelector<HTMLCanvasElement>('canvas[aria-label^="Painting"]');
    return c && c.getBoundingClientRect().width > 0 ? c : null;
  });
  if (!canvas) return false;
  const r = canvas.getBoundingClientRect();
  const pointer = (type: string, x: number) =>
    canvas.dispatchEvent(
      new PointerEvent(type, { bubbles: true, cancelable: true, pointerId: 1, pointerType: 'mouse', isPrimary: true, button: type === 'pointermove' ? -1 : 0, buttons: type === 'pointerup' ? 0 : 1, clientX: r.left + x * r.width, clientY: r.top + y * r.height }),
    );
  pointer('pointerdown', 0.2);
  for (let i = 1; i <= 20; i++) {
    pointer('pointermove', 0.2 + i * 0.03);
    await sleep(16);
  }
  pointer('pointerup', 0.8);
  return true;
}

/** the painting's pixels on the Illustration canvas that aren't blank paper */
function paintedPixels(): number {
  const c = host('illustration')?.querySelector<HTMLCanvasElement>('canvas[aria-label^="Painting"]');
  if (!c) return 0;
  const px = c.getContext('2d')!.getImageData(0, 0, c.width, c.height).data;
  let n = 0;
  for (let i = 0; i < px.length; i += 4) if (px[i] < 235 || px[i + 1] < 235 || px[i + 2] < 235) n++;
  return n;
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
  const id = illustrationDoc().source()?.itemId;
  check("Illustration: the quit saved the last stroke as its palette's painting", id && illustrationView().paintings[id], illustrationView().paintings);
  // showing a tool is no edit: smoke.mjs still finds every file as it was
  shell.setActive('illustration');
  check('Illustration: the painting comes back on the canvas', await until(() => paintedPixels() > 500, 10_000), paintedPixels());
}
