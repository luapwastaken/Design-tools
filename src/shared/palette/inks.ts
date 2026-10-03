// Reference ink libraries for the Print check, ported from v1 (src/data). The hex values are the
// libraries' published screen approximations, so matches are a guide, not a proof.
import { deltaE, hexToOklch, parseHex, type Oklch } from '../color/index.ts';
import hks from './data/hks.json' with { type: 'json' };
import ncs from './data/ncs.json' with { type: 'json' };
import ral from './data/ral.json' with { type: 'json' };
import riso from './data/riso.json' with { type: 'json' };

export type InkLibrary = 'riso' | 'ral' | 'hks' | 'ncs';
export type Ink = { id: string; name: string; hex: string; oklch: Oklch };
export type InkMatch = { library: InkLibrary; id: string; name: string; hex: string; deltaE: number };

export const INK_LIBRARIES: InkLibrary[] = ['riso', 'ral', 'hks', 'ncs'];

const load = (list: { id: string; name: string; hex: string }[]): Ink[] =>
  list.map(({ id, name, hex }) => ({ id, name, hex: parseHex(hex)!, oklch: hexToOklch(hex) }));

export const INKS: Record<InkLibrary, Ink[]> = { riso: load(riso), ral: load(ral), hks: load(hks), ncs: load(ncs) };

/** the `n` closest inks of one library by CIEDE2000, closest first */
export function nearestInks(oklch: Oklch, library: InkLibrary, n = 1): InkMatch[] {
  return INKS[library]
    .map(({ id, name, hex, oklch: ink }) => ({ library, id, name, hex, deltaE: deltaE(oklch, ink) }))
    .sort((a, b) => a.deltaE - b.deltaE)
    .slice(0, n);
}
