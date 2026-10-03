// Edits the canvas, the inspector and the keyboard share. Each is one history step (spec §8).
import type { DocController } from '../../../shared/doc-api.ts';
import type { BuiltinShape } from '../../../shared/pattern/builtins.ts';
import { clipToView, namespace } from '../../../shared/svg/index.ts';
import { unreadable } from '../../lib/load.ts';
import { measureArtwork } from '../../lib/svg-measure.ts';
import { shell } from '../../shell/core/index.ts';
import { toast } from '../../ui/index.ts';
import { builtinSlot, fix, LIMIT, MAX_SLOTS, slotId, type Arrangement, type PatternDoc, type ShapeSlot } from './doc.ts';
import { armed, loading } from './view-state.ts';

export type Doc = DocController<PatternDoc>;

/** a shape on its way in: markup from a file, a paste or the Library */
export type Incoming = { svg: string; name: string; /** how a message names it when it can't be read: the file's name, extension and all */ label?: string };

const fail = (e: unknown) => toast.show({ kind: 'error', message: e instanceof Error ? e.message : String(e) });

/** the markup when it is an SVG this can read; otherwise throws a plain sentence naming it */
export function readSvg(text: string, name: string): string {
  const doc = new DOMParser().parseFromString(text.trim(), 'image/svg+xml');
  const damaged = doc.getElementsByTagName('parsererror').length > 0;
  if (damaged || doc.documentElement.nodeName !== 'svg') throw new Error(unreadable(name, 'an SVG', damaged ? undefined : "Its top element isn't <svg>."));
  return text.trim();
}

/**
 * A user's shape as a slot: its ids made its own, measured by its artwork. It keeps its own colours
 * (spec §5 q2), and looks as it does on its own: art past its viewBox (an Illustrator artboard's
 * bleed, a cropped icon) is clipped there, as a browser shows the file, or the pattern would draw it.
 */
export async function slotFrom({ svg, name, label = name }: Incoming): Promise<ShapeSlot> {
  const id = slotId();
  const markup = namespace(readSvg(svg, label), id);
  const m = await measureArtwork(markup).catch(() => null);
  if (!m || !(m.w > 0 && m.h > 0)) throw new Error(`${name} draws nothing that shows, so it can't be a shape.`);
  // namespace() prefixes every id with `${id}-`, so `${id}_view` is free
  return { id, svg: m.bleeds ? clipToView(markup, `${id}_view`) : markup, name, weight: 1, recolour: false, colour: null, bounds: { x: m.x, y: m.y, w: m.w, h: m.h } };
}

/**
 * New shapes into the pattern, or one in place of `replace`: that keeps its weight, and its own colour
 * when the new shape takes colours too. Up to MAX_SLOTS; `left` names what didn't fit.
 */
export function withSlots(d: PatternDoc, add: ShapeSlot[], replace: string | null): { doc: PatternDoc; left: string[] } {
  const at = replace ? d.slots.findIndex((s) => s.id === replace) : -1;
  if (at >= 0 && add.length) {
    const old = d.slots[at];
    const slots = d.slots.map((s, i) => (i === at ? { ...add[0], weight: old.weight, colour: add[0].recolour ? old.colour : null } : s));
    return { doc: { ...d, slots }, left: [] };
  }
  const room = Math.max(0, MAX_SLOTS - d.slots.length);
  return { doc: { ...d, slots: [...d.slots, ...add.slice(0, room)] }, left: add.slice(room).map((s) => s.name) };
}

/** what a full pattern says about the shapes it couldn't take, by name */
export const leftOut = (left: string[]): string =>
  `A pattern holds up to ${MAX_SLOTS} shapes, so ${left.length === 1 ? `${left[0]} was` : `${left.slice(0, -1).join(', ')} and ${left.at(-1)} were`} left out. Remove one, or use Replace on a shape.`;

/** after a step that threw something away: its Undo, while that step is still the last */
function undoToast(doc: Doc, icon: 'delete' | 'swap_horiz', message: string): void {
  const after = doc.get();
  toast.show({
    icon,
    message,
    when: () => doc.get() === after,
    undo: () => {
      if (doc.get() === after) doc.undo();
      else toast.show({ icon: 'info', message: 'That is no longer the last step. Use Undo in the tool.' });
    },
  });
}

/** one step: the shapes in, or the one in place of `replace` */
function put(doc: Doc, add: ShapeSlot[], replace: string | null): void {
  const d = doc.get();
  const replaced = d.slots.find((s) => s.id === replace);
  const { doc: next, left } = withSlots(d, add, replace);
  doc.transact(replaced ? `Replace ${replaced.name} with ${add[0].name}` : add.length === 1 ? `Add ${add[0].name}` : `Add ${add.length} shapes`, () => next);
  if (replaced) undoToast(doc, 'swap_horiz', `Replaced ${replaced.name} with ${add[0].name}.`);
  if (left.length) toast.show({ icon: 'info', message: leftOut(left) });
}

/** a file, a paste: read and measured, then one step */
export async function addShapes(doc: Doc, incoming: Incoming[], replace: string | null = null): Promise<void> {
  if (!incoming.length) return;
  loading.set(loading.get() + 1);
  try {
    const made = await Promise.allSettled(incoming.map(slotFrom));
    made.forEach((r) => r.status === 'rejected' && fail(r.reason));
    const add = made.flatMap((r) => (r.status === 'fulfilled' ? [r.value] : []));
    if (add.length) put(doc, add, replace);
  } finally {
    loading.set(loading.get() - 1);
  }
}

export const addBuiltin = (doc: Doc, b: BuiltinShape, replace: string | null = null): void => put(doc, [builtinSlot(slotId(), b)], replace);

/** after the armed confirm: one step and an Undo toast (brief rule 3). The last shape stays: a pattern needs one. */
export function removeSlot(doc: Doc, id: string): void {
  armed.set(null);
  const d = doc.get();
  const gone = d.slots.find((s) => s.id === id);
  if (!gone || d.slots.length < 2) return;
  doc.transact(`Remove ${gone.name}`, (x) => ({ ...x, slots: x.slots.filter((s) => s.id !== id) }));
  undoToast(doc, 'delete', `Removed shape ${gone.name}.`);
}

/** a shape colour, after its armed confirm: one step and an Undo toast (brief rule 3). The last colour stays. */
export function removeColour(doc: Doc, at: number): void {
  if (doc.get().palette.length < 2) return;
  doc.transact(`Remove shape colour ${at + 1}`, (x) => ({ ...x, palette: x.palette.filter((_, j) => j !== at) }));
  undoToast(doc, 'delete', `Removed shape colour ${at + 1}.`);
}

const randInt = (lo: number, hi: number) => lo + Math.floor(Math.random() * (hi - lo + 1));
const pick = <T>(list: readonly T[]): T => list[Math.floor(Math.random() * list.length)];

export const reseed = (doc: Doc): void => doc.transact('Reseed', (d) => ({ ...d, seed: randInt(LIMIT.seed[0] + 1, LIMIT.seed[1]) }));

/** A new layout: arrangement, counts, spacing, size, rotation, jitter and seed. Never the shapes or the colours. */
export function surprise(doc: Doc): void {
  const arrangement = pick<Arrangement>(['grid', 'halfdrop', 'brick', 'scatter']);
  const scatter = arrangement === 'scatter';
  const sizeMax = randInt(28, 120);
  // scatter reads as scatter only with enough shapes in the tile, and keeps one gap all round
  const n = scatter ? randInt(4, 7) : randInt(2, 6);
  const gap = () => Math.round(sizeMax * (scatter ? Math.random() * 0.5 : Math.random() * 1.1 - 0.1));
  const gapX = gap();
  const range = pick([15, 30, 45, 180]);
  doc.transact('Surprise me', (d) =>
    fix({
      ...d,
      arrangement,
      cols: n,
      rows: scatter ? n : randInt(Math.max(2, n - 1), n + 1),
      sizeMax,
      sizeMin: Math.random() < 0.5 ? sizeMax : Math.round(sizeMax * (0.45 + Math.random() * 0.45)),
      gapX,
      gapY: scatter ? gapX : gap(),
      rotation: Math.random() < 0.45 ? { ...d.rotation, mode: 'fixed', angle: pick([0, 0, 15, 30, 45, 90, -20]) } : { ...d.rotation, mode: 'random', min: -range, max: range },
      jitter: !scatter && Math.random() < 0.3 ? Math.round(sizeMax * Math.random() * 0.25) : 0,
      seed: randInt(1, LIMIT.seed[1]),
    }),
  );
}

/** an empty pattern in place of this one: one undoable step; the first edit makes Scratch/Untitled pattern N (spec §7.1) */
export async function newPattern(): Promise<void> {
  armed.set(null);
  await shell.newDoc('pattern');
}

/** SVG markup copied from Illustrator, a browser or a text editor, in place of one shape */
export async function replaceFromClipboard(doc: Doc, id: string): Promise<void> {
  const text = await navigator.clipboard.readText().catch(() => '');
  if (!/<svg[\s>]/i.test(text)) return void toast.show({ icon: 'content_paste', message: 'The clipboard holds no SVG markup. Copy an SVG, or use Replace from a file.' });
  await addShapes(doc, [{ svg: text, name: 'Pasted shape' }], id);
}

/** SVG files from a drop, a paste or the file picker; the rest are left for the Library */
export async function takeFiles(doc: Doc, files: File[], replace: string | null = null): Promise<File[]> {
  const svgs = files.filter((f) => f.type === 'image/svg+xml' || /\.svg$/i.test(f.name));
  const incoming = await Promise.all(svgs.map(async (f) => ({ svg: await f.text(), name: f.name.replace(/\.[^.]*$/, '') || 'Pasted shape', label: f.name })));
  await addShapes(doc, incoming, replace).catch(fail);
  return files.filter((f) => !svgs.includes(f));
}
