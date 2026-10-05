// The lens swatches are seen through (Ramps, Light, Check): off, greyscale by lightness, or one of the
// four colour-vision simulations. Display only: the document keeps the real colours.
import { simulateCvd, type Cvd, type Oklch } from '../../../shared/color/index.ts';

export type Proof = 'off' | 'grey' | Cvd;

export const PROOFS: { value: Proof; label: string }[] = [
  { value: 'off', label: 'Off' },
  { value: 'grey', label: 'Greyscale' },
  { value: 'deutan', label: 'Deuteranopia' },
  { value: 'protan', label: 'Protanopia' },
  { value: 'tritan', label: 'Tritanopia' },
  { value: 'achromat', label: 'Achromatopsia' },
];

export const proofOf = (o: Oklch, p: Proof): Oklch => (p === 'off' ? o : p === 'grey' ? [o[0], 0, 0] : simulateCvd(o, p));
