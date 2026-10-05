// Ways to get a first (or next) base colour: the Palette panel's "+" menu and the empty state share
// them. Nothing here is a new document operation: each is addRamp / makeRamps / a proposal.
import { hexToOklch, parseHex, type Oklch } from '../../../shared/color/index.ts';
import { fitChroma } from '../../../shared/palette/space.ts';
import type { LibraryItemRef, MaterialId } from '../../../shared/types.ts';
import { shell } from '../../shell/core/index.ts';
import { ipc } from '../../shell/core/ipc.ts';
import { menu, toast, type MenuItem } from '../../ui/index.ts';
import { addBase, eyedrop, newPalette, select, type Doc } from './actions.ts';
import { addRamp, fromPayload, looseOf, makeRamps, setSpec } from './doc.ts';
import { propose } from './proposals.ts';

export const CAN_PICK = 'EyeDropper' in globalThis;

/** the hidden file input View keeps for "Pick from an image" */
export const pickImage = (): void => document.querySelector<HTMLInputElement>('[data-illustration-image]')?.click();

/** a base colour typed or pasted as hex; null when it isn't one */
export const baseFromHex = (text: string): Oklch | null => {
  const hex = parseHex(text.trim().replace(/^(?!#)/, '#'));
  return hex ? hexToOklch(hex) : null;
};

/** every hex code in the clipboard offered as new bases (the proposals row, nothing added yet) */
export async function pasteHexList(): Promise<void> {
  const text = await navigator.clipboard.readText().catch(() => '');
  const colours = [...text.matchAll(/#?\b([0-9a-f]{6}|[0-9a-f]{3})\b/gi)].map((m) => baseFromHex(m[1])).filter((c): c is Oklch => !!c);
  if (!colours.length) return void toast.show({ kind: 'error', message: 'The clipboard has no hex codes to take.' });
  propose('From the clipboard', colours);
}

/** the starter chips of the empty state: a hue, a light and a shadow colour and a material, pre-set */
export const STARTERS: { id: string; label: string; base: Oklch; light: Oklch; shadow: Oklch; material: MaterialId; dot: Oklch }[] = [
  { id: 'skin', label: 'Skin', base: [0.74, 0.075, 55], light: [0.96, 0.035, 85], shadow: [0.45, 0.09, 15], material: 'skin', dot: [0.74, 0.075, 55] },
  { id: 'foliage', label: 'Foliage', base: [0.6, 0.12, 140], light: [0.95, 0.09, 105], shadow: [0.35, 0.07, 250], material: 'foliage', dot: [0.6, 0.12, 140] },
  { id: 'night', label: 'Night sky', base: [0.4, 0.1, 265], light: [0.8, 0.08, 230], shadow: [0.2, 0.07, 285], material: 'cloth', dot: [0.4, 0.1, 265] },
  { id: 'warm', label: 'Warm light', base: [0.82, 0.13, 75], light: [0.98, 0.05, 95], shadow: [0.5, 0.12, 35], material: 'paper', dot: [0.82, 0.13, 75] },
];

export function addStarter(doc: Doc, s: (typeof STARTERS)[number]): void {
  let base = '';
  doc.transact(`Add ${s.label.toLowerCase()} base`, (d) => {
    const r = addRamp(d, fitChroma(s.base));
    base = r.base;
    const group = r.doc.swatches.find((w) => w.id === r.base)?.group;
    return group ? setSpec(r.doc, group, { light: s.light, shadow: s.shadow, material: s.material }) : r.doc;
  });
  select(base);
}

/**
 * A palette from the Library, made into ramps as a new palette in Scratch ("<name> ramps"): the
 * source stays as it is for every tool that uses it. One that is already all ramps just opens.
 */
export async function openPalette(doc: Doc, ref: LibraryItemRef): Promise<void> {
  const item = await ipc.invoke('library.read', ref.id).catch((e: unknown) => {
    toast.show({ kind: 'error', message: `${ref.name} couldn't be read: ${e instanceof Error ? e.message : String(e)}` });
    return null;
  });
  if (item?.kind !== 'palette') return;
  const from = fromPayload(item.payload);
  const ids = looseOf(from).map((w) => w.id);
  if (!ids.length) return void shell.openItem(ref);
  await newPalette(`${ref.name} ramps`);
  doc.transact(`Make ramps from ${ref.name}`, () => makeRamps(from, ids));
  select(ids[0]);
}

/** the Library's palettes as menu rows, under a header (the "Make ramps from a palette" job) */
export function libraryPalettes(doc: Doc): MenuItem[] {
  const library = shell.getState().library;
  const rows: MenuItem[] = (library?.collections ?? []).flatMap((c) => {
    const palettes = c.items.filter((i) => i.kind === 'palette');
    return palettes.length ? [{ header: c.name || 'Library root' }, ...palettes.map((ref) => ({ label: ref.name, icon: 'palette' as const, onSelect: () => void openPalette(doc, ref) }))] : [];
  });
  return rows.length ? rows : [{ label: 'The Library has no palettes yet', disabled: true }];
}

/** the "Make ramps from a palette" menu on its own (the empty state's button) */
export function fromPaletteMenu(doc: Doc, anchor: DOMRect, owner: Element, fromKey: boolean): void {
  menu.open(anchor, libraryPalettes(doc), { owner, initial: fromKey ? 0 : undefined });
}

/** the Palette panel's "+" */
export function addMenu(doc: Doc, anchor: DOMRect, owner: Element, fromKey: boolean): void {
  menu.open(
    anchor,
    [
      { label: 'New base colour', icon: 'add', shortcut: 'Shift+A', onSelect: () => addBase(doc) },
      { label: 'From an image', icon: 'add_photo_alternate', onSelect: pickImage },
      ...(CAN_PICK ? [{ label: 'From the screen', icon: 'colorize' as const, shortcut: 'I', onSelect: () => void eyedrop(doc) }] : []),
      { label: 'Paste a hex list', icon: 'content_paste', onSelect: () => void pasteHexList() },
      'separator',
      { header: 'Make ramps from a palette' },
      ...libraryPalettes(doc),
    ],
    { owner, initial: fromKey ? 0 : undefined },
  );
}
