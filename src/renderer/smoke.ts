// The smoke pass (spec §12), started by main.tsx when main passes --dt-smoke-run (`npm run smoke`
// runs scripts/smoke.mjs). It drives the real shell, IPC and Library in the smoke folder, reports
// each check, and hands the result to main (app.smokeDone), which quits through the close handshake.
// 'full' runs the smoke list; 'quiet' is the relaunch: it restores, checks, and quits with no input.
import { contrast, cssColor, deltaE, parseCss, rgb255, toHex, type Oklch } from '../shared/color/index.ts';
import { PNG_FORMAT, SVG_FORMAT } from '../shared/clipboard.ts';
import { greyMatrix, holdValue, LUMA, valueOf } from '../shared/color/value.ts';
import { PIGMENTS } from '../shared/paint/pigments.ts';
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
import { rgbaPng } from './lib/png.ts';
import { shell } from './shell/core/index.ts';
import { select as selectInDesign } from './tools/design/actions.ts';
import { newSwatch as designSwatch, recolour as recolourInDesign, type DesignDoc } from './tools/design/doc.ts';
import { clearProposals, proposals } from './tools/design/proposals.ts';
import { results as designResults } from './tools/design/results.ts';
import { armed as armedInDesign, getView as designView, patchView as patchDesign } from './tools/design/view-state.ts';
import { used, type DitherDoc } from './tools/dither/doc.ts';
import { lookOf as ditherLook, withLook } from './tools/dither/looks.ts';
import { dithered, ready as ditherReady, type Result } from './tools/dither/pipeline.ts';
import { patchView as patchDither, status as ditherStatus } from './tools/dither/view-state.ts';
import { emptyDoc as halftoneEmpty, mapInk, opaqueOf, spotInk, type HalftoneDoc } from './tools/halftone/doc.ts';
import { lookOf, Painter } from './tools/halftone/draw.ts';
import { platesFor, pngBlob, svgFor } from './tools/halftone/exports.ts';
import { ready, screen, shownDots, svgOver, totals } from './tools/halftone/screening.ts';
import { patchView as patchHalftone, status as halftoneStatus } from './tools/halftone/view-state.ts';
import { addRamp, recolour, setSpec, stepsOf, type IllustrationDoc } from './tools/illustration/doc.ts';
import type { PaintEngine } from './tools/illustration/paint/index.ts';
import { liveEngine, liveSaves } from './tools/illustration/paint/live.ts';
import { paintEngineChecks } from './tools/illustration/paint/smoke-checks.ts';
import { washColour } from './tools/illustration/paint/wash.ts';
import { loadedOf, paintSettings, type PaintSettings } from './tools/illustration/paint-sources.ts';
import { isEmpty as noParts, lockupOf, shownLockups, type LogoDoc } from './tools/logo/doc.ts';
import { faviconBundle, sheetSvg } from './tools/logo/files.ts';
import { partFromImage, partFromSvg } from './tools/logo/intake.ts';
import { pngSize } from './tools/logo/geometry.ts';
import { drawSvg } from './tools/logo/raster.ts';
import { getView as logoView, patchView as patchLogo } from './tools/logo/view-state.ts';
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
import { LEAVE_MS, toastStore, type ToastEntry } from './ui/toast.ts';

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
/** the Export row a button sits in, by the row's name */
const rowOf = (b: Element) => b.closest('[data-row]')?.getAttribute('data-row');
const shows = (el: Element | null | undefined) => !!el && el.getClientRects().length > 0;
/** a tool's showing button whose text ends with `text` (an icon's name comes first) */
const button = (id: ToolId, text: string) => [...(host(id)?.querySelectorAll('button') ?? [])].find((b) => b.textContent?.trim().endsWith(text) && shows(b));
/** a tab of Illustration's tabbed section, by its id */
const illusTab = (id: string) => host('illustration')?.querySelector<HTMLButtonElement>(`[role="tab"][data-tab="${id}"]`) ?? null;
/** Illustration's Check pane that shows: its problem rows, and the count the Check values tab carries */
function problemPane(): { rows: number; fixes: number; badge: number } | null {
  const pane = [...(host('illustration')?.querySelectorAll('section[aria-label="Problems"]') ?? [])].find(shows);
  if (!pane) return null;
  return {
    rows: pane.querySelectorAll('[data-icon="error"]').length,
    fixes: pane.querySelectorAll('button').length,
    badge: Number(illusTab('check')?.textContent?.match(/\d+/)?.[0] ?? 0),
  };
}
/** Design's doc-bar Generate (its label carries the Space key hint after it) */
const generateButton = () => [...(host('design')?.querySelectorAll('button') ?? [])].find((b) => b.textContent?.trim().startsWith('Generate') && shows(b));
/** one of Design's tabs (the strip under the palette), and the panel it shows */
const designTab = (id: string) => host('design')?.querySelector<HTMLElement>(`[role="tab"][data-tab="${id}"]`);
const designPanel = () => host('design')?.querySelector<HTMLElement>('[role="tabpanel"]');
/** Design's Colour picker section */
const pickerSection = () => [...(host('design')?.querySelectorAll('section') ?? [])].find((sec) => sec.querySelector('h2')?.textContent === 'Colour picker');
/** a menu row that shows, by its text */
const menuRow = (text: string) => [...document.querySelectorAll<HTMLElement>('[role="menuitem"]')].find((r) => r.textContent?.includes(text) && shows(r));
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
  // navigator.clipboard is the one way left for the page to reach Luap's real clipboard (the Copy buttons go through main's memory fake)
  const allowed = async (name: string) => (await navigator.permissions.query({ name: name as PermissionName })).state;
  const clip = [await allowed('clipboard-read'), await allowed('clipboard-write')];
  check('a test run refuses the page the system clipboard (navigator.clipboard reads and writes)', clip.every((s) => s === 'denied'), clip);

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
  check('an empty Design palette shows the start screen with Generate in the doc bar', (await until(() => generateButton())) && !!host('design')?.textContent?.includes('Start a palette'), designView().tab);
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
  // the render's wait has no known length: static text with no icon (brief §8), gone once the picture is saved
  const waits: ToastEntry[] = [];
  const offWait = toastStore.subscribe(() => waits.push(...toastStore.get().filter((t) => /full-size picture/.test(String(t.message)) && !waits.some((w) => w.id === t.id))));
  await shell.sendDoc('dither', 'illustration');
  offWait();
  check('Send to says its render is under way in plain text with no icon, and takes it down when the picture is saved', waits.length === 1 && !waits[0].icon && !toastStore.get().some((t) => t.id === waits[0].id && !t.leaving), waits);
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
  const out = await shell.tool('dither').render!(dt.get());
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
  await greyscale();

  // brief §8: nothing loops, and there is no spinner to run: no running animation repeats, and no loaded
  // stylesheet holds an @keyframes rule
  const loops = document.getAnimations().filter((a) => a.effect?.getComputedTiming().iterations === Infinity);
  const keyframes = [...document.styleSheets].flatMap((sheet) => {
    try {
      return [...sheet.cssRules].filter((rule) => rule instanceof CSSKeyframesRule).map((rule) => (rule as CSSKeyframesRule).name);
    } catch {
      return [];
    }
  });
  check('nothing loops: no animation repeats and no stylesheet has @keyframes', !loops.length && !keyframes.length, [loops.length, keyframes]);

  // left running, so the quit meets "Quit anyway?" (answered from --smoke-answer, no dialog) and the
  // pending delete is trashed after it (scripts/smoke.mjs checks both)
  void shell.runBusy(() => new Promise(() => {}));
}

/**
 * The greyscale view: the button in each colour tool's palette header and the key G toggle the one
 * app-wide setting, which puts data-greyscale on the root; every content colour (data-colour) is
 * greyed by the dt-grey filter, chrome never. Left ON at the end: the quiet relaunch checks it came back.
 */
async function greyscale(): Promise<void> {
  const root = document.documentElement;
  const on = () => root.dataset.greyscale === 'true';
  const pref = () => shell.getState().settings?.greyscale === true;
  const filterOf = (el: Element | null | undefined) => (el ? getComputedStyle(el).filter : '');
  // the tabs and the tool as they are left: the relaunch restores them (Paint's canvas only loads while its tab shows)
  const [was, designTabWas, illustrationTabWas] = [shell.getState().active, designView().tab, illustrationView().tab];
  check('greyscale starts off', !pref() && !on());

  // the filter in the page: a saturated colour through it lands on its value (the luma of its 8-bit channels), to one step
  const [src, dst] = [0, 1].map(() => document.createElement('canvas').getContext('2d', { willReadFrequently: true })!);
  const saturated: [string, number[]][] = [['red', [255, 0, 0]], ['yellow', [255, 212, 0]], ['blue', [0, 48, 255]], ['magenta', [255, 0, 204]]];
  const missed = saturated.flatMap(([name, rgb]) => {
    src.putImageData(new ImageData(new Uint8ClampedArray([...rgb, 255]), 1, 1), 0, 0);
    dst.clearRect(0, 0, 1, 1);
    dst.filter = 'url(#dt-grey)';
    dst.drawImage(src.canvas, 0, 0);
    const [r, g, b] = dst.getImageData(0, 0, 1, 1).data;
    const want = LUMA[0] * rgb[0] + LUMA[1] * rgb[1] + LUMA[2] * rgb[2];
    return [r, g, b].every((c) => Math.abs(c - want) <= 1) ? [] : [[name, [r, g, b], want]];
  });
  check('the dt-grey filter turns red, yellow, blue and magenta into their value (Rec. 709 luma), within one 8-bit step', missed.length === 0, missed);
  const matrix = document.querySelector('#dt-grey feColorMatrix')?.getAttribute('values');
  check('and its matrix is the one value.ts builds, in sRGB', matrix === greyMatrix() && document.querySelector('#dt-grey')?.getAttribute('color-interpolation-filters') === 'sRGB', matrix);

  for (const id of ['design', 'illustration'] as const) {
    shell.setActive(id);
    patchIllustration({ tab: 'settings' });
    await sleep(120);
    const tool = host(id)!;
    const btn = await until(() => tool.querySelector<HTMLButtonElement>('button[aria-label="Greyscale"]'), 3000);
    if (!check(`${id}: the palette header has a Greyscale button`, btn && shows(btn) && btn.getAttribute('aria-pressed') === 'false', btn?.outerHTML.slice(0, 120))) continue;
    const content = [...tool.querySelectorAll<HTMLElement>('[data-colour]')].filter(shows);
    const chrome = [btn!, tool.querySelector('h2'), ...tool.querySelectorAll('[role="tab"]')].filter((e): e is Element => !!e);
    btn!.click();
    check(`${id}: the button turns greyscale on, latched, and puts data-greyscale on the root`, (await until(() => pref() && on())) && btn!.getAttribute('aria-pressed') === 'true', [pref(), root.dataset.greyscale]);
    check(`${id}: every content colour on show is greyed and no chrome is`, content.length >= 3 && content.every((e) => filterOf(e).includes('dt-grey')) && chrome.every((e) => filterOf(e) === 'none'), [content.length, content.filter((e) => !filterOf(e).includes('dt-grey')).length, chrome.filter((e) => filterOf(e) !== 'none').length]);
    press('g', { code: 'KeyG' });
    check(`${id}: G turns it off again`, (await until(() => !pref() && !on())) && btn!.getAttribute('aria-pressed') === 'false' && content.every((e) => filterOf(e) === 'none'), [pref(), root.dataset.greyscale]);
    press('g', { code: 'KeyG' });
    check(`${id}: and G turns it on`, !!(await until(() => pref() && on())) && btn!.getAttribute('aria-pressed') === 'true');
    btn!.click();
    await until(() => !pref());
  }
  // one grey: the Seen as and See as lenses have the colour-vision lenses only
  const lensOptions = async (id: ToolId, label: string) => {
    shell.setActive(id);
    // a Select names itself by aria-label, or by the inspector row it sits in
    const named = (b: HTMLButtonElement) => b.getAttribute('aria-label')?.startsWith(label) || b.parentElement?.parentElement?.firstElementChild?.textContent === label;
    const lens = await until(() => [...(host(id)?.querySelectorAll<HTMLButtonElement>('button') ?? [])].find((b) => named(b) && shows(b)), 3000);
    const before = new Set(document.querySelectorAll('[role^="menuitem"], [role="option"]'));
    lens?.click();
    const rows = await until(() => {
      const now = [...document.querySelectorAll('[role^="menuitem"], [role="option"]')].filter((r) => !before.has(r)).map((r) => r.textContent?.trim() ?? '');
      return now.length ? now : null;
    });
    press('Escape');
    await sleep(80);
    return rows;
  };
  patchIllustration({ tab: 'settings' });
  const seen = await lensOptions('illustration', 'Seen as');
  check('Illustration’s Seen as lens offers the colour-vision lenses and no Greyscale', !!seen && seen.some((t) => /Deuteranopia/.test(t)) && !seen.some((t) => /Greyscale/i.test(t)), seen);
  patchDesign({ tab: 'preview' });
  const see = await lensOptions('design', 'See as');
  check('Design’s See as lens offers the colour-vision lenses and no Greyscale', !!see && see.some((t) => /Deutan/.test(t)) && !see.some((t) => /Greyscale/i.test(t)), see);
  patchDesign({ tab: designTabWas });
  patchIllustration({ tab: illustrationTabWas });
  shell.setActive(was);

  // left on: the setting is saved, the quiet relaunch finds it
  press('g', { code: 'KeyG' });
  check('greyscale is left on for the relaunch', !!(await until(() => pref() && on())));
  check('and was saved', (await until(async () => (await api.invoke('settings.get')).greyscale === true)) === true);
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

  // the tabs under the palette: Check palette carries the count of what is left to look at (Smoke text on Smoke ground)
  patchDesign({ tab: 'check' });
  const checkTab = await until(() => (/\d+/.test(designTab('check')?.textContent ?? '') && designPanel()?.textContent?.includes('Protanopia') ? designTab('check') : null));
  const checkText = designPanel()?.textContent ?? '';
  check('the Check palette tab counts what is left to look at and shows vision, value and print', !!checkTab && ['Typical vision', 'Protanopia', 'Deuteranopia', 'Tritanopia', 'Rec. 709 luma', 'Print inks'].every((w) => checkText.includes(w)), [checkTab?.textContent, checkText.slice(0, 120)]);
  patchDesign({ tab: 'contrast' });

  const inDesign = (id: string) => dd.get().swatches.find((w) => w.id === id);
  const fixButton = await until(() =>
    [...(designPanel()?.querySelectorAll('button') ?? [])].find((b) => /^(Lift|Darken) to L/.test(b.textContent ?? '') && b.parentElement?.textContent?.includes('Smoke text on Smoke ground')),
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

  // + Add > Paste codes: a popover anchored to the menu, live parse, Add makes proposals on the artboard
  clearProposals();
  button('design', 'Add colours')?.click();
  const pasteRow = await until(() => menuRow('Paste codes'));
  if (check('the + Add menu offers Paste codes', pasteRow)) {
    pasteRow!.click();
    const box = await until(() => document.querySelector<HTMLTextAreaElement>('[role="dialog"][aria-label="Paste codes"] textarea[aria-label="Colours to parse"]'));
    if (check('Paste codes opens a popover with its field', box)) {
      type(box!, 'Smoke Ember: E8643C');
      const addPasted = await until(() => [...(box!.closest('[role="dialog"]')?.querySelectorAll('button') ?? [])].find((b) => b.textContent?.trim().startsWith('Add') && !b.disabled));
      addPasted?.click();
      check('Add in the popover proposes the pasted colour in the palette row and closes the popover', (await until(() => proposals.get()?.items.length === 1)) && (await until(() => !document.querySelector('[role="dialog"][aria-label="Paste codes"]'))) && !!host('design')?.querySelector('[data-ghost]'), proposals.get()?.items.length);
    }
  }
  clearProposals();

  // the tabs: each one shows its own panel, the palette and the picker stay, and the choice is saved with the workspace
  const tabsOk: [string, string][] = [['contrast', 'role pairs'], ['check', 'Protanopia'], ['preview', ''], ['harmonies', 'Harmonies of']];
  for (const [id, word] of tabsOk) {
    designTab(id)?.click();
    const shown = await until(() => designView().tab === id && designTab(id)?.getAttribute('aria-selected') === 'true' && (word ? designPanel()?.textContent?.includes(word) : host('design')?.querySelector('[role="img"][aria-label*="website preview"]')));
    check(`the ${id} tab shows its panel with the palette and the picker still there`, !!shown && !!host('design')?.querySelector('[role="listbox"]') && !!pickerSection(), [id, designView().tab]);
  }
  check('the chosen tab is saved in the workspace view', (shell.view('design') as { tab?: string } | undefined)?.tab === 'harmonies', shell.view('design'));
  // arrows move along the strip, one Tab stop
  designTab('harmonies')?.focus();
  press('ArrowLeft');
  check('the arrow keys move along the tab strip', (await until(() => designView().tab === 'preview')) && designTab('preview')?.tabIndex === 0 && designTab('harmonies')?.tabIndex === -1, designView().tab);
  patchDesign({ tab: 'contrast' });

  // the two seams: drag, persist, double-click resets, arrows; the sections follow
  const sep = (label: string) => host('design')?.querySelector<HTMLElement>(`[role="separator"][aria-label="${label}"]`) ?? null;
  const sizeOf = (sec: Element | null | undefined) => sec?.getBoundingClientRect();
  const paletteSec = () => host('design')?.querySelector('[role="listbox"]')?.closest('section');
  const dragHandle = (el: HTMLElement, dx: number, dy: number) => {
    const r = el.getBoundingClientRect();
    const [x, y] = [r.left + r.width / 2, r.top + r.height / 2];
    const fire = (type: string, mx: number, my: number) =>
      el.dispatchEvent(new PointerEvent(type, { bubbles: true, cancelable: true, pointerId: 7, pointerType: 'mouse', isPrimary: true, button: type === 'pointermove' ? -1 : 0, buttons: type === 'pointerup' ? 0 : 1, clientX: mx, clientY: my }));
    // a synthetic pointer is no active pointer, so capture would throw: stand in for it for this one gesture
    const capture = el.setPointerCapture;
    el.setPointerCapture = () => {};
    try {
      fire('pointerdown', x, y);
      fire('pointermove', x + dx / 2, y + dy / 2);
      fire('pointermove', x + dx, y + dy);
      fire('pointerup', x + dx, y + dy);
    } catch (e) {
      return String(e);
    } finally {
      el.setPointerCapture = capture;
    }
    return null;
  };
  patchDesign({ paletteH: 300, pickerW: 480, tab: 'contrast' });
  await until(() => sep('Palette height'));
  const h0 = sizeOf(paletteSec())?.height ?? 0;
  const dragErr = dragHandle(sep('Palette height')!, 0, 80);
  check('dragging the Palette seam down makes the palette taller and saves it', !dragErr && (await until(() => designView().paletteH === 380)) && (sizeOf(paletteSec())?.height ?? 0) >= h0 + 70 && (shell.view('design') as { paletteH?: number } | undefined)?.paletteH === 380, [dragErr, h0, designView().paletteH, sizeOf(paletteSec())?.height]);
  sep('Palette height')!.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
  check('double-click resets the palette height', (await until(() => designView().paletteH === 300)) && Math.abs((sizeOf(paletteSec())?.height ?? 0) - h0) < 2, designView().paletteH);
  sep('Palette height')!.focus();
  press('ArrowDown');
  check('the arrow keys move the palette seam', await until(() => designView().paletteH === 310), designView().paletteH);
  patchDesign({ paletteH: 300 });
  const w0 = sizeOf(pickerSection())?.width ?? 0;
  const dragErr2 = dragHandle(sep('Colour picker width')!, 60, 0);
  check('dragging the picker seam right widens the Colour picker and saves it', !dragErr2 && (await until(() => designView().pickerW === 540)) && (sizeOf(pickerSection())?.width ?? 0) >= w0 + 50 && (shell.view('design') as { pickerW?: number } | undefined)?.pickerW === 540, [dragErr2, w0, designView().pickerW, sizeOf(pickerSection())?.width]);
  sep('Colour picker width')!.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
  check('double-click resets the picker width', await until(() => designView().pickerW === 560), designView().pickerW);

  // the palette header: Surround and Show, the L C H readout, Table, and the chip's hover More button
  const selectBtn = (lead: string) => [...(host('design')?.querySelectorAll<HTMLElement>('button') ?? [])].find((b) => (b.getAttribute('aria-label') ?? '').startsWith(`${lead}:`));
  const stage = () => host('design')?.querySelector<HTMLElement>('[role="listbox"]')?.parentElement;
  const anyRow = (text: string) => [...document.querySelectorAll<HTMLElement>('[role="option"],[role="menuitem"],[role="menuitemradio"]')].find((r) => r.textContent?.includes(text) && shows(r) && !r.hasAttribute('data-swatch'));
  check('the Palette header carries Surround and Show', !!selectBtn('Surround') && !!selectBtn('Show'));
  patchDesign({ surround: 'plain', chipData: 'hex' });
  const plainBg = getComputedStyle(stage()!).backgroundColor;
  selectBtn('Surround')?.click();
  (await until(() => anyRow('18% grey')))?.click();
  check('choosing 18% grey puts the palette on that surround (saved)', (await until(() => designView().surround === 'grey')) && getComputedStyle(stage()!).backgroundColor !== plainBg, [designView().surround, plainBg]);
  patchDesign({ surround: 'ground' });
  check('the Ground surround shows the palette’s own background', (await until(() => getComputedStyle(stage()!).backgroundColor !== plainBg)) && designView().surround === 'ground');
  patchDesign({ surround: 'plain' });
  const tileText = () => host('design')?.querySelector('[role="listbox"] [data-swatch]')?.textContent ?? '';
  check('Hex only shows no L C H', !/L \d/.test(tileText()) && !tileText().includes('CMYK'), tileText());
  selectBtn('Show')?.click();
  (await until(() => anyRow('Hex + L C H')))?.click();
  check('Hex + L C H puts the lightness, chroma and hue on every chip', (await until(() => designView().chipData === 'lch')) && /L \d/.test(tileText()) && /C \.?\d/.test(tileText()) && /H \d/.test(tileText()), tileText());
  patchDesign({ chipData: 'table' });
  check('Table adds RGB and ≈CMYK to every chip', await until(() => tileText().includes('RGB') && tileText().includes('≈CMYK')), tileText());
  patchDesign({ chipData: 'hex' });
  const moreBtn = host('design')?.querySelector<HTMLElement>('[role="listbox"] [data-swatch] button[aria-label="More"]');
  moreBtn?.click();
  const dup = await until(() => menuRow('Duplicate'));
  check('the chip’s More button opens the same menu as a right-click', !!moreBtn && !!dup && !!menuRow('Copy hex') && !!menuRow('Delete'));
  press('Escape');
  await until(() => !menuRow('Duplicate'));

  // the tints strip sits in the Colour picker section; a click adds a tint
  const nBefore = dd.get().swatches.length;
  const tintBtn = pickerSection()?.querySelector<HTMLElement>('button[aria-label^="Add a tint"]');
  tintBtn?.click();
  check('a tint in the Colour picker section adds a colour in one step', !!tintBtn && dd.get().swatches.length === nBefore + 1 && dd.undoLabel() === 'Add tint', dd.undoLabel());
  ctrlZ();
  check('and undoes', dd.get().swatches.length === nBefore);

  // Contrast: the ratio gauge, the specimen and the badge's tooltip; the tab badge counts failures
  patchDesign({ tab: 'contrast' });
  const live = designResults(dd.get().swatches, dd.get().ramps, designView().flagL, designView().flagE);
  await until(() => designPanel()?.textContent?.includes('Body 12'));
  check('Contrast rows carry the Body 12 / Label 11 specimen and a log-scale gauge', !!designPanel()?.textContent?.includes('Body 12') && !!designPanel()?.textContent?.includes('Label 11') && (designPanel()?.querySelectorAll('[class*="gauge"]').length ?? 0) > 0);
  const badgeNum = (id: string) => Number(designTab(id)?.textContent?.match(/\d+/)?.[0] ?? 0);
  check('the Contrast tab counts contrast failures and Check palette only its own problems', badgeNum('contrast') === live.failing.length && badgeNum('check') === live.toLookAt - live.failing.length, [badgeNum('contrast'), live.failing.length, badgeNum('check'), live.toLookAt]);

  // Check palette: the verdict list (problems first), colour-vision detail, the Value ruler, Print inks
  patchDesign({ tab: 'check' });
  await until(() => designPanel()?.querySelector('[data-verdict]'));
  const ids = [...(designPanel()?.querySelectorAll('[data-verdict]') ?? [])].map((e) => e.getAttribute('data-verdict'));
  const rank = (x: { ok?: boolean }) => (x.ok === false ? 0 : x.ok === undefined ? 1 : 2);
  const wantIds = [...live.verdicts].sort((a, b) => rank(a) - rank(b)).map((x) => x.id);
  check('the Check palette tab lists a verdict per check, problems first', ids.length === 4 && ids.join() === wantIds.join(), [ids, wantIds]);
  const panelText = designPanel()?.textContent ?? '';
  check('colour vision names the closest pair and its ΔE for every simulation, and the names sit over the strips', (panelText.match(/ΔE \d/g)?.length ?? 0) >= 4 && /closest pair|look alike/.test(panelText) && !!designPanel()?.querySelector('[aria-hidden="true"] span'), panelText.slice(0, 200));
  check('the Print inks table shows without a click (P3, all four libraries)', ['P3', 'Riso ΔE', 'RAL ΔE', 'HKS ΔE', 'NCS ΔE'].every((w) => panelText.includes(w)) && ![...(designPanel()?.querySelectorAll('button') ?? [])].some((b) => b.textContent?.trim() === 'Inks'));
  // two colours of one value make the ruler flag them with a Spread fix
  // (a palette of just those two and a far dark and light, so they are the one collision)
  const twin = [designSwatch(holdValue(0.45, 0.1, 10), 'Smoke twin A'), designSwatch(holdValue(0.47, 0.1, 200), 'Smoke twin B')];
  const keep = dd.get().swatches;
  dd.transact('Twins', (d) => ({ ...d, swatches: [designSwatch([0.1, 0.02, 40], 'Smoke dark'), ...twin, designSwatch([0.95, 0.02, 90], 'Smoke light')] }));
  const spreadBtn = await until(() => [...(designPanel()?.querySelectorAll('button') ?? [])].find((b) => /^Spread /.test(b.textContent ?? '')));
  check('the Value ruler pins every colour by value (V readouts) and flags the collision with its gap and a Spread fix', !!spreadBtn && !!designPanel()?.textContent?.includes('Rec. 709 luma') && /Smoke twin A \d+\.\d/.test(designPanel()?.textContent ?? '') && /sit \d+\.\d apart/.test(designPanel()?.textContent ?? ''), designPanel()?.textContent?.match(/Smoke twin A.{0,80}apart/)?.[0]);
  const spreadDepth = dd.depth();
  spreadBtn?.click();
  const [ta, tb] = twin.map((w) => valueOf(dd.get().swatches.find((x) => x.id === w.id)!.oklch));
  check('Spread apart is one step and parts them in value', dd.depth() === spreadDepth + 1 && Math.abs(ta - tb) > 0.05, [ta, tb]);
  ctrlZ();
  ctrlZ();
  check('two undos take the spread and the twins back', dd.get().swatches === keep);
  patchDesign({ tab: 'contrast' });

  // Notes: a tab only while the file has any, not part of the picker section
  check('without notes there is no Notes tab', !designTab('notes'));
  dd.transact('Notes', (d) => ({ ...d, notes: 'Smoke note from the file' }));
  const notesTab = await until(() => designTab('notes'));
  notesTab?.click();
  check('a file with notes gets a Notes tab that shows them, and the picker section no longer does', !!notesTab && !!(await until(() => designPanel()?.textContent?.includes('Smoke note from the file'))) && !pickerSection()?.textContent?.includes('Smoke note'), designView().tab);
  dd.transact('Clear the notes', (d) => ({ ...d, notes: '' }));
  check('clearing the notes removes the tab', await until(() => !designTab('notes')));
  patchDesign({ tab: 'contrast' });

  // Gradient: while its stops are the ones proposed, a changed setting updates them live
  clearProposals();
  button('design', 'Add colours')?.click();
  (await until(() => menuRow('Gradient between two')))?.click();
  const gradPop = () => document.querySelector<HTMLElement>('[role="dialog"][aria-label="Gradient between two"]');
  const propose = await until(() => [...(gradPop()?.querySelectorAll('button') ?? [])].find((b) => b.textContent?.trim().startsWith('Propose')));
  propose?.click();
  const firstStops = proposals.get()?.items.map((p) => p.oklch.join()).join('|');
  button('design', 'Add colours')?.click();
  (await until(() => menuRow('Gradient between two')))?.click();
  const lab = await until(() => [...(gradPop()?.querySelectorAll<HTMLElement>('[role="radio"]') ?? [])].find((b) => b.textContent?.includes('OKLab')));
  lab?.click();
  check('changing the gradient settings updates the proposed stops live', !!firstStops && (await until(() => proposals.get()?.from === 'gradient' && proposals.get()?.items.map((p) => p.oklch.join()).join('|') !== firstStops)), [firstStops, proposals.get()?.items.length]);
  press('Escape');
  await until(() => !gradPop());
  patchDesign({ space: 'oklch' });
  clearProposals();

  // Generate's settings are one click away on the caret beside it: Style, Colours and Seed in a popover
  host('design')?.querySelector<HTMLElement>('button[aria-label^="Generate settings"]')?.click();
  const genPop = await until(() => document.querySelector<HTMLElement>('[role="dialog"][aria-label="Generate settings"]'));
  check('the caret beside Generate opens Style, Colours and Seed', !!genPop && ['Style', 'Colours', 'Seed'].every((w) => [...genPop.querySelectorAll('button, input')].some((e) => (e.getAttribute('aria-label') ?? e.textContent ?? '').includes(w))), genPop?.textContent);
  press('Escape');
  await until(() => !document.querySelector('[role="dialog"][aria-label="Generate settings"]'));

  // the document switcher: a caret after the title lists the recent palettes and opens one as the Library does
  const caret = () => host('design')?.querySelector<HTMLElement>('button[aria-label^="Switch palette"]');
  caret()?.click();
  const switchRows = await until(() => {
    const r = [...document.querySelectorAll<HTMLElement>('[role="menuitemradio"]')];
    return r.length >= 3 ? r : null;
  });
  const switchTexts = (switchRows ?? []).map((r) => r.textContent ?? '');
  const recentRows = (switchRows ?? []).filter((r) => !r.textContent?.includes('Open Library'));
  check('the title’s caret lists at most 8 recent palettes with their strips, the current one marked, then Open Library…', !!switchRows && recentRows.length >= 2 && recentRows.length <= 8 && switchTexts.at(-1)?.includes('Open Library') === true && recentRows.every((r) => !!r.querySelector('i')) && recentRows.filter((r) => r.getAttribute('aria-checked') === 'true').length === 1, switchTexts);
  const other = recentRows.find((r) => r.getAttribute('aria-checked') !== 'true');
  const heldItem = dd.source()?.itemId;
  other?.click();
  check('choosing another palette opens it as the Library does (the other item)', !!other && (await until(() => dd.source()?.itemId !== undefined && dd.source()?.itemId !== heldItem && dd.state().t === 'saved')), [heldItem, dd.source()?.itemId]);
  shell.toggleLibrary(false);
  caret()?.click();
  const libRow = await until(() => [...document.querySelectorAll<HTMLElement>('[role="menuitemradio"]')].find((r) => r.textContent?.includes('Open Library')));
  libRow?.click();
  check('Open Library… opens the Library drawer', !!libRow && (await until(() => shell.getState().libraryOpen)), shell.getState().libraryOpen);
  shell.toggleLibrary(false);
  // back to the palette the rest of the pass uses
  if (heldItem) await shell.openItem((await find((i) => i.id === heldItem))!);
  await until(() => dd.source()?.itemId === heldItem && dd.state().t === 'saved');

  // ≈CMYK's four fields fit their values (100 on a black) in the picker's Sliders style
  const black = designSwatch([0, 0, 0], 'Smoke black');
  dd.transact('Add black', (d) => ({ ...d, swatches: [...d.swatches, black] }));
  selectInDesign([black.id]);
  await shell.setPicker({ pickerStyle: 'sliders', pickerModel: 'cmyk' });
  const inputs = () => [...(pickerSection()?.querySelectorAll<HTMLInputElement>('input') ?? [])].filter(shows);
  const cut = await until(() => (inputs().filter((i) => i.value === '100').length >= 1 ? inputs().filter((i) => i.scrollWidth > i.clientWidth).map((i) => i.value) : null));
  check('≈CMYK’s fields fit 100% in the picker section', cut && cut.length === 0, cut ?? inputs().map((i) => i.value));
  // every value is typable: the Square style shows name, hex, HSB and RGB as fields of their own
  await shell.setPicker({ pickerStyle: 'square', pickerModel: 'hsb' });
  const typable = await until(() => {
    const n = inputs().length;
    return n >= 8 ? n : null;
  });
  check('the picker section has fields for name, hex, HSB and RGB', !!typable, inputs().length);
  ctrlZ();
  check('and Ctrl+Z takes the black back out', !dd.get().swatches.some((w) => w.id === black.id));

  // the picker style is one app-wide setting: the picker header's switch is saved (the relaunch pass looks)
  const wheel = [...(pickerSection()?.querySelectorAll<HTMLElement>('[role="radio"]') ?? [])].find((r) => r.textContent === 'Wheel');
  wheel?.click();
  await shell.setPicker({ pickerModel: 'rgb' });
  const prefs = await api.invoke('settings.get');
  check('the picker header’s Wheel switch draws the wheel and saves it, as the model is saved', wheel && (await until(() => host('design')?.querySelector('[data-picker="wheel"]'))) && prefs.pickerStyle === 'wheel' && prefs.pickerModel === 'rgb', [prefs.pickerStyle, prefs.pickerModel]);

  // New palette: one step to an empty, unlinked document that opens on the start screen; each first edit makes
  // its own Scratch palette (never writes over the last one); Undo goes back to the palette that was open
  const held = dd.source();
  patchDesign({ tab: 'preview' });
  const newWithSwatch = async (name: string) => {
    await shell.newDoc('design');
    const fresh = dd.get().swatches.length === 0 && !dd.source() && dd.undoLabel() === 'New palette' && !!(await until(() => generateButton() && host('design')?.textContent?.includes('Start a palette')));
    dd.transact('Add swatch', (d) => ({ ...d, swatches: [designSwatch([0.5, 0.1, 200], name)] }));
    const made = await until(() => dd.state().t === 'saved' && dd.source()?.collection === 'Scratch' && dd.source());
    return { fresh, id: made ? made.itemId : null };
  };
  const first = await newWithSwatch('Smoke new 1');
  const second = await newWithSwatch('Smoke new 2');
  check('New palette: an empty, unlinked document in one step, open on the start screen', first.fresh && second.fresh);
  check('each New palette’s first edit makes its own Scratch item', first.id && second.id && first.id !== second.id && first.id !== held?.itemId && (await swatchCount(first.id)) === 1, [first.id, second.id]);
  for (let i = 0; i < 4; i++) ctrlZ();
  check('Undo goes back to the palette that was open', await until(() => dd.source()?.itemId === held?.itemId && dd.state().t === 'saved'), dd.source());
  patchDesign({ tab: 'contrast' });

  // Space generates (never while a text field has focus); an empty palette is made in one step, roles
  // suggested; on a palette with colours Space adds proposals beside it and moves nothing
  await shell.newDoc('design');
  clearProposals();
  (document.activeElement as HTMLElement | null)?.blur?.();
  patchDesign({ count: 5, locked: [] });
  const typing = document.createElement('input');
  typing.type = 'text';
  host('design')?.appendChild(typing);
  typing.focus();
  press(' ', { code: 'Space' });
  const idle = dd.get().swatches.length === 0 && !proposals.get();
  typing.remove();
  check('Space is ignored while a text field has focus', idle);
  (document.activeElement as HTMLElement | null)?.blur?.();
  press(' ', { code: 'Space' });
  const made = (await until(() => dd.get().swatches.length === 5 && dd.get().swatches)) || null;
  check('Space on an empty palette makes the palette in one step, with roles suggested', made && dd.undoLabel() === 'Generate palette' && made.some((w) => w.role === 'Background') && made.some((w) => w.role === 'Text'), dd.undoLabel());
  const pin = made ? made[1] : null;
  if (pin) {
    selectInDesign([pin.id]);
    press('l', { code: 'KeyL' });
    check('L locks the selected column (its lock stays visible)', designView().locked.includes(pin.id) && !!(await until(() => host("design")?.querySelector(`[data-swatch="${pin.id}"] button[aria-pressed="true"]`))), designView().locked);
    const steps = dd.depth();
    const frame = () => ['[role="listbox"]', '[role="tablist"]'].map((q) => host('design')?.querySelector(q)?.getBoundingClientRect()).map((r) => [r?.top, r?.height]);
    const before = JSON.stringify(frame());
    press(' ', { code: 'Space' });
    check('Space on a palette with colours adds proposals in the row and leaves the palette alone', (await until(() => host('design')?.querySelector('[data-ghost]'))) && (proposals.get()?.items.length ?? 0) === 5 && dd.depth() === steps && JSON.stringify(dd.get().swatches) === JSON.stringify(made), [dd.depth() - steps, proposals.get()?.items.length]);
    check('and nothing around the row moves', JSON.stringify(frame()) === before, [before, JSON.stringify(frame())]);
    const first = proposals.get()?.items.map((p) => p.oklch.join());
    press(' ', { code: 'Space' });
    check('Space again replaces the proposals with a new set', (await until(() => proposals.get()?.items.map((p) => p.oklch.join()).join('|') !== first?.join('|'))) && dd.depth() === steps, dd.depth() - steps);
    press('Delete', { code: 'Delete' });
    check('Delete leaves a locked column alone (no confirm arms)', !!dd.get().swatches.find((w) => w.id === pin.id) && !armedInDesign.get());
    clearProposals();
    patchDesign({ locked: [] });
  }

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

/** the doc bar's Export button of a tool (its one primary: the inspector's Export group has no button) */
const barExport = (tool: ToolId) => [...(host(tool)?.querySelectorAll('button') ?? [])].find((b) => b.textContent?.trim() === 'Export' && shows(b));
/** a row of the Export menu that shows, by the start of its text */
const exportItem = (label: string) => [...document.querySelectorAll<HTMLElement>('[role="menu"] [role="menuitem"]')].find((r) => r.textContent?.trim().startsWith(label) && shows(r));
/** open the tool's Export menu and take the row `label`; the row (null if it never showed or is off) is clicked */
async function chooseExport(tool: ToolId, label: string): Promise<boolean> {
  const bar = await until(() => (barExport(tool) && !(barExport(tool) as HTMLButtonElement).disabled ? barExport(tool) : null));
  if (!bar) return false;
  bar.click();
  const row = await until(() => exportItem(label));
  if (!row || row.getAttribute('aria-disabled') === 'true') return false;
  row.click();
  return true;
}

/** a tool's Export menu row `label`, then the file it wrote, read back through the Library (import copies it in) */
async function toolExport(dir: string, tool: ToolId, collection: string): Promise<(label: string) => Promise<Response | null>> {
  await shell.createCollection(collection);
  return async (label) => {
    const shown = toastStore.get().length;
    const idle = shell.getState().busy;
    if (!(await chooseExport(tool, label))) return null;
    // from the click, before anything is rendered: the quit check and the status bar count it
    check(`${tool}'s ${label} export counts as running work from the moment it starts`, shell.getState().busy > idle, shell.getState().busy);
    const done = await until(() => toastStore.get().slice(shown).find((t) => t.icon === 'download'));
    const file = /^Exported (.+)\.$/.exec(String(done?.message ?? ''))?.[1];
    if (!file) return null;
    await shell.importFiles([`${dir}\\exports\\${file}`], collection);
    const ref = await until(() => find((i) => i.collection === collection && `${i.name}.${i.ext}` === file));
    const item = ref && (await api.invoke('library.read', ref.id));
    return item && 'url' in item ? fetch(item.url) : null;
  };
}

/**
 * A tool's Copy button in the row named `row`, pressed: what the memory clipboard then holds (a test
 * run never writes the system one) and what the toast said. Counts as running work like an export.
 */
async function toolCopy(tool: ToolId, row: string): Promise<{ held: Record<string, ArrayBuffer>; said: string } | null> {
  // a Copy menu row in the doc bar's Export (Logo's is a button in its Export group)
  const button = row.startsWith('Copy')
    ? null
    : await until(() => [...(host(tool)?.querySelectorAll('button') ?? [])].find((b) => b.textContent?.trim().endsWith('Copy') && !b.disabled && rowOf(b) === row));
  if (!button && !row.startsWith('Copy')) return null;
  // the same plain notice isn't shown twice while it still shows (and a test window is never focused, so none times out)
  for (const t of toastStore.get()) if (t.icon === 'content_copy') toast.dismiss(t.id);
  await sleep(LEAVE_MS + 60);
  const shown = toastStore.get().length;
  const idle = shell.getState().busy;
  if (button) button.click();
  else if (!(await chooseExport(tool, row))) return null;
  check(`${tool}'s ${row} copy counts as running work from the moment it starts`, shell.getState().busy > idle, shell.getState().busy);
  const done = await until(() => toastStore.get().slice(shown).find((t) => t.icon === 'content_copy'), 20_000);
  return done ? { held: await api.invoke('clipboard.peek'), said: String(done.message) } : null;
}

const utf8 = (b: ArrayBuffer | undefined) => (b ? new TextDecoder().decode(b) : '');
const formats = (held: Record<string, ArrayBuffer>) => JSON.stringify(Object.keys(held).sort());
const sameBytes = (a: ArrayBuffer, b: ArrayBuffer) => {
  const [x, y] = [new Uint8Array(a), new Uint8Array(b)];
  return x.length === y.length && x.every((v, i) => v === y[i]);
};
/** markup as an XML document's root element, or null when it doesn't parse */
function svgRoot(markup: string): Element | null {
  const doc = new DOMParser().parseFromString(markup, 'image/svg+xml');
  return doc.querySelector('parsererror') ? null : doc.documentElement;
}
/** a copied PNG read back: size, colour type (6 is RGBA) and the lowest and highest alpha of its pixels */
async function pngAlpha(bytes: ArrayBuffer | undefined): Promise<{ w: number; h: number; colour: number; min: number; max: number; img: { w: number; h: number; px: Uint8ClampedArray } } | null> {
  if (!bytes) return null;
  const img = await pixelsOf(new Blob([bytes], { type: 'image/png' }));
  let [min, max] = [255, 0];
  for (let i = 3; i < img.px.length; i += 4) {
    min = Math.min(min, img.px[i]);
    max = Math.max(max, img.px[i]);
  }
  return { w: img.w, h: img.h, colour: new Uint8Array(bytes)[25], min, max, img };
}
const PNG_COPY = JSON.stringify(['image/png', PNG_FORMAT].sort());

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
  const swatch = await exported('Illustrator swatch (SVG)');
  const swatchText = swatch && (await swatch.text());
  const svg = swatchText ? new DOMParser().parseFromString(swatchText, 'image/svg+xml').documentElement : null;
  if (!check('Export writes the Illustrator swatch', svg?.nodeName === 'svg')) return;
  const copied = await toolCopy('pattern', 'Copy the swatch SVG');
  check(
    'Copy puts the swatch SVG on the clipboard as text and as image/svg+xml: the file’s own markup, and it parses',
    copied && copied.said === 'Copied the SVG.' && formats(copied.held) === JSON.stringify(['text/plain', SVG_FORMAT].sort()) && utf8(copied.held['text/plain']) === swatchText && utf8(copied.held[SVG_FORMAT]) === swatchText && svgRoot(utf8(copied.held['text/plain']))?.nodeName === 'svg',
    copied && [copied.said, Object.keys(copied.held)],
  );
  const artboardCopy = await toolCopy('pattern', 'Copy the artboard SVG');
  check('Copy on the artboard puts its SVG on the clipboard, shapes and all', artboardCopy && svgRoot(utf8(artboardCopy.held['text/plain']))?.querySelectorAll('use, path, circle, rect, g').length, artboardCopy && Object.keys(artboardCopy.held));
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
  const board = await exported('Artboard (SVG)');
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
  // the doc bar's Export is a menu of every format, and their copies
  [...(host('pattern')?.querySelectorAll('button') ?? [])].find((b) => b.textContent?.trim() === 'Export' && !b.closest('[data-row]'))?.click();
  const formatsShown = await until(() => {
    const l = [...document.querySelectorAll('[role="menu"] [role="menuitem"]')].map((x) => x.textContent?.trim() ?? '');
    return l.length ? l : null;
  });
  check(
    'the doc bar’s Export opens a menu of the swatch, the artboard and the PNG, with the two SVG copies',
    !!formatsShown && ['Illustrator swatch', 'Artboard', 'PNG'].every((n) => formatsShown.some((l) => l.includes(n))) && formatsShown.filter((l) => l.includes('Copy')).length === 2,
    formatsShown,
  );
  press('Escape');
  check('the arrangement is chosen in the options bar, as pictograms: four of them', document.querySelectorAll('[data-tool="pattern"] [role="toolbar"] [role="radio"]').length >= 4);

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
  check('an SVG goes into Logo as the icon first', label() === 'ICON', label());
  await shell.sendItem(padded, 'logo');
  const made = await until(() => (ld.state().t === 'saved' ? ld.source() : null));
  if (!check('the first Logo edit makes a logo in Scratch', made?.collection === 'Scratch', made ?? ld.state())) return;
  const file = await until(async () => {
    const item = await api.invoke('library.read', made!.itemId).catch(() => null);
    return item?.kind === 'logo' ? item.payload : null;
  });
  check('its file holds the icon and a preview that draws it', file?.icon?.includes('<circle') && /<circle/.test(file.preview.svg) && !/<image/.test(file.preview.svg), file?.preview.svg.slice(0, 160));
  check('the next SVG goes in as the wordmark', label() === 'WORDMARK', label());
  await shell.sendItem(word, 'logo');
  const d = ld.get();
  const t = d.wordmark?.type;
  check('the wordmark comes in with its cap height and baseline, found from its letters', t && Math.abs(t.capTop) < 1.5 && Math.abs(t.baseline - 100) < 1.5, t);
  const on = shownLockups(d).map((l) => l.kind);
  check('the pair proposes horizontal and stacked, the horizontal aligned on the capitals', on.includes('horizontal') && on.includes('stacked') && lockupOf(d, 'horizontal').align === 'cap', on);

  // the pasteboard: every lockup that's on is a named artboard, a click selects, the eye turns one off,
  // the doc bar's Version switch and the Sheet toggle in the view strip are views of the same document
  patchLogo({ mode: 'edit', lockup: 'horizontal', version: 'original' });
  const boards = () => [...(host('logo')?.querySelectorAll<SVGElement>('[data-artboard]') ?? [])];
  const kinds = async () => (await until(() => (boards().length === on.length ? boards().map((b) => b.dataset.artboard) : null))) ?? boards().map((b) => b.dataset.artboard);
  check('every lockup that is on is an artboard on the pasteboard, in the document order', JSON.stringify(await kinds()) === JSON.stringify(on), [await kinds(), on]);
  const board = (k: string) => boards().find((b) => b.dataset.artboard === k);
  board('stacked')?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  check('clicking an artboard selects it', await until(() => logoView().lockup === 'stacked' && board('stacked')?.getAttribute('aria-checked') === 'true'), logoView().lockup);
  const eye = () => host('logo')?.querySelector<HTMLButtonElement>('[data-lockup="stacked"] button[aria-label^="Hide"]');
  eye()?.click();
  check('the eye in Lockups turns a lockup off, and it leaves the pasteboard', await until(() => !lockupOf(ld.get(), 'stacked').on && !board('stacked')), lockupOf(ld.get(), 'stacked'));
  ld.undo();
  check('and Undo brings it back', await until(() => lockupOf(ld.get(), 'stacked').on && !!board('stacked')), lockupOf(ld.get(), 'stacked'));
  const docbar = () => host('logo')?.querySelector<HTMLElement>('[data-docbar]') ?? host('logo');
  const version = (name: string) => [...(docbar()?.querySelectorAll<HTMLButtonElement>('[role="radio"]') ?? [])].find((b) => b.textContent?.trim() === name);
  version('Black')?.click();
  check('the doc bar switch chooses the version every artboard shows', await until(() => logoView().version === 'black'), logoView().version);
  version('Original')?.click();
  const sheetToggle = () => [...(host('logo')?.querySelectorAll<HTMLButtonElement>('[role="checkbox"]') ?? [])].find((b) => b.textContent?.trim() === 'Sheet');
  sheetToggle()?.click();
  check('Sheet in the view strip shows every lockup in every version', await until(() => logoView().mode === 'sheet' && host('logo')?.querySelector('[aria-label="Every lockup in every version"]')), logoView().mode);
  sheetToggle()?.click();
  check('and turning it off is the pasteboard again', await until(() => logoView().mode === 'edit' && boards().length === on.length), logoView().mode);

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
  patchLogo({ mode: 'edit', lockup: 'horizontal', version: 'black', dpi: 300, scope: 'view' });
  if (!check('Logo shows its Export group', await until(() => host('logo')?.querySelector('[data-asset="SVG"]') && host('logo')?.querySelector('[data-asset="Favicon bundle"]')))) return;
  // Export is one list of ticked assets and the doc bar's primary button: each row is exported on its own here
  await shell.createCollection('Logo out');
  const only = (row: string) => patchLogo({ assets: { svg: row === 'SVG', png: row === 'PNG', favicon: row === 'Favicon bundle', sheet: false } });
  // the one primary Export is the doc bar's: it makes whatever the group has ticked
  const goButton = () => barExport('logo') as HTMLButtonElement | undefined;
  const exported = async (row: string): Promise<Response | null> => {
    only(row);
    const button = await until(() => (goButton() && !goButton()!.disabled ? goButton() : null));
    if (!button) return null;
    const shown = toastStore.get().length;
    const idle = shell.getState().busy;
    button.click();
    check(`logo's ${row} export counts as running work from the moment it starts`, shell.getState().busy > idle, shell.getState().busy);
    const done = await until(() => toastStore.get().slice(shown).find((t) => t.icon === 'download'));
    const file = /^Exported (.+)\.$/.exec(String(done?.message ?? ''))?.[1];
    if (!file) return null;
    await shell.importFiles([`${dir}\\exports\\${file}`], 'Logo out');
    const ref = await until(() => find((i) => i.collection === 'Logo out' && `${i.name}.${i.ext}` === file));
    const item = ref && (await api.invoke('library.read', ref.id));
    return item && 'url' in item ? fetch(item.url) : null;
  };
  const vector = await (await exported('SVG'))?.text();
  check(
    'the exported lockup SVG is its parts as paths in black fills: no filter, no <image>, no colour left over',
    vector && /<circle/.test(vector) && /<path/.test(vector) && /fill="#000000"/.test(vector) && !/filter/.test(vector) && !/<image/.test(vector) && ![NAVY, AMBER, INK].some((c) => vector.toLowerCase().includes(c)),
    vector?.slice(0, 240),
  );
  const copiedLogo = await toolCopy('logo', 'SVG');
  check(
    'Copy puts the lockup SVG on the clipboard as text and as image/svg+xml: the exported markup, and it parses',
    copiedLogo && vector && copiedLogo.said === 'Copied the SVG.' && formats(copiedLogo.held) === JSON.stringify(['text/plain', SVG_FORMAT].sort()) && utf8(copiedLogo.held['text/plain']) === vector && utf8(copiedLogo.held[SVG_FORMAT]) === vector && svgRoot(vector)?.nodeName === 'svg',
    copiedLogo && [copiedLogo.said, Object.keys(copiedLogo.held)],
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
  only('Favicon bundle');
  (await until(() => (goButton() && !goButton()!.disabled ? goButton() : null)))?.click();
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

  // Copy PNG on clear paper (the paper left out): a PNG with alpha, clear between the dots and solid in them
  patchHalftone({ pngWidth: 360 });
  hd.transact('Paper left out', (x) => ({ ...x, paper: { ...x.paper, include: false } }));
  const copiedDots = await toolCopy('halftone', 'Copy the PNG');
  const dots = await pngAlpha(copiedDots?.held['image/png']);
  check(
    'Copy puts the screen PNG on the clipboard as the PNG format and as image/png, the same bytes: RGBA, 360 px wide, clear paper and solid dots',
    copiedDots && dots && copiedDots.said === 'Copied the PNG.' && formats(copiedDots.held) === PNG_COPY && sameBytes(copiedDots.held[PNG_FORMAT], copiedDots.held['image/png']) && dots.colour === 6 && dots.w === 360 && dots.min === 0 && dots.max > 128,
    dots && copiedDots && [copiedDots.said, Object.keys(copiedDots.held), dots.colour, dots.w, dots.min, dots.max],
  );
  hd.undo();
  patchHalftone({ pngWidth: 2048 });

  // the separations, through the doc bar's Export menu; smoke runs write them into exports/halftone
  const before = toastStore.get().length;
  await chooseExport('halftone', 'Separations');
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
  const want = await pixelsOf((await shell.tool('halftone').render!(d)).blob);
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
  const copiedDither = await toolCopy('dither', 'Copy the PNG');
  const copiedPixels = await pngAlpha(copiedDither?.held['image/png']);
  check(
    'Copy puts the PNG on the clipboard as the PNG format and as image/png: RGBA, the file’s 96 × 64 px, every pixel its block’s colour in the view',
    copiedDither && copiedPixels && copiedDither.said === 'Copied the PNG.' && formats(copiedDither.held) === PNG_COPY && copiedPixels.colour === 6 && offBlocks(copiedPixels.img, r!, 8) === 0 && copiedPixels.min === 255,
    copiedPixels && [copiedPixels.w, copiedPixels.h, copiedPixels.colour, copiedPixels.min],
  );

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
  await chooseExport('dither', 'PNG frames');
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
  const rendered = async () => new Uint8Array(await (await shell.tool('dither').render!(dt.get())).blob.arrayBuffer()).join();
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

  // the Original view showing, another picture opened: the view drew the old picture's bitmap after
  // it was closed and stopped ("image source is detached")
  patchDither({ show: 'original' });
  await sleep(600);
  paste(await pngFrom(40, 30, (x, y) => [x * 6, y * 8, 90]));
  const third = await until(() => (dt.get().source !== two ? dt.get().source : null));
  await sleep(1200);
  check('with Original showing, opening another picture leaves the view working', third && !shell.getState().crashed.dither && host('dither')?.querySelector('canvas') !== null, [third?.name, shell.getState().crashed.dither]);
  // and Undo across that open, still on Original, brings the earlier picture back the same way
  dt.undo();
  await sleep(1200);
  check('Undo of that open, with Original showing, leaves the view working too', dt.get().source === two && !shell.getState().crashed.dither, [dt.get().source?.name, shell.getState().crashed.dither]);
  patchDither({ show: 'result' });
  await shown();

  // Send to Halftone: the dithered PNG, each block the pixel size
  const hd = shell.doc('halftone') as DocController<HalftoneDoc>;
  await shell.sendDoc('dither', 'halftone');
  const hs = hd.get().source;
  const got = hs && (await pixelsOf(await (await fetch(hs.asset)).blob()));
  check('Send to Halftone: it opens the dithered PNG at the export size, every block as the view has it', shell.getState().active === 'halftone' && r2 && got && offBlocks(got, r2, 2) === 0, [hs?.name, got?.w, got?.h, got && r2 && offBlocks(got, r2, 2)]);

  await shell.sendItem(anim, 'dither');
}

const postfxDoc = () => shell.doc('postfx') as DocController<PostFxDoc>;

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

/** a PNG's RGBA bytes as stored (a canvas would premultiply them); only for the files lib/png writes: filter none or Up */
async function rawRgba(png: Blob): Promise<{ w: number; h: number; px: Uint8Array } | null> {
  const b = new Uint8Array(await png.arrayBuffer());
  const v = new DataView(b.buffer);
  const [w, h] = [v.getUint32(16), v.getUint32(20)];
  const idat: Uint8Array[] = [];
  for (let at = 8; at < b.length; at += 12 + v.getUint32(at)) if (String.fromCharCode(...b.subarray(at + 4, at + 8)) === 'IDAT') idat.push(b.subarray(at + 8, at + 8 + v.getUint32(at)));
  const raw = new Uint8Array(await new Response(new Blob(idat as BlobPart[]).stream().pipeThrough(new DecompressionStream('deflate'))).arrayBuffer());
  const row = w * 4;
  const px = new Uint8Array(w * h * 4);
  for (let y = 0; y < h; y++) {
    const filter = raw[y * (row + 1)];
    if (filter !== 0 && filter !== 2) return null;
    for (let i = 0; i < row; i++) px[y * row + i] = (raw[y * (row + 1) + 1 + i] + (filter === 2 && y ? px[(y - 1) * row + i] : 0)) & 255;
  }
  return { w, h, px };
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

  const copiedFx = await toolCopy('postfx', 'Copy the PNG');
  const fx = await pngAlpha(copiedFx?.held['image/png']);
  check(
    'Copy puts the Post FX PNG on the clipboard as the PNG format and as image/png: RGBA, the full 1800 × 1000 px, its alpha kept (clear, half clear, solid)',
    copiedFx && fx && copiedFx.said === 'Copied the PNG.' && formats(copiedFx.held) === PNG_COPY && fx.colour === 6 && fx.w === BW && fx.h === BH && fx.img.px[(10 * BW + 10) * 4 + 3] === 0 && Math.abs(fx.img.px[((BH - 10) * BW + 900) * 4 + 3] - 128) <= 1 && fx.img.px[(500 * BW + 900) * 4 + 3] === 255,
    fx && copiedFx && [copiedFx.said, Object.keys(copiedFx.held), fx.colour, fx.w, fx.h],
  );

  // colour under faint alpha is exact: a canvas would premultiply (200, 50, 20) at alpha 3 into (170, 85, 0)
  const FW = 40;
  const faint = new Uint8Array(FW * FW * 4);
  for (let y = 0; y < FW; y++) for (let x = 0; x < FW; x++) faint.set([200, 50, 20, 1 + ((x + y) % 10)], (y * FW + x) * 4);
  await shell.sendItem(await put('Smoke faint', await (await rgbaPng(faint, FW, FW)).arrayBuffer()), 'postfx');
  pd.transact('Empty the stack', (d) => ({ ...d, stack: [] }));
  const faintOut = await exported('PNG');
  const back = faintOut && (await rawRgba(await faintOut.blob()));
  check('a PNG keeps the colour under alpha of 1 to 10 exactly, as a straight RGBA PNG', !!back && back.w === FW && back.px.length === faint.length && back.px.every((v, i) => v === faint[i]), back && [back.px.slice(0, 4)]);

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
  await chooseExport('postfx', 'PNG sequence');
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
    const at = (t: number) => stack.bytes(stack.render(src, pd.get().stack, { t, scale: 1, seconds: loop.seconds })).slice();
    const [f0, f1, fN, f9] = [at(0), at(0.1), at(1), at(0.9)];
    check('frame N of the loop is frame 0 to the byte: the grain comes round exactly', f0.every((v, i) => v === fN[i]) && f0.some((v, i) => v !== f1[i]), f0.filter((v, i) => v !== fN[i]).length);
    const [first, second, last] = [await frameOf(1), await frameOf(2), await frameOf(10)];
    // Straight-alpha pixels come back from a canvas exactly where alpha is 255. The GPU's float maths is
    // not the same bit for bit from one draw to the next (two renders of this frame, a moment apart, have
    // differed in 7 of its 163,840 half-float values, each by one half-float step, and now and then one of
    // those crosses an 8-bit step), so a file written a moment before a render can differ from it by one
    // level in a few values. Two frames of the loop differ by hundreds of levels, so that still tells them apart.
    const offBy = (img: Awaited<ReturnType<typeof pixelsOf>> | null, want: Uint8Array) => {
      let off = 0;
      let worst = 0;
      for (let i = 0; img && i < want.length; i++) {
        if (want[i - (i % 4) + 3] !== 255) continue;
        const d = Math.abs(img.px[i] - want[i]);
        if (d) off++;
        worst = Math.max(worst, d);
      }
      return { off, worst };
    };
    const sameAs = (img: Awaited<ReturnType<typeof pixelsOf>> | null, want: Uint8Array) => {
      const { off, worst } = offBy(img, want);
      return !!img && img.px.length === want.length && worst <= 1 && off <= want.length / 1000;
    };
    check('and the files are those frames: the first is frame 0, the second is frame 1, the last is frame 9', sameAs(first, f0) && sameAs(second, f1) && sameAs(last, f9) && !!first && !!last && first.px.join() !== last.px.join(), [offBy(first, f0), offBy(second, f1), offBy(last, f9)]);
  } finally {
    stack.release();
  }

  // share codes
  pd.transact('A stack', (d) => ({ ...d, stack: [layerOf('grade', { lift: 7 }), layerOf('vhs', { wobble: 5, speed: 1 }), layerOf('duotone')] }));
  const made = pd.get().stack;
  const bare = (l: typeof made) => JSON.stringify(l.map(({ effect, on, opacity, blend, params }) => ({ effect, on, opacity, blend, params })));
  const code = encodeStack(made);
  check('a share code is PFX2. and the stack, and it round-trips with every setting', code.startsWith('PFX2.') && bare(decodeStack(code)) === bare(made), code.slice(0, 24));
  pd.transact('Empty the stack', (d) => ({ ...d, stack: [] }));
  // the Share code group starts folded: open it, as a person would, before typing into its field
  const share = [...(host('postfx')?.querySelectorAll<HTMLButtonElement>('button[aria-expanded]') ?? [])].find((b) => b.textContent?.trim() === 'Share code');
  if (share?.getAttribute('aria-expanded') === 'false') share.click();
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
  // a scroll event is delivered with the next frame, so the picker can hear one for a scroll from before it
  // opened: that leaves it open (the button is where it was), one that carried the button off closes it
  const picker = () => document.querySelector('[role="dialog"][aria-label="Add an effect"]');
  const addButton = host('postfx')?.querySelector<HTMLElement>('button[aria-label="Add an effect"]');
  const inspector = addButton?.closest('aside');
  inspector?.dispatchEvent(new Event('scroll'));
  await sleep(50);
  const stays = !!picker();
  // (no transition, or the button would still be where it was when the event comes)
  if (addButton) Object.assign(addButton.style, { transition: 'none', transform: 'translateY(8px)' });
  inspector?.dispatchEvent(new Event('scroll'));
  const closes = !!(await until(() => !picker(), 2000));
  if (addButton) Object.assign(addButton.style, { transition: '', transform: '' });
  check('the Add picker stays open for a scroll that left its button where it was, and closes for one that moved it', !!inspector && stays && closes, [!!inspector, stays, closes]);
  press('Escape');
  check('datamosh is unavailable on a still: adding it does nothing and the picker greys it', !offered(stillDoc, 'datamosh') && pd.get() === stillDoc && row?.getAttribute('aria-disabled') === 'true', [pd.get().stack.length, row?.getAttribute('aria-disabled')]);

  // nothing plays until play is pressed, and leaving the tool pauses
  pd.transact('Grain', (d) => ({ ...d, stack: [layerOf('grain')] }));
  await sleep(600);
  const rest = playhead.get();
  check('nothing plays until play is pressed: a moving stack rests on its first frame', !rest.playing && rest.frame === 0, rest);
  togglePlay(timeline(pd.get()));
  const ran = playhead.get().playing && !!(await until(() => playhead.get().frame > 0, 10_000));
  shell.setActive('dither');
  check('Play plays the loop, and switching to another tool pauses it', ran && !!(await until(() => !playhead.get().playing, 3000)), playhead.get());
  shell.setActive('postfx');
  // a source opened while playing opens paused on its first frame: nothing animates until play is pressed
  togglePlay(timeline(pd.get()));
  const playingAgain = playhead.get().playing && !!(await until(() => playhead.get().frame > 0, 10_000));
  await shell.sendItem(wide, 'postfx');
  await sleep(800);
  check('a source opened while playing opens paused, on its first frame', playingAgain && !playhead.get().playing && playhead.get().frame === 0, [playingAgain, playhead.get()]);

  // no flicker, exact loops, half floats, a preview that is the export
  const flicker = flickerChecks();
  check(`no moving effect flickers, at its defaults or the worst its settings allow, in the shortest loop and a slow one: ${flicker.length} runs, the light moving under 2% of mid-grey a frame`, flicker.length >= 100 && flicker.every((c) => c.ok), flicker.filter((c) => !c.ok));
  const gpu = [...loopChecks(), ...pipelineChecks(), ...datamoshChecks(), ...scaleChecks()];
  check(`every moving effect loops exactly; stacks stay in half floats; datamosh repeats; a small preview is the export (${gpu.length} checks)`, gpu.every((c) => c.ok), gpu.filter((c) => !c.ok));

  // a clip made here: its frame count and rate, and a PNG sequence of exactly those frames in order
  const N = 12;
  await shell.runBusy(async () => shell.tool('postfx').onFiles!([await makeWebm(160, 96, N, 25)], 'drop', pd));
  const vid = await until(() => (pd.get().source?.kind === 'video' ? pd.get().source : null), 30_000);
  check(`a WebM made in the page opens as a clip of its ${N} frames at 25 fps`, vid?.frames === N && vid.fps === 25 && vid.w === 160 && vid.h === 96, vid);
  pd.transact('Grade', (d) => ({ ...d, stack: [layerOf('grade')] }));
  check('and datamosh is offered on it', offered(pd.get(), 'datamosh'));
  check('the transport sits in the view strip under the canvas, one row of chrome', !!host('postfx')?.querySelector('[data-view-strip] [aria-label="Playback"]'));
  check('the selected layer’s settings open inline under its row in the Effects group', !!(await until(() => host('postfx')?.querySelector('[role="option"][aria-selected="true"] + [data-layer-body]'))));
  [...(host('postfx')?.querySelectorAll('button') ?? [])].find((b) => b.textContent?.trim() === 'Export' && !b.closest('[data-row]'))?.click();
  const clipFormats = await until(() => {
    const l = [...document.querySelectorAll('[role="menu"] [role="menuitem"]')].map((x) => x.textContent?.trim() ?? '');
    return l.length ? l : null;
  });
  check('the doc bar’s Export lists the GIF, the PNG and the PNG sequence for a clip', !!clipFormats && ['GIF', 'PNG sequence'].every((n) => clipFormats.some((l) => l.includes(n))), clipFormats);
  press('Escape');
  const before = toastStore.get().length;
  await chooseExport('postfx', 'PNG sequence');
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
  patchIllustration({ tab: 'check' });
  const opened = await until(() => problemPane());
  check('Illustration’s Check values tab lists its problems, as many as its badge counts', opened && opened.rows === opened.badge && opened.fixes <= opened.rows, opened);

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
  check('and is saved under its palette', (await saved()) && illustrationView().paintings[id], illustrationView().paintings);
  for (const tab of ['settings', 'light', 'check', 'paint'] as const) {
    patchIllustration({ tab });
    await sleep(50);
  }
  check('a tab switch keeps the painting: Paint, Ramp settings, Light, Check, Paint', painted(), liveEngine.get()?.state);
  await modesUi();
  await restoredUi();
  await paintUi(id);

  // an edit while Design holds the palette forks it: the painting stays on screen and goes with the fork
  await shell.sendItem(ref!, 'design');
  shell.setActive('illustration');
  il.transact('Add base colour', (d) => addRamp(d, [0.5, 0.1, 140]).doc);
  const fork = await until(() => (il.state().t === 'saved' && il.source()?.itemId !== id ? il.source() : null));
  check('an Illustration edit of a palette Design holds forks it into Scratch', fork?.collection === 'Scratch', il.state());
  await sleep(500); // a canvas that lost it would have cleared by now
  check('the painting stays on the canvas through the fork', painted(), liveEngine.get()?.state);
  check('and is kept under the fork, the original keeping its own', fork && (await saved()) && illustrationView().paintings[fork.itemId] && illustrationView().paintings[id], illustrationView().paintings);
  if (glossy) await shell.sendItem((await find((i) => i.id === glossy.itemId))!, 'design');

  // a new palette's first stroke: the quit, straight after this pass, must save it (the quiet pass looks)
  shell.setActive('illustration');
  await shell.newDoc('illustration');
  await emptyUi();
  il.transact('Add base colours', (d) => addRamp(d, [0.62, 0.12, 40]).doc);
  const last = await until(() => (il.state().t === 'saved' ? il.source() : null));
  if (!check('a new Illustration palette for the last painting', last && last.itemId !== id && last.itemId !== fork?.itemId, il.state())) return;
  check('its canvas starts blank', await until(() => liveEngine.get()?.state.blank), liveEngine.get()?.state);
  await stroke(0.5);
  check('the last stroke is on the canvas', await until(painted), liveEngine.get()?.state);
  // not waited for: the save comes a second after the lift
  check('and not saved yet', !illustrationView().paintings[last!.itemId], illustrationView().paintings);
}

/**
 * the painting's saves are all written: waits for the save itself, which a disk stall can put seconds
 * behind the stroke, and gives up only on a hang; whatever is then missing from `paintings` is a real loss
 */
const saved = async () => (await liveSaves.get()?.settled(60_000)) === true;

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

/** the empty palette: the start in the Ramps section, Light and Check held back, and a starter chip that makes the first ramp */
async function emptyUi(): Promise<void> {
  const il = illustrationDoc();
  patchIllustration({ tab: 'settings' });
  const start = await until(() => host('illustration')?.querySelector('section[aria-label="Start"]'), 3000);
  check('an empty palette shows the start in the Ramps section', shows(start) && !!start?.parentElement?.closest('section')?.textContent?.startsWith('Ramps'), start?.textContent?.slice(0, 40));
  const off = (id: string) => illusTab(id)?.disabled;
  check('and holds Light and Check back until there is a colour, but not Ramp settings or Paint', off('light') === true && off('check') === true && off('settings') === false && off('paint') === false, [off('light'), off('check'), off('settings'), off('paint')]);
  patchIllustration({ tab: 'light' });
  await sleep(100);
  check('a saved Light tab on an empty palette still shows the start and a usable tab, not an empty lit pane', shows(host('illustration')?.querySelector('section[aria-label="Start"]')));
  const skin = await until(() => button('illustration', 'Skin'), 2000);
  skin?.click();
  const made = await until(() => (il.get().ramps.length === 1 ? il.get().ramps[0] : null));
  check('a starter chip makes the first ramp with its material and light', made?.material === 'skin' && il.get().swatches.length === 5, made);
  check('and the start artboard is gone', await until(() => !host('illustration')?.querySelector('section[aria-label="Start"]'), 2000));
  il.undo();
  check('the starter is one undo step', il.get().ramps.length === 0, il.get().ramps.length);
  patchIllustration({ tab: 'paint' });
}

/**
 * The workspace's own UI: the modes by their keys, a selection that carries across them, Shift+A,
 * the curves (a dragged point is the picker's edit), the sun on its ring, and the hero checkbox.
 */
async function modesUi(): Promise<void> {
  const il = illustrationDoc();
  const tab = () => illustrationView().tab;
  const chord = (n: string) => press(n, { code: `Digit${n}`, altKey: true });
  const seen: string[] = [];
  for (const [n, want] of [['2', 'light'], ['3', 'check'], ['1', 'settings'], ['4', 'paint']] as const) {
    chord(n);
    await until(() => tab() === want, 1000);
    seen.push(tab());
  }
  check('Alt+1 to Alt+4 switch Ramp settings, Light & preview, Check values and Paint', seen.join() === 'light,check,settings,paint', seen);
  const picked = () => ['settings', 'light', 'check', 'paint'].filter((id) => illusTab(id)?.getAttribute('aria-selected') === 'true');
  check('and the tab strip shows the one that is on', picked().join() === 'paint', picked());
  // clicking a tab, and the choice kept in the workspace (view state) for the next launch
  illusTab('light')?.click();
  await until(() => tab() === 'light', 1000);
  check('clicking a tab opens it and the workspace keeps it', picked().join() === 'light' && (shell.view('illustration') as { tab?: string } | null)?.tab === 'light', [picked(), shell.view('illustration')]);
  // B, S and I act only while Paint shows
  setPaint({ tool: 'smudge' });
  press('b', { code: 'KeyB' });
  await sleep(60);
  check('B does nothing while another tab shows', paint().tool === 'smudge', paint().tool);
  chord('4');
  await until(() => tab() === 'paint', 1000);
  press('b', { code: 'KeyB' });
  check('and picks the Brush while Paint shows', await until(() => paint().tool === 'paint', 1000), paint().tool);
  chord('1');
  await until(() => tab() === 'settings', 1000);

  // the selected step carries across the modes
  chord('1');
  await until(() => tab() === 'settings' && host('illustration')?.querySelector('[role="listbox"][aria-label="Swatch board"]'), 1000);
  const ramp = il.get().ramps[0].id;
  const step = stepsOf(il.get(), ramp)[1];
  host('illustration')?.querySelector<HTMLButtonElement>(`[data-step="${step.id}"]`)?.click();
  await until(() => illustrationView().selected === step.id);
  const kept: string[] = [];
  for (const n of ['2', '3', '4', '1']) {
    chord(n);
    await sleep(80);
    const chip = host('illustration')?.querySelector(`[data-step="${step.id}"]`);
    kept.push(`${tab()}:${illustrationView().selected === step.id}:${chip?.getAttribute('aria-selected')}`);
  }
  check('the selected step stays selected through every tab', kept.every((k) => k.endsWith(':true:true')), kept);

  // Shift+A adds a base colour, as one undo step
  const n = il.get().ramps.length;
  press('A', { code: 'KeyA', shiftKey: true });
  check('Shift+A adds a base colour', await until(() => il.get().ramps.length === n + 1), il.get().ramps.length);
  il.undo();
  check('and it is one undo step', il.get().ramps.length === n, il.get().ramps.length);
  host('illustration')?.querySelector<HTMLButtonElement>(`[data-step="${step.id}"]`)?.click();
  await until(() => illustrationView().selected === step.id);

  // the curves: dragging a point up lifts that step's lightness, in one undoable step; the others stay
  const dot = await until(() => host('illustration')?.querySelector<SVGCircleElement>(`[data-curve-point="${step.id}:L"]`), 2000);
  const L = (d: IllustrationDoc) => d.swatches.find((w) => w.id === step.id)!.oklch[0];
  const [L0, depth0] = [L(il.get()), il.depth()];
  if (check('the curves show a draggable point per step', !!dot) && dot) {
    const r = dot.getBoundingClientRect();
    const fire = (type: string, y: number) =>
      dot.dispatchEvent(new PointerEvent(type, { bubbles: true, cancelable: true, pointerId: 1, pointerType: 'mouse', isPrimary: true, button: type === 'pointermove' ? -1 : 0, buttons: type === 'pointerup' ? 0 : 1, clientX: r.left + r.width / 2, clientY: y }));
    const y0 = r.top + r.height / 2;
    fire('pointerdown', y0);
    fire('pointermove', y0 - 12);
    fire('pointermove', y0 - 24);
    fire('pointerup', y0 - 24);
    const moved = await until(() => il.depth() > depth0);
    const edited = il.get().swatches.find((w) => w.id === step.id);
    check('dragging a curve point up lifts the step and marks it edited, as one step', moved && L(il.get()) > L0 + 0.01 && edited?.edited === true && il.depth() === depth0 + 1, [L0, L(il.get()), il.depth() - depth0]);
    il.undo();
    check('and Undo puts it back', L(il.get()) === L0 && il.depth() === depth0, [L0, L(il.get())]);
  }

  // the hero checkbox, in Ramp settings
  const hero = () => [...(host('illustration')?.querySelectorAll<HTMLButtonElement>('button[role="checkbox"]') ?? [])].find((b) => b.textContent?.includes('Quieten the other ramps'));
  hero()?.click();
  check('the Hero checkbox makes the selected ramp the hero', await until(() => il.get().ramps[0].hero === true), il.get().ramps.map((r) => r.hero));
  hero()?.click();
  check('and unticking ends it', await until(() => il.get().ramps[0].hero === false), il.get().ramps.map((r) => r.hero));

  // the sun: dragged on its ring to the left of the object, then nudged with an arrow
  const depth1 = il.depth();
  chord('2');
  const sun = await until(() => host('illustration')?.querySelector<HTMLElement>('[role="slider"][aria-label="Light direction"]'), 2000);
  const ring = sun?.parentElement;
  if (check('Light shows the sun on its ring', !!ring && shows(ring)) && ring && sun) {
    const r = ring.getBoundingClientRect();
    const [x, y] = [r.left + r.width * 0.25, r.top + r.height / 2];
    const fire = (type: string) => ring.dispatchEvent(new PointerEvent(type, { bubbles: true, cancelable: true, pointerId: 1, pointerType: 'mouse', isPrimary: true, button: type === 'pointermove' ? -1 : 0, buttons: type === 'pointerup' ? 0 : 1, clientX: x, clientY: y }));
    fire('pointerdown');
    fire('pointermove');
    fire('pointerup');
    const light = () => illustrationView().preview as { azimuth?: number; elevation?: number };
    const dragged = await until(() => (light().azimuth === 270 ? light() : null));
    check('dragging the sun sets azimuth and elevation from where it was dropped', dragged && dragged.elevation === 60, light());
    sun.focus();
    press('ArrowRight');
    check('an arrow key nudges the sun by one degree', await until(() => light().azimuth === 271), light());
    check('and moving the light leaves the palette alone', il.depth() === depth1 && illustrationView().selected === step.id, il.depth() - depth1);
  }
  chord('4');
  await until(() => tab() === 'paint', 1000);
}

/** a synthetic pointer sequence on `el` (the three arguments are client positions); pointer capture has no real pointer to take, so it is a no-op for the duration */
async function dragOn(el: Element, from: [number, number], to: [number, number], then?: () => void): Promise<void> {
  const proto = HTMLElement.prototype;
  const [cap, rel] = [proto.setPointerCapture, proto.releasePointerCapture];
  proto.setPointerCapture = () => {};
  proto.releasePointerCapture = () => {};
  const fire = (type: string, [x, y]: [number, number]) =>
    el.dispatchEvent(new PointerEvent(type, { bubbles: true, cancelable: true, pointerId: 7, pointerType: 'mouse', isPrimary: true, button: type === 'pointermove' ? -1 : 0, buttons: type === 'pointerup' ? 0 : 1, clientX: x, clientY: y }));
  try {
    fire('pointerdown', from);
    fire('pointermove', [(from[0] + to[0]) / 2, (from[1] + to[1]) / 2]);
    fire('pointermove', to);
    then?.();
    fire('pointerup', to);
  } finally {
    proto.setPointerCapture = cap;
    proto.releasePointerCapture = rel;
  }
  await frame();
}
const centre = (el: Element): [number, number] => {
  const r = el.getBoundingClientRect();
  return [r.left + r.width / 2, r.top + r.height / 2];
};
/** a content colour with no chroma: the greyscale value strip */
const grey = (el: Element | null | undefined) => {
  const c = el ? getComputedStyle(el).backgroundColor : '';
  const lch = /^ok?lch\(\S+ ([\d.e-]+)/.exec(c);
  if (lch) return +lch[1] <= 0.003;
  const n = (/\(([^)]+)\)/.exec(c)?.[1] ?? '').split(/[ ,/]+/).slice(0, 3).map(Number);
  // a computed color() string carries 0-1 channels, rgb() 0-255
  const unit = c.slice(0, c.indexOf('(')) === 'color';
  return n.length === 3 && n.every(Number.isFinite) && Math.max(...n) - Math.min(...n) <= (unit ? 0.005 : 1);
};

/**
 * What the colour redesign had dropped and Illustration has again: the three drag handles (and what
 * they keep and refit), the value strips and the "N steps · M edited" line, Rebuild base in the menu,
 * all three shapes together, the hero star and arrow keys in All ramps, a lit ramp beside its settings,
 * the Value ruler's cluster fix and the colour-vision detail, the palette's colours in the tray and
 * dragged into the well, and the Notes tab.
 */
async function restoredUi(): Promise<void> {
  const il = illustrationDoc();
  const ui = host('illustration')!;
  const view = () => illustrationView();
  const stored = () => shell.view('illustration') as Record<string, unknown> | null;
  const handle = (label: string) => ui.querySelector<HTMLElement>(`[role="separator"][aria-label="${label}"]`);
  const section = (title: string) => [...ui.querySelectorAll('section')].find((sec) => sec.querySelector('h2')?.textContent === title);
  const selSection = () => ui.querySelector('[aria-label="Swatch board"]')?.closest('section');
  const size = (el: Element | null | undefined) => el?.getBoundingClientRect() ?? new DOMRect();
  const ramp0 = il.get().ramps[0].id;
  const step = stepsOf(il.get(), ramp0)[1];
  patchIllustration({ tab: 'paint', rampsWidth: 320, rampHeight: 300, pickerWidth: 560 });
  await frame();

  // the handles: drag, kept in the workspace, the paper refits; a double-click resets; arrows nudge
  const paper = () => paperCanvas()!;
  const paperBox = () => [paper().width, paper().height];
  const refit = async (was: number[]) => !!(await until(() => paper().width !== was[0] || paper().height !== was[1], 1500));
  for (const [label, key, def, dx, dy, grows] of [
    ['Ramps width', 'rampsWidth', 320, 60, 0, 'w'],
    ['Selected ramp height', 'rampHeight', 300, 0, 40, 'h'],
    ['Colour picker width', 'pickerWidth', 560, -50, 0, 'w'],
  ] as const) {
    const h = handle(label);
    if (!check(`${label}: there is a handle on the seam`, !!h && shows(h), label)) continue;
    const box = () => size(label === 'Ramps width' ? section('Ramps') : label === 'Selected ramp height' ? selSection() : section('Colour picker'));
    const at = box();
    const was = paperBox();
    await dragOn(h!, centre(h!), [centre(h!)[0] + dx, centre(h!)[1] + dy]);
    const want = def + (dx || dy);
    check(`${label}: a drag sets it (${want}) and the workspace keeps it`, await until(() => view()[key] === want && stored()?.[key] === want), [view()[key], stored()?.[key]]);
    const now = box();
    // the picker is held to 60% of its row, so on a narrow window it moves less than the handle did
    const lower = section('Colour picker')!.parentElement!.parentElement!;
    const goal = key === 'pickerWidth' ? Math.min(want, lower.clientWidth * 0.6) : want;
    check(`${label}: the section follows`, Math.abs((grows === 'w' ? now.width : now.height) - goal) <= 2, [at.width, now.width, at.height, now.height, goal]);
    check(`${label}: the paper refits`, await refit(was), [was, paperBox()]);
    h!.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
    check(`${label}: a double-click resets it`, await until(() => view()[key] === def && stored()?.[key] === def), view()[key]);
    h!.focus();
    press(label === 'Selected ramp height' ? 'ArrowDown' : 'ArrowRight');
    check(`${label}: an arrow key nudges it`, await until(() => view()[key] === def + 10), view()[key]);
    h!.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
    await until(() => view()[key] === def);
  }
  // a saved size from before the handles is just the default (sanitize), and one out of range is pulled in
  patchIllustration({ rampsWidth: 320 });

  // the value strip under every step, and the step count with its edited count
  const board = ui.querySelector('[role="listbox"][aria-label="Ramps"]')!;
  const chips = [...board.querySelectorAll<HTMLElement>('[data-step]')];
  check('every step chip in the Ramps list has a greyscale value strip under its colour', chips.length === 10 && chips.every((c) => c.querySelectorAll('i').length === 2 && grey(c.querySelectorAll('i')[1])), chips.length);
  patchIllustration({ tab: 'settings' });
  await sleep(60);
  const sel = [...ui.querySelectorAll<HTMLElement>('[role="listbox"][aria-label="Swatch board"] [data-step]')];
  check('and every step in the Selected ramp has one', sel.length === 5 && sel.every((c) => grey([...c.querySelectorAll('i')].at(-1))), sel.length);
  const rampItem = () => board.querySelector<HTMLElement>(`[data-row="${ramp0}"]`);
  const edited0 = stepsOf(il.get(), ramp0).filter((w) => w.edited).length;
  check('a ramp says how many steps it has, and how many are edited by hand', /5 steps/.test(rampItem()?.textContent ?? '') && (edited0 ? rampItem()?.textContent?.includes(`${edited0} edited`) : !/edited/.test(rampItem()?.textContent ?? '')), [edited0, rampItem()?.textContent]);
  const depth = il.depth();
  const fresh = stepsOf(il.get(), ramp0).find((w) => !w.edited && w.step !== 0)!;
  il.transact('Change a step', (d) => recolour(d, fresh.id, [0.5, 0.05, 20]));
  check('and the count follows an edit', await until(() => rampItem()?.textContent?.includes(`5 steps · ${edited0 + 1} edited`)), rampItem()?.textContent);
  check('the Selected ramp says so too', (selSection()?.querySelector('header')?.textContent ?? '').includes(`${edited0 + 1} edited`), selSection()?.querySelector('header')?.textContent);
  il.undo();
  check('(put back)', il.depth() === depth);

  // Rebuild base is in each ramp's menu
  rampItem()?.querySelector<HTMLButtonElement>('button[aria-label="More"]')?.click();
  check('a ramp’s ... menu has Rebuild base', !!(await until(() => menuRow('Rebuild base'))), [...document.querySelectorAll('[role="menuitem"]')].map((r) => r.textContent));
  press('Escape');
  await sleep(60);

  // the surround of the steps board is 18% grey unless chosen otherwise
  check('the steps board sits on 18% grey by default', view().board === 'grey', view().board);

  // Light & preview: sphere, cube and cloth together
  const hero0 = il.get().ramps[0].hero;
  patchIllustration({ tab: 'light', preview: { ...view().preview, shape: 'sphere', all: false } });
  await sleep(60);
  const allShapes = () => [...ui.querySelectorAll<HTMLElement>('button[role="radio"]')].find((b) => b.textContent?.trim() === 'All' && shows(b));
  allShapes()?.click();
  const three = await until(() => ui.querySelector('[data-three]'), 1500);
  check('Shape: All shows a sphere, a cube and a cloth fold together', !!three && ['sphere', 'cube', 'cloth'].every((n) => three!.querySelector(`canvas[aria-label$="a ${n}"], canvas[aria-label$="a cloth fold"]`)) && three!.querySelectorAll('canvas').length === 3, three?.innerHTML.length);
  // All ramps: the hero star on its small sphere, and arrow keys between them
  il.transact('Hero', (d) => setSpec(d, ramp0, { hero: true }));
  patchIllustration({ preview: { ...view().preview, shape: 'sphere', all: true } });
  const cells = await until(() => {
    const c = [...ui.querySelectorAll<HTMLElement>('[role="radiogroup"][aria-label="Ramps under the light"] [role="radio"]')];
    return c.length === 2 ? c : null;
  }, 1500);
  check('All ramps puts the hero star on the hero ramp’s sphere only', !!cells && !!cells[0].querySelector('[data-icon="star"]') && !cells[1].querySelector('[data-icon="star"]'), cells?.map((c) => c.textContent));
  if (cells) {
    const sel0 = view().selected;
    cells.find((c) => c.tabIndex === 0)?.focus();
    press('ArrowRight');
    check('and an arrow key moves to the next ramp', await until(() => view().selected !== sel0 && il.get().swatches.find((w) => w.id === view().selected)?.group === il.get().ramps[1].id), [sel0, view().selected]);
    press('ArrowLeft');
    await until(() => il.get().swatches.find((w) => w.id === view().selected)?.group === ramp0);
  }
  il.transact('Hero', (d) => setSpec(d, ramp0, { hero: hero0 }));
  patchIllustration({ preview: { ...view().preview, shape: 'sphere', all: false } });
  patchView0(step.id);

  // Ramp settings: the ramp lit beside its settings, changing with them
  patchIllustration({ tab: 'settings' });
  const lit = await until(() => ui.querySelector<HTMLCanvasElement>('[data-live-preview] canvas'), 1500);
  const sum = (c: HTMLCanvasElement) => {
    const px = c.getContext('2d')!.getImageData(0, 0, c.width, c.height).data;
    let t = 0;
    for (let i = 0; i < px.length; i += 4) t = (t * 31 + px[i] + px[i + 1] * 3 + px[i + 2] * 7) | 0;
    return t;
  };
  if (check('Ramp settings shows the ramp lit beside its settings', !!lit && shows(lit))) {
    const a = sum(lit!);
    il.transact('Hue', (d) => setSpec(d, ramp0, { hueShift: 0.9, intensity: 'extreme' }));
    check('and changing its hue shift lights it differently at once', await until(() => sum(ui.querySelector<HTMLCanvasElement>('[data-live-preview] canvas')!) !== a), a);
    il.undo();
  }

  // Check values: the Value ruler and its cluster fix, the colour-vision detail
  patchIllustration({ tab: 'check' });
  await sleep(80);
  const depth2 = il.depth();
  const bases = il.get().swatches.filter((w) => w.step === 0);
  check('Check values shows the Value ruler and the colour-vision rows (Typical, with pair names and ΔE)', !!ui.querySelector('section[aria-label="Problems"]') && !!ui.querySelector('[role="radiogroup"][aria-label="Simulation"]') && /Typical/.test(ui.textContent ?? '') && /\/.*\d+\.\d/.test(ui.querySelector('[role="radiogroup"][aria-label="Simulation"]')?.textContent ?? ''), bases.length);
  const v0 = valueOf(bases[0].oklch);
  il.transact('Close in value', (d) => addRamp(recolour(d, bases[1].id, holdValue(v0 + 0.01, 0.1, 250)), holdValue(v0 - 0.012, 0.09, 140)).doc);
  const spread = await until(() => [...ui.querySelectorAll<HTMLButtonElement>('button')].find((b) => /^Spread these 3$/.test(b.textContent?.trim() ?? '') && shows(b)), 2000);
  check('three bases that read as one grey get one flag with Spread these 3', !!spread, [...ui.querySelectorAll('button')].map((b) => b.textContent?.trim()).filter((t) => t?.startsWith('Spread')));
  spread?.click();
  const gap = () => {
    const l = il.get().swatches.filter((w) => w.step === 0).map((w) => valueOf(w.oklch)).sort((a, b) => a - b);
    return Math.min(...l.slice(1).map((x, i) => x - l[i]));
  };
  check('and it spreads them all in one step', await until(() => gap() >= 0.03), gap());
  while (il.depth() > depth2) il.undo();
  patchView0(step.id);

  // the palette in the paint tray under the tubes, grouped by ramp; dragged into the well as well as Shift-clicked
  patchIllustration({ tab: 'paint' });
  setPaint({ well: [] });
  await sleep(80);
  const tray = ui.querySelector('[role="radiogroup"][aria-label="Paints for the brush"]');
  const groups = [...(tray?.querySelectorAll('[data-set]') ?? [])];
  check('the paint tray has the palette’s colours, a group per ramp', groups.length === il.get().ramps.length && groups.every((g) => g.querySelectorAll('[role="radio"]').length === 5), groups.length);
  const chip = board.querySelector<HTMLElement>(`[data-step="${step.id}"]`);
  const well = ui.querySelector('[role="group"][aria-label="Mixing well"]');
  if (check('Paint shows the well and the ramp chips', !!chip && !!well && shows(well))) {
    await dragOn(chip!, centre(chip!), centre(well!));
    check('dragging a ramp chip into the well adds it as a part', await until(() => paint().well.some((w) => w.id === `swatch:${step.id}`)), paint().well);
    const other = groups[1]?.querySelector<HTMLElement>('[role="radio"]');
    if (check('the tray’s own palette chips are there to drag', !!other)) {
      const n = paint().well.length;
      await dragOn(other!, centre(other!), centre(well!));
      check('a palette chip in the tray drags into the well too', await until(() => paint().well.length === n + 1), paint().well);
    }
    await dragOn(chip!, centre(chip!), centre(chip!));
    chip!.dispatchEvent(new MouseEvent('click', { bubbles: true, shiftKey: true }));
    check('and Shift-click still adds a part', await until(() => paint().well.find((w) => w.id === `swatch:${step.id}`)!.parts >= 2), paint().well);
  }
  setPaint({ well: [] });

  // the Notes tab: only while the file has notes
  check('no notes, no Notes tab', !illusTab('notes'), !!illusTab('notes'));
  il.transact('Notes', (d) => ({ ...d, notes: 'Lab colours were converted to sRGB.' }));
  const tabBtn = await until(() => illusTab('notes'), 1500);
  check('a file with notes gets a Notes tab', !!tabBtn);
  tabBtn?.click();
  check('which shows them', !!(await until(() => /Lab colours were converted/.test(ui.querySelector('[role="tabpanel"]')?.textContent ?? ''), 1500)), ui.querySelector('[role="tabpanel"]')?.textContent);
  il.transact('Clear the notes', (d) => ({ ...d, notes: '' }));
  check('clearing them closes the tab', await until(() => !illusTab('notes'), 1500));
  patchIllustration({ tab: 'paint' });
  await until(() => paperCanvas(), 1500);
}
const patchView0 = (selected: string) => patchIllustration({ selected });


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

  // the brush chip: gouache and the Dry brush show the paint; watercolour shows the wash the Load gives
  // on bare paper (paint/wash.ts), the moment the Load, medium or paint changes
  const ultra = PIGMENTS.find((p) => p.id === 'ultra')!;
  const tubeLoaded = loadedOf(ultra);
  const chip = () => section.querySelector<HTMLElement>('header [class*="brushChip"]');
  const chipColour = () => {
    const el = chip();
    return el ? parseCss(getComputedStyle(el).backgroundColor) : null;
  };
  const chipSays = async (patch: Partial<PaintSettings>, want: Oklch) => {
    setPaint({ paint: 'ultra', tool: 'paint', ...patch });
    await frame();
    await frame();
    const got = chipColour();
    return got && deltaE(got, want) < 0.5 ? got : null;
  };
  const brushes = paint().brushes;
  const medium = paint().medium;
  const load = paint().load;
  const size = paint().size;
  check('the chip is the paint itself in gouache', await chipSays({ medium: 'dry' }, ultra.oklch), chipColour());
  check('and in watercolour the wash at Load 30', await chipSays({ medium: 'wet', load: 30, brushes: { ...brushes, wet: 'round' } }, washColour(tubeLoaded, 0.3, size)), [chipColour(), washColour(tubeLoaded, 0.3, size)]);
  const pale = chipColour();
  check('Load 100 darkens it at once, with no transition', (await chipSays({ load: 100 }, washColour(tubeLoaded, 1, size))) && pale && chipColour()![0] < pale[0] - 0.05 && getComputedStyle(chip()!).transitionDuration === '0s', [pale, chipColour()]);
  const wide = chipColour();
  check('and a narrow brush darkens it too, again at once (its wash is mostly rim)', (await chipSays({ size: 14 }, washColour(tubeLoaded, 1, 14))) && wide && chipColour()![0] < wide[0] - 0.02 && getComputedStyle(chip()!).transitionDuration === '0s', [wide, chipColour()]);
  check('the Dry brush lays streaks, not a wash, so its chip is the paint', await chipSays({ brushes: { ...brushes, wet: 'dry' } }, ultra.oklch), chipColour());
  await chipSays({ size, brushes: { ...brushes, wet: 'round' } }, washColour(tubeLoaded, 1, size));
  const el = chip()!;
  el.dispatchEvent(new PointerEvent('pointerover', { bubbles: true, pointerType: 'mouse' }));
  const tip = await until(() => document.querySelector('[role="tooltip"]')?.textContent ?? null, 2000);
  el.dispatchEvent(new PointerEvent('pointerout', { bubbles: true, pointerType: 'mouse' }));
  check("the chip's tooltip names the wash and keeps the paint's own colour", tip === `Ultramarine Blue · a wash at Load 100 looks like this. Paint colour ${toHex(ultra.oklch).toUpperCase()}.`, tip);
  setPaint({ medium, load, size, brushes });

  // the options row: one line at 1000px with the paint's name, and still one line at 724px (the toolbox is 48px of the section)
  const head = section.querySelector('header')!;
  const oneLine = () => {
    const r = head.getBoundingClientRect();
    const mid = r.top + r.height / 2;
    return r.height <= 36.5 && head.scrollWidth <= head.clientWidth + 1 && [...head.children].every((c) => Math.abs(c.getBoundingClientRect().top + c.getBoundingClientRect().height / 2 - mid) <= 2);
  };
  section.style.flex = 'none';
  for (const w of [1000, 724]) {
    section.style.width = `${w + 48}px`;
    const fits = await until(() => head.dataset.fit === (w >= 1000 ? 'full' : 'compact') && oneLine(), 5000);
    check(`the options row is one line at ${w}px`, fits && (w < 1000 || head.textContent?.includes('Ultramarine Blue')), [head.dataset.fit, head.getBoundingClientRect().height, head.scrollWidth, head.clientWidth]);
  }
  section.style.width = '';
  section.style.flex = '';

  // the paper fits its tab: it re-fits when the tab narrows and widens, and when Paint is switched away and back
  const paperFits = (c: HTMLCanvasElement) => {
    const r = c.getBoundingClientRect();
    const v = c.parentElement!.getBoundingClientRect();
    return r.width > 0 && r.left >= v.left - 1 && r.right <= v.right + 1 && r.top >= v.top - 1 && r.bottom <= v.bottom + 1 && Math.abs(c.width - Math.round(c.clientWidth * devicePixelRatio)) <= 2;
  };
  const tabbed = canvas.closest('[role="tabpanel"]')!.parentElement!;
  const fullW = canvas.clientWidth;
  tabbed.style.maxWidth = `${Math.round(tabbed.getBoundingClientRect().width * 0.6)}px`;
  const narrowed = await until(() => canvas.clientWidth < fullW - 20 && paperFits(canvas), 5000);
  check('the paper re-fits when the tab narrows', narrowed, [fullW, canvas.clientWidth, canvas.width]);
  tabbed.style.maxWidth = '';
  check('and when it widens again', await until(() => Math.abs(canvas.clientWidth - fullW) <= 2 && paperFits(canvas), 5000), [fullW, canvas.clientWidth, canvas.width]);
  const drawn = e.state.depth;
  illusTab('settings')?.click();
  const away = await until(() => !paperCanvas(), 3000);
  illusTab('paint')?.click();
  const returned = await until(() => paperCanvas(), 3000);
  check('switching Paint away and back puts the paper back, fitted to the tab', away && returned === canvas && (await until(() => paperFits(canvas), 3000)), [away, canvas.clientWidth, canvas.width]);
  check('and it still paints', (await stroke(0.75)) && (await until(() => e.state.depth > drawn, 3000)), [drawn, e.state]);

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
  check('the greyscale view left on in the first pass came back, on the root', prefs?.greyscale === true && document.documentElement.dataset.greyscale === 'true', [prefs?.greyscale, document.documentElement.dataset.greyscale]);
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
