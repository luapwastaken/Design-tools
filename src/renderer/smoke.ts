// The smoke pass (spec §12), started by main.tsx when main passes --dt-smoke-run (`npm run smoke`
// runs scripts/smoke.mjs). It drives the real shell, IPC and Library in the smoke folder, reports
// each check, and hands the result to main (app.smokeDone), which quits through the close handshake.
// 'full' runs the smoke list; 'quiet' is the relaunch: it restores, checks, and quits with no input.
import { contrast, toHex, type Oklch } from '../shared/color/index.ts';
import type { DocController } from '../shared/doc-api.ts';
import type { LibraryItemRef, PatternPayload, Swatch, ToolId } from '../shared/types.ts';
import { saveFile, saveToFolder } from './lib/export.ts';
import { decodeImage } from './lib/load.ts';
import { shell } from './shell/core/index.ts';
import { select as selectInDesign } from './tools/design/actions.ts';
import { newSwatch as designSwatch, recolour as recolourInDesign, type DesignDoc } from './tools/design/doc.ts';
import { clearProposals, proposals } from './tools/design/proposals.ts';
import type { ImageDoc } from './tools/dev-image/index.ts';
import { addRamp, recolour, setSpec, stepsOf, type IllustrationDoc } from './tools/illustration/doc.ts';
import { clearProposals as clearBases, proposals as bases } from './tools/illustration/proposals.ts';
import { getView as illustrationView, patchView as patchIllustration } from './tools/illustration/view-state.ts';
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
  check('Design, Illustration and the dev image tool are registered, and nothing else', JSON.stringify(ids) === JSON.stringify(['design', 'illustration', 'dev-image']), ids);
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
