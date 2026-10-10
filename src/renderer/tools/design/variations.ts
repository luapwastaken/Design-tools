// Variations, the parts that need no screen: the six cells for a palette and the view, a cell written into the
// palette, the other colours a role could take. Seeded and pure, so it is unit tested (test/design-variations.test.ts);
// what the buttons and keys do with them is in variation-actions.ts.
import { toHex, type Oklch } from '../../../shared/color/index.ts';
import { completeRoles, styleGround, type RoleColours } from '../../../shared/palette/brand.ts';
import { ROLES, type Role } from '../../../shared/palette/roles.ts';
import { designAlternatives, designCells, relatives, rolesKey, type DesignAlt, type DesignCell, type Ground } from '../../../shared/palette/variations.ts';
import type { Swatch } from '../../../shared/types.ts';
import { jobHolders, newSwatch, recolour, type DesignDoc, type DesignView } from './doc.ts';

/** More like this narrows this many times at most (the spread stops shrinking after three), and a saved path is cut to this */
export const MAX_DEPTH = 6;

// ── the cells ────────────────────────────────────────────────────────────────────────────────────

let made: { key: string; cells: DesignCell[] } | null = null;

/**
 * The grid for this palette: six palettes, then as many More like this steps as the path holds (each
 * one the cell chosen before, as cell 1, with its relatives). Locked colours are in every cell. What
 * is not allowed to vary stays as the palette has it; a key lists only what the grid reads, so a
 * change elsewhere (the other grounds' colours, a style that varies anyway) does not redo it.
 */
export function cellsOf(d: DesignDoc, v: DesignView): DesignCell[] {
  const holders = jobHolders(d.swatches);
  const lockedList = holders.filter(([, w]) => v.locked.includes(w.id));
  const locked = Object.fromEntries(lockedList.map(([role, w]) => [role, w.oklch])) as Partial<Record<Role, Oklch>>;
  const bg = holders.find(([role]) => role === 'Background')?.[1];
  const ground: Ground = bg ? (bg.oklch[0] > 0.6 ? 'light' : 'dark') : styleGround(v.preset);
  const vary = { style: v.varStyle, accent: v.varAccent, ground: v.varGround };
  const current = { style: v.preset, accent: v.accent, ground };
  const key = JSON.stringify([v.varSeed, v.varPath, vary, !vary.style && current.style, !vary.accent && current.accent, !vary.ground && ground, lockedList.map(([role, w]) => [role, w.oklch])]);
  if (made?.key === key) return made.cells;
  let cells = designCells({ seed: v.varSeed, locked, vary, current });
  const locks = lockedList.map(([role]) => role);
  v.varPath.forEach((pick, i) => {
    const parent = cells[pick - 1];
    if (parent) cells = relatives(parent, i + 1, v.varSeed + i + 1, { locks });
  });
  made = { key, cells };
  return cells;
}

/** the cell shown large, if one is and still exists */
export const openCell = (cells: DesignCell[], v: DesignView): DesignCell | null => cells[v.varOpen - 1] ?? null;

/** a cell's seven colours as the swatches the Preview in use page is drawn from */
const swatchesFor = new WeakMap<DesignCell, Swatch[]>();
export function cellSwatches(cell: DesignCell): Swatch[] {
  let list = swatchesFor.get(cell);
  if (!list) swatchesFor.set(cell, (list = ROLES.map((role): Swatch => ({ id: role, name: role, role, oklch: cell.roles[role], type: 'process' }))));
  return list;
}

/** the palette already has these seven colours (the cell is "in use") */
export function inUse(d: DesignDoc, cell: DesignCell): boolean {
  const held = jobHolders(d.swatches);
  return held.length === ROLES.length && held.every(([role, w]) => toHex(w.oklch) === toHex(cell.roles[role]));
}

// ── using a cell ─────────────────────────────────────────────────────────────────────────────────

/**
 * The seven colours written into the swatches that hold those roles; a role no swatch holds is added
 * as a new swatch. A locked swatch and a swatch with no role are never touched. The very same doc
 * comes back when nothing would change.
 */
export function applyRoles(d: DesignDoc, roles: RoleColours, locked: readonly string[]): DesignDoc {
  const held = new Map(jobHolders(d.swatches));
  const changes: Record<string, Oklch> = {};
  const added: Swatch[] = [];
  for (const role of ROLES) {
    const w = held.get(role);
    if (!w) added.push(newSwatch(roles[role], '', role));
    else if (!locked.includes(w.id)) changes[w.id] = roles[role];
  }
  const next = recolour(d, changes);
  if (!added.length && next.swatches.every((w, i) => w === d.swatches[i])) return d;
  return added.length ? { ...next, swatches: [...next.swatches, ...added] } : next;
}


// ── Swap one colour ──────────────────────────────────────────────────────────────────────────────

/** every swap row reads the same seed, so reopening a colour shows the same alternatives */
const SWAP_SEED = 1;

/** the palette as seven roles: the ones it has, the missing ones made round them (only so the pairs can be judged) */
export function swapRoles(d: DesignDoc, v: DesignView): RoleColours {
  const have = Object.fromEntries(jobHolders(d.swatches).map(([role, w]) => [role, w.oklch])) as Partial<Record<Role, Oklch>>;
  return ROLES.every((r) => have[r]) ? (have as RoleColours) : completeRoles(have, { seed: v.seed, style: v.preset, accent: v.accent }).colours;
}

let swapped: { key: string; list: DesignAlt[] } | null = null;

/** about eight other colours the role could take, each still passing its pairs; worked out once per palette state, not per frame */
export function alternatives(d: DesignDoc, v: DesignView, role: Role): DesignAlt[] {
  const roles = swapRoles(d, v);
  const key = `${role} ${rolesKey(roles)} ${v.preset} ${v.accent}`;
  if (swapped?.key !== key) swapped = { key, list: designAlternatives({ seed: SWAP_SEED, role, roles, style: v.preset, accent: v.accent }) };
  return swapped.list;
}
