// Edits the stage, the inspector and the keyboard share. Each is one history step (spec §8).
import type { DocController } from '../../../shared/doc-api.ts';
import type { Swatch } from '../../../shared/types.ts';
import { shell } from '../../shell/core/index.ts';
import { toast } from '../../ui/index.ts';
import { partAs, partFromImage, partFromSvg } from './intake.ts';
import { ALIGNS, available, fix, KIND_LABEL, lockupOf, mapLockup, proposed, twoParts, withPart, type LockupKind, type LogoDoc, type Part, type Role } from './doc.ts';
import { armed, getView, loading, palette, patchView, target } from './view-state.ts';

export type Doc = DocController<LogoDoc>;

const fail = (e: unknown) => toast.show({ kind: 'error', message: e instanceof Error ? e.message : String(e) });

/** where an incoming part goes when nothing says: a pick's target, else the first empty part, icon first (plan unit V) */
export function nextRole(d: LogoDoc | null): Role {
  return target.get() ?? (d?.icon && !d.wordmark ? 'wordmark' : 'icon');
}

const isSvg = (f: File) => f.type === 'image/svg+xml' || /\.svg$/i.test(f.name);
const isImage = (f: File) => f.type.startsWith('image/') && !isSvg(f);
const baseName = (f: File, role: Role) => f.name.replace(/\.[^.]*$/, '') || `Pasted ${role}`;

/** measures a part while its slot shows it's being read */
async function reading<T>(role: Role, run: () => Promise<T>): Promise<T> {
  loading.set([...loading.get(), role]);
  try {
    return await run();
  } finally {
    const list = [...loading.get()];
    list.splice(list.indexOf(role), 1);
    loading.set(list);
  }
}

export const svgPart = (svg: string, name: string, role: Role): Promise<Part> => reading(role, () => partFromSvg(svg, name, role));
export const imagePart = (blob: Blob, name: string, role: Role): Promise<Part> => reading(role, () => partFromImage(blob, name, role));

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

/** a measured part into its slot: one step, with an Undo toast when it replaced one */
export function putPart(doc: Doc, role: Role, part: Part): void {
  const old = doc.get()[role];
  doc.transact(old ? `Replace the ${role} with ${part.name}` : `${part.name} as the ${role}`, (d) => withPart(d, role, part));
  if (old) undoToast(doc, 'swap_horiz', `Replaced the ${role}, ${old.name}, with ${part.name}.`);
}

/** after the armed confirm: one step and an Undo toast (brief rule 3) */
export function removePart(doc: Doc, role: Role): void {
  armed.set(null);
  const gone = doc.get()[role];
  if (!gone) return;
  doc.transact(`Remove the ${role}`, (d) => withPart(d, role, null));
  undoToast(doc, 'delete', `Removed the ${role}, ${gone.name}.`);
}

/**
 * Icon and wordmark trade places: a paste fills the icon first, so a wordmark pasted alone lands
 * there. Each is measured again for its new job (a wordmark's cap height and baseline).
 */
export async function swapParts(doc: Doc): Promise<void> {
  const { icon, wordmark } = doc.get();
  try {
    const [nextIcon, nextWordmark] = await Promise.all([wordmark && partAs(wordmark, 'icon'), icon && reading('wordmark', () => partAs(icon, 'wordmark'))]);
    doc.transact('Swap icon and wordmark', (d) => withPart(withPart({ ...d, icon: null, wordmark: null }, 'icon', nextIcon), 'wordmark', nextWordmark));
    // the pair's shapes changed places, so every lockup was proposed again
    if (icon && wordmark) undoToast(doc, 'swap_horiz', 'Swapped icon and wordmark. The lockups’ proportions were proposed again.');
  } catch (e) {
    fail(e);
  }
}

/**
 * Files from a drop, a paste or the file picker: the first SVG or image into `role` (or the first
 * empty part), a second into the other part while it's empty. The rest are left for the Library.
 */
export async function takeFiles(doc: Doc, files: File[], role: Role | null = null): Promise<File[]> {
  const usable = files.filter((f) => isSvg(f) || isImage(f));
  const d = doc.get();
  const first = role ?? nextRole(d);
  const other: Role = first === 'icon' ? 'wordmark' : 'icon';
  const plan: [File, Role][] = usable.slice(0, 1).map((f) => [f, first]);
  if (usable[1] && !d[other]) plan.push([usable[1], other]);
  for (const [f, r] of plan) {
    try {
      const part = isSvg(f) ? await svgPart(await f.text(), baseName(f, r), r) : await imagePart(f, baseName(f, r), r);
      putPart(doc, r, part);
    } catch (e) {
      fail(e);
    }
  }
  const taken = plan.map(([f]) => f);
  return files.filter((f) => !taken.includes(f));
}

/** SVG markup from the clipboard (Illustrator's Copy, a browser, a text editor) */
export async function takeMarkup(doc: Doc, text: string, role: Role | null = null): Promise<void> {
  const r = role ?? nextRole(doc.get());
  try {
    putPart(doc, r, await svgPart(text, `Pasted ${r}`, r));
  } catch (e) {
    fail(e);
  }
}

export async function pasteInto(doc: Doc, role: Role): Promise<void> {
  const text = await navigator.clipboard.readText().catch(() => '');
  if (!/<svg[\s>]/i.test(text)) return void toast.show({ icon: 'content_paste', message: 'The clipboard holds no SVG markup. Copy an SVG, or choose a file.' });
  await takeMarkup(doc, text, role);
}

/** a Library SVG or image into one part: the shell delivers it, receive reads `target` */
export function sendInto(ref: Parameters<typeof shell.sendItem>[0], role: Role): Promise<void> {
  target.set(role);
  return shell.sendItem(ref, 'logo').finally(() => target.set(null));
}

// -- lockups --

/** the lockup being edited: the chosen one while it's on and drawable, else the first that is */
export function editedKind(d: LogoDoc, chosen: LockupKind): LockupKind | null {
  const ok = (k: LockupKind) => lockupOf(d, k).on && available(d, k);
  return ok(chosen) ? chosen : (d.lockups.find((l) => ok(l.kind))?.kind ?? null);
}

export const select = (kind: LockupKind): void => patchView({ lockup: kind, mode: 'edit' });

export function toggleLockup(doc: Doc, kind: LockupKind, on: boolean): void {
  doc.transact(`${on ? 'Turn on' : 'Turn off'} ${KIND_LABEL[kind].toLowerCase()}`, (d) => mapLockup(d, kind, (l) => ({ ...l, on })));
  if (on) patchView({ lockup: kind });
}

/** the lockup's proportions as the parts propose them */
export function resetProportions(doc: Doc, kind: LockupKind): void {
  const p = proposed(doc.get()).find((l) => l.kind === kind);
  if (p) doc.transact(`Proposed proportions for ${KIND_LABEL[kind].toLowerCase()}`, (d) => mapLockup(d, kind, (l) => ({ ...l, ratio: p.ratio, gap: p.gap, align: p.align })));
}

/**
 * This lockup's ratio and gap to every other two-part lockup, and its alignment to those that
 * align the same way (side by side aligns vertically, stacked horizontally).
 */
export function copyProportions(doc: Doc, kind: LockupKind): void {
  const from = lockupOf(doc.get(), kind);
  doc.transact(`Copy ${KIND_LABEL[kind].toLowerCase()} proportions to all`, (d) => ({
    ...d,
    lockups: d.lockups.map((l) => (l.kind === kind || !twoParts(l.kind) ? l : { ...l, ratio: from.ratio, gap: from.gap, align: ALIGNS[l.kind].includes(from.align) ? from.align : l.align })),
  }));
}

/** step through the lockups that are on (arrow keys) */
export function step(doc: Doc, by: 1 | -1): void {
  const d = doc.get();
  const on = d.lockups.filter((l) => l.on && available(d, l.kind)).map((l) => l.kind);
  const at = on.indexOf(editedKind(d, getView().lockup) ?? on[0]);
  if (on.length) patchView({ lockup: on[(at + by + on.length) % on.length] });
}

// -- colour --

/** the palette's brand colour: its Brand or Primary role, else its most colourful swatch */
function brandColour(list: Swatch[]): Swatch | null {
  const byRole = list.find((w) => /^(brand|primary)/i.test(w.role ?? '')) ?? list.find((w) => /accent/i.test(w.role ?? ''));
  return byRole ?? [...list].sort((a, b) => b.oklch[1] - a.oklch[1])[0] ?? null;
}

export function takePalette(d: LogoDoc, name: string, swatches: Swatch[]): LogoDoc {
  const w = brandColour(swatches);
  if (!w) throw new Error(`${name} has no colours.`);
  palette.set({ name, swatches });
  return fix({ ...d, colour: w.oklch, versions: [...d.versions, 'colour'] });
}

/** an empty logo in place of this one: one undoable step; the first part makes Scratch/Untitled logo N (spec §7.1) */
export async function newLogo(): Promise<void> {
  armed.set(null);
  await shell.newDoc('logo');
}
