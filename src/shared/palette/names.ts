// Names for unnamed swatches (older Photoshop .aco presets import with blank names).
import { deltaE, hexToOklch, type Oklch } from '../color/index.ts';
import list from './data/colorNames.json' with { type: 'json' };

const NAMES = list.map(({ name, hex }) => ({ name, oklch: hexToOklch(hex) }));

/** the nearest name in the v1 colour-name list, by CIEDE2000; `taken` (lower case) names are passed over, so a second near-white is "Snow", not "White 2" */
export function autoName(oklch: Oklch, taken?: ReadonlySet<string>): string {
  let best = NAMES[0];
  let bestE = Infinity;
  for (const n of NAMES) {
    if (taken?.has(n.name.toLowerCase())) continue;
    const e = deltaE(oklch, n.oklch);
    if (e < bestE) [best, bestE] = [n, e];
  }
  return best.name;
}
