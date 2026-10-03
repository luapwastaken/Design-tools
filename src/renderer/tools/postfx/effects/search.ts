// Finding an effect by what was typed (the add menu's search field). Pure, so it is unit tested.
import { GROUPS, type Effect } from './index.ts';

/** how well an effect answers what was typed: its name above all (whole, then its start, then a word's start, then anywhere in it), then its group, then what it says of itself; 0 for not at all */
export function score(fx: Effect, q: string): number {
  const name = fx.label.toLowerCase();
  if (name === q) return 6;
  if (name.startsWith(q)) return 5;
  if (name.split(/[\s/]+/).some((w) => w.startsWith(q))) return 4;
  if (name.includes(q)) return 3;
  if ((GROUPS.find((g) => g.id === fx.group)?.label ?? '').toLowerCase().includes(q)) return 2;
  return fx.about.toLowerCase().includes(q) ? 1 : 0;
}
