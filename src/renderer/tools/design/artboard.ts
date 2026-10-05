// What a column of the artboard works out from the palette: the ink that reads on its colour, the
// pair its contrast badge speaks for, and the colour the stage's Simulate filter shows.
import { contrast, cssColor, simulateCvd, wcagGrade, type Oklch } from '../../../shared/color/index.ts';
import { contrastTarget } from '../../../shared/palette/checks.ts';
import { isGround, isInk } from '../../../shared/palette/roles.ts';
import type { Swatch } from '../../../shared/types.ts';
import type { Simulate } from './doc.ts';

/** the two inks a column writes in: near-black and near-white, drawn from the colour module's own warmth */
const DARK: Oklch = [0.2, 0.012, 70];
const LIGHT: Oklch = [0.97, 0.006, 90];

/** whichever of the two reads better on `o` */
export const inkOn = (o: Oklch): string => cssColor(contrast(o, DARK) >= contrast(o, LIGHT) ? DARK : LIGHT);

/** the colour the stage shows under a Simulate filter; the file's colour is never touched */
export const simulated = (o: Oklch, sim: Simulate): Oklch => (sim === 'normal' ? o : sim === 'greyscale' ? [o[0], 0, 0] : simulateCvd(o, sim));

/**
 * Roles the generator hands out, so the contrast badges work from the first press: lightest
 * Background, darkest Text, then the most colourful as Primary and Accent. A role in `taken` (a
 * locked swatch holds it) or a slot in `skip` is left as it is.
 */
export function suggestRoles(list: Oklch[], taken: ReadonlySet<string> = new Set(), skip: ReadonlySet<number> = new Set()): (string | null)[] {
  const out: (string | null)[] = list.map(() => null);
  const free = new Set(list.map((_, i) => i).filter((i) => !skip.has(i)));
  const give = (role: string, pool: number[], by: (i: number) => number) => {
    const i = pool.filter((x) => free.has(x)).sort((a, b) => by(b) - by(a))[0];
    if (taken.has(role) || i === undefined) return;
    out[i] = role;
    free.delete(i);
  };
  const all = [...free];
  const colourful = all.filter((i) => list[i][1] >= 0.06);
  give('Background', all, (i) => list[i][0]);
  give('Text', all, (i) => -list[i][0]);
  give('Primary', colourful, (i) => list[i][1]);
  give('Accent', colourful, (i) => list[i][1]);
  return out;
}

export type Badge = {
  /** what this colour was judged against */
  other: Swatch;
  ratio: number;
  /** the short grade: AAA, AA, Large (3:1) or Fail */
  grade: 'AAA' | 'AA' | 'Large' | 'Fail';
  ok: boolean;
  /** neither side has a role, so the lightest and darkest stood in */
  guessed: boolean;
};

const shortGrade = (ratio: number): Badge['grade'] => {
  const g = wcagGrade(ratio);
  return g === 'AAA' ? 'AAA' : g === 'AA' ? 'AA' : g === 'Fail' ? 'Fail' : 'Large';
};

/**
 * The pair a column's badge speaks for: an ink colour against the Background, a ground against the
 * Text; with no roles, against whichever of the lightest and darkest swatches it reads best on.
 */
export function badgeFor(w: Swatch, list: Swatch[]): Badge | null {
  const others = list.filter((x) => x.id !== w.id);
  if (!others.length) return null;
  const byL = [...others].sort((a, b) => a.oklch[0] - b.oklch[0]);
  const role = (r: string) => others.find((x) => x.role === r);
  let other: Swatch | undefined;
  let guessed = false;
  if (isInk(w.role)) other = role('Background') ?? role('Surface');
  else if (isGround(w.role)) other = role('Text');
  if (!other) {
    guessed = true;
    const ends = [byL[0], byL.at(-1)!];
    other = ends.sort((a, b) => contrast(b.oklch, w.oklch) - contrast(a.oklch, w.oklch))[0];
  }
  const ratio = contrast(w.oklch, other.oklch);
  // a fill (Primary, Highlight) needs 3:1; text and grounds 4.5:1
  const need = isGround(w.role) ? contrastTarget(other.role) : contrastTarget(w.role);
  return { other, ratio, grade: shortGrade(ratio), ok: ratio >= need, guessed };
}
