// Edits the row, the inspector and the keyboard share. Each is one history step (spec §8).
import { contrast, hexToOklch, toHex, type Oklch } from '../../../shared/color/index.ts';
import { holdValue, valueOf } from '../../../shared/color/value.ts';
import type { DocController } from '../../../shared/doc-api.ts';
import { buildRoles, completeRoles, STYLE_LIST, styleGround } from '../../../shared/palette/brand.ts';
import { gradientStops } from '../../../shared/palette/gradient.ts';
import { ROLES, type Role } from '../../../shared/palette/roles.ts';
import { fitChroma } from '../../../shared/palette/space.ts';
import type { Swatch } from '../../../shared/types.ts';
import { shell } from '../../shell/core/index.ts';
import { copyColour, pickFromScreen, toast, type NumberGesture } from '../../ui/index.ts';
import { nextV } from './adjust.ts';
import { suggestRoles } from './artboard.ts';
import { runComplete, runGenerate } from './build.ts';
import { displayName, insertAfter, jobHolders, listNames, moveIds, newSwatch, plural, recolour, removeIds, type BuildMethod, type DesignDoc, type DesignView } from './doc.ts';
import { clearProposals, dropProposals, proposals, proposalsFrom, type Proposal } from './proposals.ts';
import { armed, getView, patchView } from './view-state.ts';

export type Doc = DocController<DesignDoc>;

/** the selected swatches that still exist, in selection order; the first swatch when none is */
export function selection(d: DesignDoc, v: DesignView = getView()): string[] {
  const ids = v.selected.filter((id) => d.swatches.some((w) => w.id === id));
  return ids.length || !d.swatches.length ? ids : [d.swatches[0].id];
}

export const activeSwatch = (d: DesignDoc, v?: DesignView) => d.swatches.find((w) => w.id === selection(d, v)[0]) ?? null;

export const select = (ids: string[]): void => patchView({ selected: ids });

export const focusChip = (id: string | undefined): void =>
  void requestAnimationFrame(() => document.querySelector<HTMLElement>(`[data-swatch="${id}"]`)?.focus({ preventScroll: false }));

/** click: one; Ctrl: toggle, the active one staying first; Shift: the run from the active one */
export function clickSelect(d: DesignDoc, id: string, how: { ctrl: boolean; shift: boolean }): void {
  const cur = selection(d);
  if (how.shift && cur.length) {
    const ids = d.swatches.map((w) => w.id);
    const [a, b] = [ids.indexOf(cur[0]), ids.indexOf(id)].sort((x, y) => x - y);
    select([cur[0], ...ids.slice(a, b + 1).filter((x) => x !== cur[0])]);
  } else if (how.ctrl) select(cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id]);
  else select([id]);
}

/** arrow keys: the neighbour becomes the one selected swatch */
export function step(doc: Doc, dir: -1 | 1): void {
  const d = doc.get();
  // the arrows belong to whatever has focus outside the tool (the rail, the Library)
  const el = document.activeElement;
  if (!d.swatches.length || (el && el !== document.body && !el.closest('[data-tool="design"]'))) return;
  const i = d.swatches.findIndex((w) => w.id === selection(d)[0]);
  const next = d.swatches[Math.min(d.swatches.length - 1, Math.max(0, i + dir))].id;
  select([next]);
  if (document.activeElement?.closest('[data-swatch]')) focusChip(next);
}

/** the active swatch's hue at the value the palette is missing most */
export function addSwatch(doc: Doc): void {
  const d = doc.get();
  const base = activeSwatch(d);
  const v = nextV(d.swatches.map((w) => valueOf(w.oklch)));
  const w = newSwatch(base ? holdValue(v, base.oklch[1], base.oklch[2]) : holdValue(v, 0.12, 250));
  doc.transact('Add swatch', (x) => insertAfter(x, base?.id ?? null, [w]));
  select([w.id]);
}

export function duplicate(doc: Doc): void {
  const d = doc.get();
  const ids = selection(d);
  if (!ids.length) return;
  // a copy is a new colour, never a second Illustration ramp step in the same place
  const copies = d.swatches.filter((w) => ids.includes(w.id)).map(({ group: _g, step: _s, edited: _e, ...w }) => ({ ...w, id: crypto.randomUUID(), name: w.name && `${w.name} copy` }));
  const last = d.swatches.filter((w) => ids.includes(w.id)).at(-1)!.id;
  doc.transact(copies.length === 1 ? 'Duplicate swatch' : `Duplicate ${copies.length} swatches`, (x) => insertAfter(x, last, copies));
  select(copies.map((w) => w.id));
}

/** after the armed confirm: one step, and an Undo toast (brief rule 3) */
export function deleteSelected(doc: Doc): void {
  armed.set(false);
  const d = doc.get();
  const ids = selection(d);
  const gone = d.swatches.filter((w) => ids.includes(w.id));
  if (!gone.length) return;
  const i = d.swatches.findIndex((w) => w.id === ids[0]);
  doc.transact(gone.length === 1 ? `Delete ${displayName(gone[0])}` : `Delete ${gone.length} swatches`, (x) => removeIds(x, ids));
  const after = doc.get();
  const next = after.swatches[Math.min(i, after.swatches.length - 1)]?.id;
  select(next ? [next] : []);
  focusChip(next);
  toast.show({
    icon: 'delete',
    message: gone.length === 1 ? `Removed swatch ${displayName(gone[0])}.` : `Removed ${listNames(gone.map(displayName).slice(0, 3))}${gone.length > 3 ? ` and ${gone.length - 3} more` : ''}.`,
    when: () => doc.get() === after,
    undo: () => {
      if (doc.get() !== after) return void toast.show({ icon: 'info', message: 'The delete is no longer the last step. Use Undo in the tool.' });
      doc.undo();
      select(ids);
    },
  });
}

/**
 * The role each proposal takes when it is kept: the one it was made for (Complete the palette) when
 * the palette lacks it, and with `assign` (Keep all) the roles still missing, suggested from the
 * colours. The ghost chips show these before the press, so Keep all does what the row said.
 */
export function proposedRoles(swatches: Swatch[], items: Proposal[], assign: boolean): { given: (string | null)[]; roles: (string | null)[] } {
  const used = new Set(swatches.flatMap((w) => (w.role ? [w.role] : [])));
  const given = items.map((p) => (p.role && !used.has(p.role) ? p.role : null));
  const suggested = assign
    ? suggestRoles(items.map((p) => p.oklch), new Set([...used, ...given.filter((r): r is string => !!r)]), new Set(given.flatMap((r, i) => (r ? [i] : []))), items.map((p) => p.share))
    : [];
  return { given, roles: given.map((r, i) => r ?? suggested[i] ?? null) };
}

/** what a toast says about colours that came in from a file or a paste: they start locked */
export const KEPT_NOTE = 'Imported colours are locked, so Reroll and Variations keep them. Unlock one (L) to let it change.';

/** palette files already opened this session, so a reopen doesn't lock what Luap unlocked */
const opened = new Set<string>();

/**
 * A palette read from an .ase, .aco or .gpl file (every swatch still holds its imported values)
 * opens with every colour locked, once: Reroll and Variations would otherwise replace a brand's
 * colours with invented ones. A view setting, so the file is not touched.
 */
export function lockImported(itemId: string, swatches: Swatch[]): void {
  if (opened.has(itemId) || !swatches.length || !swatches.every((w) => w.source)) return;
  opened.add(itemId);
  patchView({ locked: swatches.map((w) => w.id) });
  toast.show({ icon: 'lock', message: KEPT_NOTE });
}

/**
 * Proposals into the palette, one step. A proposal made for a role (Complete the palette) takes it;
 * with `assign` (Keep all) the rest are given the roles the palette lacks (suggestRoles), and a role
 * the palette already uses is never taken from its owner. Colours kept from a logo or SVG are the
 * client's own and start locked (`from`), and so do pasted codes (their colours are given, not
 * guessed); an image's are not.
 */
export function addProposals(doc: Doc, items: Proposal[], assign = false, from?: BuildMethod): void {
  if (!items.length) return;
  const { given, roles } = proposedRoles(doc.get().swatches, items, assign);
  const add = items.map((p, i) => newSwatch(p.oklch, p.name ?? '', roles[i]));
  doc.transact(items.length === 1 ? 'Add colour' : `Add ${plural(items.length, 'colour')}`, (d) => insertAfter(d, null, add));
  dropProposals(items.map((p) => p.id));
  // the brand colour in the inspector (the first one when none is): selecting all would read as editing all of them
  const lead = add.find((w) => w.role === 'Primary') ?? add[0];
  const keeps = from === 'logo' || from === 'paste';
  patchView({ selected: [lead.id], ...(keeps && { locked: [...new Set([...getView().locked, ...add.map((w) => w.id)])] }) });
  const guessed = add.filter((_, i) => roles[i] && !given[i]);
  if (!guessed.length && from !== 'paste') return;
  const after = doc.get();
  toast.show({
    icon: guessed.length ? 'info' : 'lock',
    message: `${guessed.length ? `Roles suggested: ${listNames(guessed.map((w) => w.role!))}.` : ''}${from === 'logo' ? ' The logo colours are locked.' : ''}${from === 'paste' ? ` ${KEPT_NOTE}` : ''}`.trim(),
    when: () => doc.get() === after,
    undo: () => void (doc.get() === after && doc.undo()),
  });
}

/** an empty palette in place of this one: one undoable step; the first edit makes Scratch/Untitled palette N (spec §7.1) */
export async function newPalette(): Promise<void> {
  armed.set(false);
  clearProposals(); // they were built for the palette that was open
  select([]);
  await shell.newDoc('design');
}

export function setColours(doc: Doc, label: string, changes: Record<string, Oklch>): void {
  doc.transact(label, (d) => recolour(d, changes));
}

/** any pixel on screen (native EyeDropper): into the active swatch, or the brand colour of a new palette */
export async function eyedrop(doc: Doc): Promise<void> {
  const hex = await pickFromScreen();
  if (!hex) return;
  const o = hexToOklch(hex);
  const active = activeSwatch(doc.get());
  if (active) setColours(doc, 'Pick colour from screen', { [active.id]: o });
  else buildNow(doc, { oklch: o });
}

/** a pinned (L) swatch is left alone: the toast says how to free it */
export function armDelete(doc: Doc): void {
  const d = doc.get();
  const ids = selection(d);
  if (!ids.length) return;
  const pinned = d.swatches.filter((w) => ids.includes(w.id) && getView().locked.includes(w.id));
  if (pinned.length) return void toast.show({ icon: 'lock', message: `${listNames(pinned.map(displayName))} ${pinned.length === 1 ? 'is' : 'are'} locked. Press L to unlock before deleting.` });
  armed.set(true);
}

/** L: pin or free the selected swatches (a view setting; the file never holds it) */
export function toggleLocked(doc: Doc): void {
  const d = doc.get();
  const ids = selection(d);
  if (!ids.length) return;
  const have = getView().locked.filter((id) => d.swatches.some((w) => w.id === id));
  const all = ids.every((id) => have.includes(id));
  patchView({ locked: all ? have.filter((id) => !ids.includes(id)) : [...new Set([...have, ...ids])] });
}

/** C: the swatch's colour in the format Copy as remembers, through the shared clipboard path */
export function copyColourOf(w: Swatch): void {
  void copyColour(w.oklch);
}

/** a job role belongs to one swatch: giving it to another takes it from the first (Undo brings it back) */
export function setRole(doc: Doc, id: string, role: string | null): void {
  const d = doc.get();
  const w = d.swatches.find((x) => x.id === id);
  if (!w || w.role === role) return;
  const job = role !== null && (ROLES as readonly string[]).includes(role);
  const from = job ? d.swatches.filter((x) => x.id !== id && x.role === role) : [];
  doc.transact(role ? `Set ${displayName(w)} to ${role}` : `Clear ${displayName(w)}'s role`, (x) => ({
    ...x,
    swatches: x.swatches.map((s) => (s.id === id ? { ...s, role } : job && s.role === role ? { ...s, role: null } : s)),
  }));
  if (!from.length) return;
  const after = doc.get();
  toast.show({
    icon: 'swap_horiz',
    message: `${role} moved from ${displayName(from[0])} to ${displayName(w)}.`,
    when: () => doc.get() === after,
    undo: () => void (doc.get() === after && doc.undo()),
  });
}

/** a "+" on the seam after `afterId`: a colour half way to the next one, in the gradient's space */
export function insertBetween(doc: Doc, afterId: string): void {
  const d = doc.get();
  const i = d.swatches.findIndex((w) => w.id === afterId);
  const [a, b] = [d.swatches[i], d.swatches[i + 1]];
  if (!a || !b) return;
  const w = newSwatch(gradientStops(a.oklch, b.oklch, 1, getView().space)[0]);
  doc.transact('Insert swatch', (x) => insertAfter(x, a.id, [w]));
  select([w.id]);
}

/** Alt+arrows: the selection one place along (a transform only, one history step) */
export function nudge(doc: Doc, dir: -1 | 1): void {
  const d = doc.get();
  const ids = selection(d);
  const at = d.swatches.map((w, i) => (ids.includes(w.id) ? i : -1)).filter((i) => i >= 0);
  if (!at.length || (dir < 0 ? at[0] === 0 : at.at(-1) === d.swatches.length - 1)) return;
  // a run of Alt+arrows is one step
  doc.transact(ids.length === 1 ? 'Reorder swatch' : `Reorder ${ids.length} swatches`, (x) => moveIds(x, ids, dir < 0 ? at[0] - 1 : at.at(-1)! + 2), 'reorder');
}

/** the swatches in role order (Background to Highlight), the colours with no role after them in the order they had */
export const byRole = (swatches: Swatch[]): Swatch[] => {
  const rank = (w: Swatch) => (w.role && (ROLES as readonly string[]).includes(w.role) ? (ROLES as readonly string[]).indexOf(w.role) : ROLES.length);
  return swatches.map((w, i) => [w, i] as const).sort((a, b) => rank(a[0]) - rank(b[0]) || a[1] - b[1]).map(([w]) => w);
};

/** Sort by role: one step */
export function sortByRole(doc: Doc): void {
  const sorted = byRole(doc.get().swatches);
  if (sorted.every((w, i) => w === doc.get().swatches[i])) return;
  doc.transact('Sort by role', (d) => ({ ...d, swatches: byRole(d.swatches) }));
}

export function copySelected(doc: Doc): void {
  const w = activeSwatch(doc.get());
  if (w) copyColourOf(w);
}

/** A: every proposal on the board joins the palette, with the roles it lacks suggested */
export function keepAll(doc: Doc): void {
  const p = proposals.get();
  if (p) addProposals(doc, p.items, true, p.from);
}

/** Esc: the armed Delete first, then the proposals, then a many-colour selection back to its active colour (never an empty one: the picker would fall to the first swatch) */
export function escape(): void {
  if (armed.get()) return armed.set(false);
  if (proposals.get()) return clearProposals();
  const sel = getView().selected;
  if (sel.length > 1) select(sel.slice(0, 1));
}

/** 1 to 7 and 0: the selected swatch's role */
export function roleSelected(doc: Doc, role: string | null): void {
  const w = activeSwatch(doc.get());
  if (w) setRole(doc, w.id, role);
}

/** a changed Colours or Seed redoes the suggestions Suggest more colours last made (and only those) */
export function regenerate(doc: Doc, patch: Partial<DesignView>): void {
  patchView(patch);
  if (proposalsFrom('generate')) runGenerate(doc.get().swatches, getView());
}

const newSeed = () => 1 + Math.floor(Math.random() * 99999);

/** Suggest more colours: the generator's ramp-shaped colours, as proposals beside the palette's own */
export function suggestMore(doc: Doc, seed = newSeed()): void {
  patchView({ seed });
  runGenerate(doc.get().swatches, getView());
}

/** a build from a typed colour is repeatable: its seed comes from the colour, and Reroll gives the variety */
const seedOf = (o: Oklch): number => {
  let h = 2166136261;
  for (const c of toHex(o)) h = Math.imul(h ^ c.charCodeAt(0), 16777619);
  return 1 + ((h >>> 0) % 99999);
};

/**
 * Build palette: the seven jobs as swatches with their roles, in the empty palette, one step. The brand
 * colour (typed, picked or pasted) is the Primary exactly as given and starts locked; with none, the
 * seed makes one. The first build shows Preview in use unless the user has chosen a tab themselves.
 * A brand colour that cannot hold 3:1 on the style's ground builds on the other one, and says so.
 */
export function buildNow(doc: Doc, brand?: { oklch: Oklch; name?: string | null }, seed = brand ? seedOf(brand.oklch) : newSeed()): void {
  if (doc.get().swatches.length) return;
  patchView({ seed });
  const v = getView();
  const made = buildRoles({ seed, style: v.preset, accent: v.accent, locked: brand ? { Primary: brand.oklch } : {} });
  const swatches = ROLES.map((role) => newSwatch(made[role], role === 'Primary' ? (brand?.name ?? '') : '', role));
  const primary = swatches.find((w) => w.role === 'Primary')!;
  doc.transact('Build palette', (d) => ({ ...d, swatches }));
  patchView({ selected: [primary.id], locked: brand ? [primary.id] : [], ...(v.tabChosen ? {} : { tab: 'preview' as const }) });
  const flipped = groundFlip(made.Background, v.preset, brand ? { name: brand.name ?? '', oklch: brand.oklch } : null);
  if (flipped) toast.show({ icon: 'info', message: `${flipped} Lock a ${styleGround(v.preset)} Background to keep it.` });
}

/**
 * Why a palette sits on the other ground than its Style: the brand colour cannot hold 3:1 on the
 * Style's ground, so the build used the other one. Null when the ground is the Style's, or there is no brand colour.
 */
export function groundFlip(background: Oklch, preset: string, brand: { name: string; oklch: Oklch } | null): string | null {
  const ground = background[0] > 0.6 ? 'light' : 'dark';
  const wanted = styleGround(preset);
  if (!brand || ground === wanted) return null;
  const on = contrast(brand.oklch, wanted === 'light' ? [0.97, 0, 0] : [0.23, 0, 0]);
  return `Built on a ${ground} ground: ${displayName(brand)} reads ${on.toFixed(1)}:1 on ${wanted === 'light' ? 'white' : 'the dark page'}, under the 3:1 a fill needs.`;
}

/** the view fields a reroll may change, as they were: what its Undo puts back */
const rerollFields = (v: DesignView) => ({ preset: v.preset, accent: v.accent, seed: v.seed });

/**
 * What a reroll would change: every unlocked colour that has a job, made again from the locked ones
 * (a new Accent and neutrals round a locked Primary), by swatch id. A colour without a role has no job
 * and stays. Null, after saying why in a toast, when there is nothing to change.
 */
function planReroll(doc: Doc): { changes: Record<string, Oklch>; n: number } | null {
  const v = getView();
  const jobs = jobHolders(doc.get().swatches);
  if (!jobs.length) {
    toast.show({ icon: 'info', message: 'Nothing to reroll yet: no colour has a role. Press Give roles in the top bar, or give colours roles yourself.' });
    return null;
  }
  const free = jobs.filter(([, w]) => !v.locked.includes(w.id));
  if (!free.length) {
    toast.show({ icon: 'lock', message: 'Every colour with a role is locked. Press L on one to let it change.' });
    return null;
  }
  const locked = Object.fromEntries(jobs.filter(([, w]) => v.locked.includes(w.id)).map(([role, w]) => [role, w.oklch]));
  const made = buildRoles({ seed: v.seed, style: v.preset, accent: v.accent, locked });
  const changes = Object.fromEntries(free.map(([role, w]) => [w.id, made[role]]));
  // a locked Text or Muted that no page can hold: the build cannot fix it, so say so
  const unreadable = jobs.filter(([role, w]) => (role === 'Text' || role === 'Muted') && v.locked.includes(w.id) && Math.max(contrast(w.oklch, [0.97, 0, 0]), contrast(w.oklch, [0.15, 0, 0])) < 4.5);
  if (unreadable.length) toast.show({ icon: 'lock', message: `Locked ${listNames(unreadable.map(([, w]) => displayName(w)))} cannot read on a light or a dark page.` });
  return { changes, n: free.filter(([, w]) => changes[w.id].some((x, i) => x !== w.oklch[i])).length };
}

/** "Rerolled 5 colours", with an Undo that also puts the Style, Accent and Seed back */
function announceReroll(doc: Doc, n: number, before: ReturnType<typeof rerollFields>): void {
  if (!n) return;
  const after = doc.get();
  toast.show({
    icon: 'casino',
    key: 'reroll',
    message: `Rerolled ${plural(n, 'colour')}.`,
    when: () => doc.get() === after,
    undo: () => {
      if (doc.get() !== after) return;
      doc.undo();
      patchView(before);
    },
  });
}

/**
 * Reroll: the unlocked colours with a job are made again, in one step, and a toast says how many (with
 * Undo). `patch` is a changed Style, Accent or Seed, which rerolls in place the same way. A Complete
 * the palette that is still up is made again from the new colours.
 */
export function rerollNow(doc: Doc, patch: Partial<DesignView> = {}): void {
  const before = rerollFields(getView());
  patchView(patch);
  const plan = planReroll(doc);
  if (!plan) return;
  doc.transact('Reroll palette', (d) => recolour(d, plan.changes));
  if (proposalsFrom('complete')) completeNow(doc);
  announceReroll(doc, plan.n, before);
}

/** the Seed field: one gesture, so a scrub or a run of arrow keys is one undo step and one toast */
export function seedGesture(doc: Doc): Pick<NumberGesture, 'onBegin' | 'onChange' | 'onCommit' | 'onCancel'> {
  let before: ReturnType<typeof rerollFields> | null = null;
  let n = 0;
  return {
    onBegin() {
      before = rerollFields(getView());
      n = 0;
      doc.begin();
    },
    onChange(seed) {
      patchView({ seed });
      const plan = planReroll(doc);
      if (!plan || !doc.inGesture()) return;
      n = plan.n;
      doc.set((d) => recolour(d, plan.changes));
    },
    onCommit(fromKey) {
      doc.commit('Reroll palette', fromKey ? 'reroll-seed' : undefined);
      if (before && !fromKey) announceReroll(doc, n, before);
      if (proposalsFrom('complete')) completeNow(doc);
    },
    onCancel() {
      doc.cancel();
      if (before) patchView(before);
    },
  };
}

/** a changed Style, Accent or Seed: rerolls the palette in place, or only sets what the next build uses while it is empty */
export const restyle = (doc: Doc, patch: Partial<DesignView>): void => (doc.get().swatches.length ? rerollNow(doc, patch) : patchView(patch));

/** a palette no colour of which has a role (an image, a paste, colours kept one by one): the roles suggested, in one step */
export function giveRoles(doc: Doc): void {
  const list = doc.get().swatches;
  const roles = suggestRoles(list.map((w) => w.oklch));
  if (!roles.some(Boolean)) return void toast.show({ icon: 'info', message: 'Add a lighter and a darker colour first: roles are suggested from the lightest, darkest and most colourful.' });
  doc.transact('Give roles', (d) => ({ ...d, swatches: d.swatches.map((w, i) => (roles[i] ? { ...w, role: roles[i] } : w)) }));
  const after = doc.get();
  toast.show({ icon: 'info', message: `Roles suggested: ${listNames(roles.filter((r): r is string => !!r))}.`, when: () => doc.get() === after, undo: () => void (doc.get() === after && doc.undo()) });
}

/** true when some colour holds one of the seven jobs: Reroll has something to do */
export const hasJobs = (swatches: Swatch[]): boolean => jobHolders(swatches).length > 0;

/** a colour the user edited by hand: a role colour becomes locked, so a reroll never takes it back (Undo does not unlock) */
export function lockEdited(doc: Doc, before: Swatch[]): void {
  const v = getView();
  const was = new Map(before.map((w) => [w.id, w.oklch]));
  const edited = doc.get().swatches.filter((w) => w.role && (ROLES as readonly string[]).includes(w.role) && was.has(w.id) && was.get(w.id)!.some((x, i) => x !== w.oklch[i]) && !v.locked.includes(w.id));
  if (!edited.length) return;
  patchView({ locked: [...new Set([...v.locked, ...edited.map((w) => w.id)])] });
  toast.show({ icon: 'lock', message: `Locked ${listNames(edited.map(displayName))}: you edited ${edited.length === 1 ? 'it' : 'them'}. L unlocks.` });
}

/** the jobs no swatch holds yet; none when the palette holds no job at all (nothing to complete from) */
export function missingRoles(swatches: Swatch[]): Role[] {
  const held = jobHolders(swatches).map(([role]) => role);
  return held.length ? ROLES.filter((role) => !held.includes(role)) : [];
}

/** Complete the palette: the missing jobs, made round the colours that are there, as proposals */
export function completeNow(doc: Doc): void {
  const v = getView();
  const have = Object.fromEntries(jobHolders(doc.get().swatches).map(([role, w]) => [role, w.oklch]));
  const { missing, colours } = completeRoles(have, { seed: v.seed, style: v.preset, accent: v.accent });
  if (missing.length) runComplete(missing, colours);
}

/**
 * Space. With suggestions from Suggest more colours up, a new set of those; an empty palette is built
 * from a random colour; otherwise the unlocked colours are rerolled in place (a locked one stays).
 */
export function spaceNow(doc: Doc, seed = newSeed()): void {
  if (proposalsFrom('generate')) return suggestMore(doc, seed);
  if (!doc.get().swatches.length) return buildNow(doc, undefined, seed);
  rerollNow(doc, { seed });
}
