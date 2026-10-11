// Ways to get colours into a palette: the Add colour menu, the empty state and Ctrl+V share them. A
// source that makes one colour adds its ramp at once (lit by the Light row); one that makes several
// stages them as proposals under a popover first. Nothing here is a new document operation: each is
// addRamp (through addBase / addProposals).
import { cssColor, hexToOklch, parseHex, type Oklch } from '../../../shared/color/index.ts';
import { parseColours } from '../../../shared/palette/paste.ts';
import type { LibraryItemRef } from '../../../shared/types.ts';
import { shell } from '../../shell/core/index.ts';
import { ipc } from '../../shell/core/ipc.ts';
import { menu, toast } from '../../ui/index.ts';
import { plural } from '../common/names.ts';
import { addBase, eyedrop, newPalette, select, selected, type Doc } from './actions.ts';
import { fromPayload, isLayer, looseOf, makeRamps, MAX_RAMPS, type IllustrationDoc } from './doc.ts';
import { extract, picture, propose, sourcePop, type Source } from './proposals.ts';
import { paletteBases, SETS, SUBJECTS, type Subject } from './scene.ts';

export const CAN_PICK = 'EyeDropper' in globalThis;

/** a base colour typed or pasted as hex; null when it isn't one */
export const baseFromHex = (text: string): Oklch | null => {
  const hex = parseHex(text.trim().replace(/^(?!#)/, '#'));
  return hex ? hexToOklch(hex) : null;
};

// ── one colour: its ramp is added at once ───────────────────────────────────────────────────────

/** the Add colour button: the colour the picker shows now, and the picker's field ready to take the one you meant */
export const addColour = (doc: Doc): void => addBase(doc, undefined, '', { focus: true });

/** a subject: its name, its material and a base that suits it */
export const addSubject = (doc: Doc, s: Subject): void => addBase(doc, s.base, s.label, { material: s.material, focus: true });

/** the Add by hex field: false when the text isn't a hex colour (the field shows why) */
export function addTyped(doc: Doc, text: string): boolean {
  const o = baseFromHex(text);
  if (o) addBase(doc, o, '', { focus: true });
  return !!o;
}

// ── several colours: staged under a popover ─────────────────────────────────────────────────────

/** what ctrl+V (or the pasted text of the popover) holds: nothing, one colour (its ramp at once) or a list (staged, sorted light to dark) */
export function pasteColours(doc: Doc, text: string): void {
  const r = parseColours(text);
  if (!r.colours.length) return void toast.show({ icon: 'content_paste', message: 'The clipboard holds no colour codes this can read.' });
  if (r.colours.length === 1) return addBase(doc, r.colours[0], r.names[0] ?? '', { focus: true });
  openSource(doc, 'paste', { text });
}

/** the pasted text as proposals, as it is typed; none when it holds no colour */
export function stagePaste(text: string): void {
  const r = parseColours(text);
  propose('Pasted colours', r.colours, r.names, { from: 'paste', sort: true });
}

/** a limited set built around `hue`, as proposals */
export function stageSet(id: string, hue: number): void {
  const set = SETS.find((x) => x.id === id) ?? SETS[0];
  propose(set.label, set.make(hue), [], { from: 'set', sort: true });
}

/** the hue a limited set starts from: the selected colour's, else a warm one */
export const startHue = (d: IllustrationDoc, id: string | null): number => Math.round(d.swatches.find((w) => w.id === id)?.oklch[2] ?? 55);

/** a Library palette's colours as proposals: each ramp's base with its material, then the loose colours; cut to what this palette has room for */
export function stagePalette(d: IllustrationDoc, from: IllustrationDoc, name: string): void {
  const { list, total } = paletteBases(from, MAX_RAMPS - d.ramps.length);
  const note = list.length < total ? `${name} has ${total} colours; a palette holds ${MAX_RAMPS} ramps, so the first ${list.length} are offered.` : undefined;
  propose(`From ${name}`, list.map((c) => c.oklch), list.map((c) => c.name), { from: 'library', sort: true, materials: list.map((c) => c.material), note });
}

/** the popover for a source; the staged colours it shows are the proposals */
export function openSource(doc: Doc, source: Source, more: { text?: string; set?: string } = {}): void {
  if (source === 'paste' && more.text) stagePaste(more.text);
  if (source === 'set') {
    const set = more.set ?? SETS[0].id;
    stageSet(set, startHue(doc.get(), selected(doc.get())?.id ?? null));
    return sourcePop.set({ source, set });
  }
  if (source === 'image' && picture.get()) extract();
  sourcePop.set({ source, ...more });
}

/** a Library palette read for the popover; null (and a message) when it can't be */
export async function readPalette(ref: LibraryItemRef): Promise<IllustrationDoc | null> {
  const item = await ipc.invoke('library.read', ref.id).catch((e: unknown) => {
    toast.show({ kind: 'error', message: `${ref.name} couldn't be read: ${e instanceof Error ? e.message : String(e)}` });
    return null;
  });
  return item?.kind === 'palette' ? fromPayload(item.payload) : null;
}

/**
 * A palette from the Library, made into ramps as a palette of its own in Scratch ("<name> ramps"): the
 * source stays as it is for every tool that uses it. One that is already all ramps just opens.
 */
export async function openPalette(doc: Doc, ref: LibraryItemRef): Promise<void> {
  const from = await readPalette(ref);
  if (!from) return;
  const all = looseOf(from).filter((w) => !isLayer(w)).map((w) => w.id);
  if (!all.length) return void shell.openItem(ref);
  // a palette of its own holds as many ramps as any other
  const ids = all.slice(0, MAX_RAMPS);
  if (ids.length < all.length) toast.show({ icon: 'info', message: `A palette holds ${MAX_RAMPS} ramps: ${plural(ids.length, 'colour')} made, ${all.length - ids.length} left as they are.` });
  await newPalette(doc, `${ref.name} ramps`);
  doc.transact(`Make ramps from ${ref.name}`, () => makeRamps(from, ids));
  select(ids[0]);
}

/**
 * The sources menu (From…), worded and ordered as Design's + Add colours: the sources, then a ramp for a
 * subject, then a limited set. Design's Open from Library opens the Library; here a palette's colours are
 * added to this one, so it reads From Library.
 */
export function addMenu(doc: Doc, anchor: DOMRect, owner: Element, fromKey: boolean): void {
  menu.open(
    anchor,
    [
      { label: 'From image…', icon: 'image', onSelect: () => openSource(doc, 'image') },
      { label: 'Paste codes…', icon: 'content_paste', shortcut: 'Ctrl+V', onSelect: () => openSource(doc, 'paste') },
      ...(CAN_PICK ? [{ label: 'Pick from screen', icon: 'colorize' as const, shortcut: 'I', onSelect: () => void eyedrop(doc) }] : []),
      { label: 'From Library…', icon: 'folder_open', onSelect: () => openSource(doc, 'library') },
      { header: 'Subject' },
      ...SUBJECTS.map((s) => ({ label: s.label, swatch: cssColor(s.base), onSelect: () => addSubject(doc, s) })),
      { header: 'Limited set' },
      ...SETS.map((s) => ({ label: s.label, onSelect: () => openSource(doc, 'set', { set: s.id }) })),
    ],
    { owner, initial: fromKey ? 0 : undefined },
  );
}
