// The lens swatches are seen through (Ramps, Light, Check): off, or one of the four colour-vision
// simulations. Display only: the document keeps the real colours. Greyscale is not a lens: it is the
// app-wide toggle (G), which greys every content colour the same way.
import { simulateCvd, type Cvd, type Oklch } from '../../../shared/color/index.ts';
import { VISION_NAME } from '../common/vision-names.ts';

export type Proof = 'off' | Cvd;

/** the names are the Colour vision check's (ill-09) */
export const PROOFS: { value: Proof; label: string }[] = [
  { value: 'off', label: 'Off' },
  { value: 'deutan', label: VISION_NAME.deutan },
  { value: 'protan', label: VISION_NAME.protan },
  { value: 'tritan', label: VISION_NAME.tritan },
  { value: 'achromat', label: VISION_NAME.achromat },
];

export const proofOf = (o: Oklch, p: Proof): Oklch => (p === 'off' ? o : simulateCvd(o, p));
