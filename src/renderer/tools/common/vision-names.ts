import type { Cvd } from '../../../shared/color/index.ts';

/** the one set of names for the colour-vision views: the Colour vision check and Seen as say the same word */
export const VISION_NAME: Record<'typical' | Cvd, string> = { typical: 'Typical', protan: 'Protan', deutan: 'Deutan', tritan: 'Tritan', achromat: 'Achromat' };
