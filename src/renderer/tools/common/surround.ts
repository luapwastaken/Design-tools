// The neutral surround colours are judged on (brief §9.1), shared by the colour tools.
import { cssColor, toOklch, type Oklch } from '../../../shared/color/index.ts';
import { isGround } from '../../../shared/palette/roles.ts';
import type { Swatch } from '../../../shared/types.ts';

export type Surround = 'grey' | 'ground' | 'plain';

/** 18% reflectance: the photographer's neutral grey, the same in both themes, for judging colour */
export const GREY_18: Oklch = toOklch({ mode: 'lrgb', r: 0.18, g: 0.18, b: 0.18 });

/** the neutral surround, worded the same wherever it is offered (Logo adds what it is for) */
export const GREY = { value: 'grey', label: '18%', tip: '18% grey surround' } as const;

export const SURROUNDS: { value: Surround; label: string; tip: string }[] = [
  GREY,
  { value: 'ground', label: 'Ground', tip: "The palette's own background" },
  { value: 'plain', label: 'Plain', tip: 'No surround' },
];

/** the palette's background colour, or its darkest swatch when no swatch has that job */
function groundOf(list: Swatch[]): string {
  const g = list.find((w) => w.role === 'Background') ?? list.find((w) => isGround(w.role)) ?? [...list].sort((a, b) => a.oklch[0] - b.oklch[0])[0];
  return g ? cssColor(g.oklch) : 'var(--module)';
}

/** the CSS background of the surround */
export const surroundOf = (kind: Surround, list: Swatch[]): string => (kind === 'grey' ? cssColor(GREY_18) : kind === 'ground' ? groundOf(list) : 'var(--module)');
