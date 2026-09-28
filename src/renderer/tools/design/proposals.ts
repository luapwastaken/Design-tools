// Ghost chips from Build (spec §3: proposals never overwrite). Component state, never in the
// document until added; a module-level store so `receive` can hand the view what an image, logo or
// SVG gave (plan: the shell's history step is then a no-op).
import type { Oklch } from '../../../shared/color/index.ts';
import type { BuildTab } from './doc.ts';
import { createStore } from './store.ts';

export type Proposal = { id: string; oklch: Oklch; name: string | null; locked: boolean };
export type Proposals = { from: BuildTab; label: string; items: Proposal[] };

export const proposals = createStore<Proposals | null>(null);

/** one set at a time: the newest Build result replaces the last */
export function propose(from: BuildTab, label: string, colours: Oklch[], names: (string | null)[] = [], locked: boolean[] = []): void {
  const items = colours.map((oklch, i) => ({ id: crypto.randomUUID(), oklch, name: names[i] ?? null, locked: !!locked[i] }));
  proposals.set(items.length ? { from, label, items } : null);
}

export function dropProposals(ids: string[]): void {
  const p = proposals.get();
  if (!p) return;
  const items = p.items.filter((x) => !ids.includes(x.id));
  proposals.set(items.length ? { ...p, items } : null);
}

export const clearProposals = (): void => proposals.set(null);

export function toggleLock(id: string): void {
  const p = proposals.get();
  if (p) proposals.set({ ...p, items: p.items.map((x) => (x.id === id ? { ...x, locked: !x.locked } : x)) });
}

/** the set if it came from this Build tab, so a changed setting can replace it in place */
export const proposalsFrom = (from: BuildTab): Proposals | null => (proposals.get()?.from === from ? proposals.get() : null);
