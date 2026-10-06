// The lens swatches are seen through (Ramps, Light, Check): off, or one of the four colour-vision
// simulations. Display only: the document keeps the real colours. Greyscale is not a lens: it is the
// app-wide toggle (G), which greys every content colour the same way.
import { simulateCvd, type Cvd, type Oklch } from '../../../shared/color/index.ts';

export type Proof = 'off' | Cvd;

export const PROOFS: { value: Proof; label: string }[] = [
  { value: 'off', label: 'Off' },
  { value: 'deutan', label: 'Deuteranopia' },
  { value: 'protan', label: 'Protanopia' },
  { value: 'tritan', label: 'Tritanopia' },
  { value: 'achromat', label: 'Achromatopsia' },
];

export const proofOf = (o: Oklch, p: Proof): Oklch => (p === 'off' ? o : simulateCvd(o, p));
