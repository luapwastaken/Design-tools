// How the colour tools name swatches in sentences, readouts and exports.
import { autoName } from '../../../shared/palette/names.ts';
import type { Swatch } from '../../../shared/types.ts';

// autoName searches the whole name list with CIEDE2000; chips ask on every render (keyed by the
// numbers themselves: a hex key would gamut-map the colour on every call)
const names = new Map<string, string>();

/** Blank names show the nearest colour name. */
export function displayName(w: Pick<Swatch, 'name' | 'oklch'>): string {
  if (w.name.trim()) return w.name;
  const key = w.oklch.join(' ');
  let n = names.get(key);
  if (n === undefined) {
    if (names.size > 4096) names.clear(); // a long drag of an unnamed swatch asks for a new colour every frame
    names.set(key, (n = autoName(w.oklch)));
  }
  return n;
}

/**
 * What a step is called from where it sits: base, then light and shadow outwards, the outermost of
 * three or more on a side being the highlight and the deep shadow ("light 2" when a side has several).
 */
export function stepWord(step: number, lo: number, hi: number): string {
  if (step === 0) return 'base';
  const end = step < 0 ? lo : hi;
  const [outer, inner] = step < 0 ? ['highlight', 'light'] : ['deep shadow', 'shadow'];
  if (Math.abs(end) >= 2 && step === end) return outer;
  const plain = Math.abs(end) >= 2 ? Math.abs(end) - 1 : Math.abs(end);
  return plain > 1 ? `${inner} ${Math.abs(step)}` : inner;
}

/**
 * What export and the checks' sentences call each swatch: blank names filled in. A blank Illustration
 * ramp step reads "Cloth deep shadow" (its ramp's name, its word) wherever it shows, so two steps
 * never share a colour name; `ramps` gives the name of a ramp whose base is gone.
 */
export function named(list: Swatch[], ramps: { id: string; name?: string }[] = []): Swatch[] {
  const groups = new Map<string, Swatch[]>();
  for (const w of list) if (w.group !== undefined && Number.isInteger(w.step)) groups.set(w.group, [...(groups.get(w.group) ?? []), w]);
  const rampName = (g: string) => {
    const base = groups.get(g)!.find((w) => w.step === 0);
    return base ? displayName(base) : ramps.find((r) => r.id === g)?.name?.trim() || null;
  };
  return list.map((w) => {
    if (w.name.trim()) return w;
    const steps = w.step !== 0 && w.group !== undefined ? groups.get(w.group) : undefined;
    const ramp = steps && rampName(w.group!);
    if (!steps || !ramp) return { ...w, name: displayName(w) };
    const at = steps.map((x) => x.step!);
    return { ...w, name: `${ramp} ${stepWord(w.step!, Math.min(...at), Math.max(...at))}` };
  });
}

/** "Iron", "Iron and Moss", "Iron, Moss and Sky" */
export function listNames(list: string[]): string {
  return list.length < 2 ? (list[0] ?? '') : `${list.slice(0, -1).join(', ')} and ${list.at(-1)}`;
}

export const plural = (n: number, one: string, many = `${one}s`): string => `${n} ${n === 1 ? one : many}`;

/** "L 66.2", "C .173", "H 37": the mockup's readouts */
export const fmtL = (l: number) => (l * 100).toFixed(1);
export const fmtC = (c: number) => c.toFixed(3).replace(/^0/, '');
export const fmtH = (h: number) => Math.round(h) % 360;

/** "1,200 × 800 px": a size in pixels, as every tool reads one */
export const fmtPx = (w: number, h: number): string => `${w.toLocaleString('en')} × ${h.toLocaleString('en')} px`;
