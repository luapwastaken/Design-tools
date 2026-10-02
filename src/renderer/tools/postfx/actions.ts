// What the tool does to its document besides single values: opening an image, a GIF or a clip, the
// stack's own edits (add, hide, move, duplicate, delete with Undo), presets and share codes, and a
// Library palette as the colours of the colour effects.
import { toHex, type Oklch } from '../../../shared/color/index.ts';
import type { DocController } from '../../../shared/doc-api.ts';
import type { LibraryItemRef, Swatch } from '../../../shared/types.ts';
import { unsupportedImage } from '../../lib/load.ts';
import { rasterize } from '../../shell/core/rasterize.ts';
import { shell } from '../../shell/core/index.ts';
import { toast } from '../../ui/index.ts';
import { plural } from '../common/names.ts';
import { effectOf, fromPalette, type EffectId } from './effects/index.ts';
import { duplicateLayer, fix, layerOf, LIMIT, mapLayer, moveLayer, offered, removeLayer, type Layer, type PostFxDoc, type Source } from './doc.ts';

import { isVideoFile, sourceOf } from './media.ts';
import type { Preset } from './presets.ts';
import { decodeStack } from './share.ts';
import { getView, patchView } from './view-state.ts';

export { sourceOf };

export type Doc = DocController<PostFxDoc>;

const ID = 'postfx';

const baseName = (file: string) => file.replace(/\.[^.]*$/, '') || 'Pasted image';

const isSvg = (f: File) => f.type === 'image/svg+xml' || /\.svg$/i.test(f.name);
const isImage = (f: File) => isSvg(f) || (f.type.startsWith('image/') && !unsupportedImage(f.type, f.name)) || /\.tiff?$/i.test(f.name);
/** a file this tool opens, or says plainly why not (a ProRes .mov, a PSD) */
const opens = (f: File) => isImage(f) || isVideoFile(f.type, f.name) || /\.(psd|heic|heif)$/i.test(f.name);

/** an SVG file drawn as the shell draws a Library SVG "as an image": 4096 px on its long side */
async function svgAsPng(file: File): Promise<Blob> {
  const url = URL.createObjectURL(file);
  try {
    return await rasterize({ kind: 'svg', url, ref: { name: baseName(file.name) } as LibraryItemRef });
  } finally {
    URL.revokeObjectURL(url);
  }
}

/** a new source starts at its first frame */
const withSource = (d: PostFxDoc, source: Source): PostFxDoc => fix({ ...d, source, time: 0 });

/** bumped by each open, so one that reads slowly never lands over a later one */
let opening = 0;

/** the first image or clip among dropped, pasted or picked files, opened as one step; the rest are left for the Library */
export async function takeFiles(doc: Doc, files: File[]): Promise<File[]> {
  const file = files.find(opens);
  if (!file) return files;
  const mine = ++opening;
  const name = baseName(file.name);
  try {
    const why = isVideoFile(file.type, file.name) ? null : unsupportedImage(file.type, file.name);
    if (why) throw new Error(why);
    const source = await shell.runBusy(async () => (isSvg(file) ? sourceOf(await svgAsPng(file), name, 'png') : sourceOf(file, name)));
    if (mine === opening) doc.transact(`Open ${name}`, (d) => withSource(d, source));
  } catch (e) {
    if (mine === opening) toast.show({ kind: 'error', message: e instanceof Error ? e.message : String(e) });
  }
  return files.filter((f) => f !== file);
}

/** the file picker, from the doc bar, the empty state and Ctrl+O */
export function pickFile(doc: Doc): void {
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = 'image/*,video/mp4,video/webm,.mp4,.webm,.m4v,.mov,.tif,.tiff,.svg';
  input.onchange = () => void takeFiles(doc, [...(input.files ?? [])]).then((left) => left.length && toast.show({ icon: 'block', message: `${left[0].name} isn't an image or a clip this tool can open.` }));
  input.click();
}

export const labelOf = (l: Pick<Layer, 'effect'>): string => effectOf(l.effect)?.label ?? l.effect;

// ── the stack ────────────────────────────────────────────────────────────────────────────────

const select = (id: string | null) => patchView({ selected: id });

/** under the selected layer, or at the bottom; it becomes the selected one */
export function addEffect(doc: Doc, effect: EffectId): void {
  const d = doc.get();
  if (d.stack.length >= LIMIT.layers) return void toast.show({ icon: 'info', message: `A stack holds up to ${LIMIT.layers} layers.` });
  if (!offered(d, effect)) return;
  const l = layerOf(effect);
  const at = d.stack.findIndex((x) => x.id === getView().selected);
  const to = at < 0 ? d.stack.length : at + 1;
  doc.transact(`Add ${labelOf(l)}`, (x) => ({ ...x, stack: [...x.stack.slice(0, to), l, ...x.stack.slice(to)] }));
  select(l.id);
}

export function toggleLayer(doc: Doc, id: string): void {
  const l = doc.get().stack.find((x) => x.id === id);
  if (l) doc.transact(`${l.on ? 'Hide' : 'Show'} ${labelOf(l)}`, (d) => mapLayer(d, id, (x) => ({ ...x, on: !x.on })));
}

/** by a drag (before slot `to`) or Alt and an arrow */
export function moveTo(doc: Doc, id: string, to: number): void {
  const d = doc.get();
  const from = d.stack.findIndex((l) => l.id === id);
  if (from < 0 || to === from || to === from + 1) return;
  doc.transact(`Move ${labelOf(d.stack[from])} ${to < from ? 'up' : 'down'}`, (x) => moveLayer(x, from, to));
}

export function duplicate(doc: Doc, id: string): void {
  const d = doc.get();
  if (d.stack.length >= LIMIT.layers) return void toast.show({ icon: 'info', message: `A stack holds up to ${LIMIT.layers} layers.` });
  const { doc: next, copy } = duplicateLayer(d, id);
  if (!copy) return;
  doc.transact(`Duplicate ${labelOf(copy)}`, () => next);
  select(copy.id);
}

/** after the armed confirm: one step, and an Undo toast (brief rule 3) */
export function deleteLayer(doc: Doc, id: string): void {
  const d = doc.get();
  const at = d.stack.findIndex((l) => l.id === id);
  if (at < 0) return;
  const l = d.stack[at];
  doc.transact(`Delete ${labelOf(l)}`, (x) => removeLayer(x, id));
  const after = doc.get();
  select(after.stack[Math.min(at, after.stack.length - 1)]?.id ?? null);
  toast.show({
    icon: 'delete',
    message: `Deleted ${labelOf(l)}.`,
    when: () => doc.get() === after,
    undo: () => {
      if (doc.get() !== after) return void toast.show({ icon: 'info', message: 'The delete is no longer the last step. Use Undo in the tool.' });
      doc.undo();
      select(id);
    },
  });
}

export function resetLayer(doc: Doc, id: string): void {
  const l = doc.get().stack.find((x) => x.id === id);
  if (!l) return;
  const fresh = layerOf(l.effect);
  doc.transact(`Reset ${labelOf(l)}`, (d) => mapLayer(d, id, (x) => ({ ...x, opacity: 1, blend: 'normal', params: fresh.params })));
}

/** a preset or a pasted code replaces the stack in one step; Undo brings the old one back */
function replaceStack(doc: Doc, label: string, layers: Layer[]): void {
  const fresh = layers.map((l) => ({ ...l, id: crypto.randomUUID(), params: { ...l.params } }));
  doc.transact(label, (d) => ({ ...d, stack: fresh }));
  select(fresh[0]?.id ?? null);
  const skipped = fresh.filter((l) => !offered(doc.get(), l.effect));
  if (skipped.length) toast.show({ icon: 'info', message: `${skipped.map(labelOf).join(' and ')} ${skipped.length === 1 ? 'works' : 'work'} on video only, so ${skipped.length === 1 ? 'it is' : 'they are'} skipped until a clip is open.` });
}

export const applyPreset = (doc: Doc, p: Preset): void => replaceStack(doc, `Use the ${p.name} preset`, p.layers);

/** a pasted share code (the field has checked it reads) */
export function importCode(doc: Doc, code: string): void {
  const layers = decodeStack(code);
  replaceStack(doc, `Paste a stack of ${plural(layers.length, 'layer')}`, layers);
}

// ── colours from a palette ───────────────────────────────────────────────────────────────────

/** the layer's colour settings from the palette (effects/: each from its place between the darkest and lightest), or null when it takes none */
function recolour(l: Layer, colours: Oklch[]): Layer | null {
  const picked = fromPalette(l.effect, colours);
  return Object.keys(picked).length ? { ...l, params: { ...l.params, ...picked } } : null;
}

/**
 * Send to: EFFECT COLOURS. The palette colours the selected layer if it takes colours, else every
 * colour layer in the stack; with none, it arrives as a gradient map (plan unit V).
 */
export function withPalette(d: PostFxDoc, name: string, swatches: Swatch[]): PostFxDoc {
  const colours = swatches.map((w) => w.oklch);
  if (!colours.length) throw new Error(`${name} has no colours yet.`);
  const sel = d.stack.find((l) => l.id === getView().selected);
  const one = sel && recolour(sel, colours);
  if (one) return { ...d, stack: d.stack.map((l) => (l.id === one.id ? one : l)) };
  const all = d.stack.map((l) => recolour(l, colours) ?? l);
  if (all.some((l, n) => l !== d.stack[n])) return { ...d, stack: all };
  if (d.stack.length >= LIMIT.layers) throw new Error(`The stack is full (${LIMIT.layers} layers), so there is no room for a gradient map of ${name}.`);
  const map = recolour(layerOf('gradient-map'), colours)!;
  queueMicrotask(() => select(map.id));
  const unique = new Set(colours.map(toHex)).size;
  if (unique < 2) toast.show({ icon: 'info', message: `${name} has one colour, so the gradient map is flat.` });
  return { ...d, stack: [...d.stack, map] };
}
