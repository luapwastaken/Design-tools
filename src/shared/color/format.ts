// A colour as text, in the formats the picker's Copy as menu offers. The sRGB formats print what the
// screen shows (the hex); OKLCH, OKLab and Display P3 keep the colour itself. Each number is the
// shortest that reads back as the same hex, so a copy pasted anywhere lands where it was copied.
import { converter } from 'culori';
import { inSrgb, linearRgb, parseCss, rgb255, toHex, type Oklch } from './index.ts';

export const COPY_FORMATS = [
  { id: 'hex', label: 'Hex' },
  { id: 'rgb', label: 'RGB' },
  { id: 'hsl', label: 'HSL' },
  { id: 'oklch', label: 'OKLCH' },
  { id: 'oklab', label: 'OKLab' },
  { id: 'p3', label: 'Display P3' },
  { id: 'linear', label: 'Linear RGB 0–1' },
  { id: 'ae', label: 'After Effects' },
] as const;
export type CopyFormat = (typeof COPY_FORMATS)[number]['id'];

const hslOf = converter('hsl');
const p3Of = converter('p3');
const oklabOf = converter('oklab');

/** fewest decimals first; the last rung is the raw number */
const LADDER = [0, 1, 2, 3, 4, 5, 6, 8] as const;
const num = (v: number, dp: number) => String(+v.toFixed(dp) || 0);

/** the first text from `make` (given a number of decimals) that reads back as the same hex, and as sRGB where `o` is */
function shortest(o: Oklch, make: (dp: number) => string, from = 0): string {
  const hex = toHex(o);
  const wasIn = inSrgb(o, 1e-4);
  for (const dp of LADDER) {
    if (dp < from) continue;
    const text = make(dp);
    const back = parseCss(text);
    if (back && toHex(back) === hex && (!wasIn || inSrgb(back, 1e-4))) return text;
  }
  // nothing reads back as this hex (a colour past what the format holds, P3 clips it): 5 places is as exact as the format can be
  return make(5);
}

/** the colour as text in this format; `hex` is upper case, as the field shows it */
export function formatColour(o: Oklch, format: CopyFormat): string {
  const shown = toHex(o);
  switch (format) {
    case 'hex':
      return shown.toUpperCase();
    case 'rgb':
      return `rgb(${rgb255(o).join(' ')})`;
    case 'hsl': {
      const { h = 0, s, l } = hslOf(shown)!;
      return shortest(o, (dp) => `hsl(${num(h, dp)} ${num(s * 100, dp)}% ${num(l * 100, dp)}%)`);
    }
    case 'oklch':
      // oklch.com's order: L and C to 3 places, H to 1, then more only while the hex would move
      return shortest(o, (dp) => `oklch(${num(o[0], dp)} ${num(o[1], dp)} ${num(o[2], Math.max(0, dp - 2))})`, 3);
    case 'oklab': {
      const { l, a = 0, b = 0 } = oklabOf({ mode: 'oklch', l: o[0], c: o[1], h: o[2] });
      return shortest(o, (dp) => `oklab(${num(l, dp)} ${num(a, dp)} ${num(b, dp)})`, 3);
    }
    case 'p3': {
      const { r, g, b } = p3Of({ mode: 'oklch', l: o[0], c: o[1], h: o[2] });
      const k = (v: number) => Math.min(1, Math.max(0, v));
      return shortest(o, (dp) => `color(display-p3 ${num(k(r), dp)} ${num(k(g), dp)} ${num(k(b), dp)})`, 3);
    }
    case 'linear':
      return linearRgb(o).map((v) => num(v, 5)).join(', ');
    case 'ae':
      return `[${[...rgb255(o).map((v) => num(v / 255, 4)), 1].join(', ')}]`;
  }
}
