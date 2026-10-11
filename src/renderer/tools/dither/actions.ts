// What the tool does to its document besides single values: opening an image, an animated GIF or
// a sequence, a look, a palette from the Library or from the image, and the round trip to Design.
import { toHex, type Oklch } from '../../../shared/color/index.ts';
import type { DocController } from '../../../shared/doc-api.ts';
import { extractPalette } from '../../../shared/dither/palette.ts';
import type { PalettePayload, Swatch } from '../../../shared/types.ts';
import { decodeFrames } from '../../lib/frames.ts';
import { shell } from '../../shell/core/index.ts';
import { ipc } from '../../shell/core/ipc.ts';
import { toast } from '../../ui/index.ts';
import { plural } from '../common/names.ts';
import { putSequence, SEQUENCE_FPS } from '../common/sequence.ts';
import { baseName, claims, extOf, isSvg, putAsset, svgAsPng } from '../common/take.ts';
import { LIMIT, paletteOf, used, type DitherDoc, type Source } from './doc.ts';
import { withLook, type Look } from './looks.ts';
import { workFrame } from './source.ts';

export type Doc = DocController<DitherDoc>;

const ID = 'dither';


/** read to be sure it opens, then copied into the workspace at full resolution (foundation spec §7.2); a GIF keeps its own timing */
export async function sourceOf(blob: Blob, name: string, ext = extOf(blob, name)): Promise<Source> {
  const f = await decodeFrames(blob);
  const { w, h, count, delays } = f;
  f.close();
  const assets = [await putAsset(ID, blob, ext)];
  if (count < 2 || !delays) return { assets, name, w, h, fps: null, delays: null, frames: 1 };
  const mean = delays.reduce((a, b) => a + b, 0) / count;
  return { assets, name, w, h, fps: Math.round(Math.min(LIMIT.fps[1], Math.max(LIMIT.fps[0], 1000 / mean))), delays, frames: count };
}

/** files as the frames of one animation, in the order Explorer sorts them by name */
async function sequenceOf(files: File[]): Promise<Source> {
  const { assets, name, w, h, count } = await putSequence(ID, files);
  return { assets, name, w, h, fps: SEQUENCE_FPS, delays: null, frames: count };
}


/** bumped by each open, so one that reads slowly never lands over a later one */
let opening = 0;

/**
 * Dropped, pasted or picked files, opened as one step: one image, or several stills as the frames
 * of a sequence. What isn't an image is left for the Library.
 */
export async function takeFiles(doc: Doc, files: File[]): Promise<File[]> {
  const images = files.filter(claims);
  if (!images.length) return files;
  const stills = images.filter((f) => !isSvg(f));
  const mine = ++opening;
  try {
    let source: Source;
    if (stills.length > 1) source = await shell.runBusy(() => sequenceOf(stills));
    else {
      const file = stills[0] ?? images[0];
      const name = baseName(file.name);
      source = isSvg(file) ? await sourceOf(await svgAsPng(file), name, 'png') : await sourceOf(file, name);
    }
    if (mine !== opening) return files.filter((f) => !images.includes(f));
    doc.transact(`Open ${source.name}`, (d) => ({ ...d, source }));
    if (source.frames > 1 && stills.length > 1) toast.show({ icon: 'movie', message: `${plural(source.frames, 'frame')} of ${source.name}, in name order, at ${source.fps} fps.` });
  } catch (e) {
    if (mine === opening) toast.show({ kind: 'error', message: e instanceof Error ? e.message : String(e) });
  }
  const taken = new Set(stills.length > 1 ? stills : [stills[0] ?? images[0]]);
  return files.filter((f) => !taken.has(f));
}

/** the file picker, from the doc bar and Ctrl+O; several files open as a sequence */
export function pickImage(doc: Doc): void {
  const input = document.createElement('input');
  input.type = 'file';
  input.multiple = true;
  input.accept = 'image/*,.tif,.tiff,.svg';
  input.onchange = () => void takeFiles(doc, [...(input.files ?? [])]).then((left) => left.length && toast.show({ icon: 'block', message: `${left[0].name} isn't an image this tool can open.` }));
  input.click();
}

export const applyLook = (doc: Doc, look: Look): void => doc.transact(`Use the ${look.name} look`, (d) => withLook(d, look));

/** a Library palette as the colours (Send to: PALETTE), all on, in its order */
export function withPalette(d: DitherDoc, name: string, swatches: Swatch[], id: string): DitherDoc {
  if (swatches.length < 2) throw new Error(`${name} has ${swatches.length ? 'one colour' : 'no colours'}; a dither needs at least two.`);
  const keep = swatches.slice(0, LIMIT.colours[1]);
  if (keep.length < swatches.length) toast.show({ icon: 'info', message: `A dither holds up to ${LIMIT.colours[1]} colours, so the last ${plural(swatches.length - keep.length, 'colour')} of ${name} stayed out.` });
  return { ...d, palette: paletteOf(name, keep.map((w) => w.oklch)), paletteSource: { kind: 'library', id } };
}

export const usePreset = (doc: Doc, name: string, id: string, colours: Oklch[]): void =>
  doc.transact(`Use the ${name} palette`, (d) => ({ ...d, palette: paletteOf(name, colours), paletteSource: { kind: 'preset', id } }));

/** `k` colours from the frame on screen, dark to light (spec §3: colours extracted from the image) */
export async function extract(doc: Doc, frame: number, k: number): Promise<void> {
  const d = doc.get();
  if (!d.source) return;
  const f = await workFrame(d, frame);
  const got = extractPalette(f.rgba, f.w, f.h, k);
  if (got.length < 2) return void toast.show({ icon: 'info', message: `${d.source.name} holds only one colour, so there is nothing to dither between.` });
  if (got.length < k) toast.show({ icon: 'info', message: `${d.source.name} has only ${got.length} distinct colours; they are all in the palette.` });
  const src = d.source.name;
  doc.transact(`Take ${got.length} colours from ${src}`, (x) => ({ ...x, palette: paletteOf(`From ${src}`, got), paletteSource: { kind: 'extract' } }));
}

export function toggleColour(doc: Doc, i: number): void {
  const d = doc.get();
  const c = d.palette.colours[i];
  if (!c) return;
  if (c.on && used(d).length <= LIMIT.colours[0]) return void toast.show({ icon: 'info', message: 'A dither needs at least two colours, so these two stay on.' });
  const hex = toHex(c.oklch).toUpperCase();
  doc.transact(c.on ? `Leave out ${hex}` : `Use ${hex} again`, (x) => ({ ...x, palette: { ...x.palette, colours: x.palette.colours.map((y, n) => (n === i ? { ...y, on: !y.on } : y)) } }));
}

export function sortByLightness(doc: Doc): void {
  doc.transact('Sort the colours dark to light', (d) => ({ ...d, palette: { ...d.palette, colours: [...d.palette.colours].sort((a, b) => a.oklch[0] - b.oklch[0]) } }));
}

// the palettes this session saved for Design, by their colours, so a second round trip reuses its file
const saved = new Map<string, string>();

const refOf = (id: string | undefined) => (id ? shell.getState().library?.collections.flatMap((c) => c.items).find((i) => i.id === id) : undefined);

/**
 * Edit in Design (spec §5 q4): colours are edited there, never here. A Library palette opens as it
 * is; any other is saved to Scratch first, which the toast says, and Send to brings it back.
 */
export async function editInDesign(d: DitherDoc): Promise<void> {
  const colours = d.palette.colours.map((c) => c.oklch);
  const key = colours.map(toHex).join();
  const known = refOf(d.paletteSource.kind === 'library' ? d.paletteSource.id : undefined) ?? refOf(saved.get(key));
  if (known) return shell.sendItem(known, 'design');
  const payload: PalettePayload = {
    kind: 'palette',
    id: crypto.randomUUID(),
    version: 1,
    swatches: colours.map((oklch) => ({ id: crypto.randomUUID(), name: '', role: null, oklch, type: 'process' })),
    notes: '',
  };
  try {
    const { ref } = await ipc.invoke('library.create', 'Scratch', d.palette.name || 'Dither palette', payload);
    saved.set(key, ref.id);
    toast.show({ icon: 'info', message: `Saved ${ref.name} to Scratch so Design can edit it. Design’s Send to brings it back here.` });
    await shell.sendItem(ref, 'design');
  } catch (e) {
    toast.show({ kind: 'error', message: `Couldn't save the palette for Design: ${e instanceof Error ? e.message : String(e)}` });
  }
}
