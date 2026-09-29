// What a logo is judged on (brief §9.1): the neutral 18% grey by default, where a black logo and a
// white one both show, or plain white, black, or the logo's own colour.
import { cssColor } from '../../../shared/color/index.ts';
import { GREY_18 } from '../common/surround.ts';
import type { LogoDoc } from './doc.ts';
import type { Surround } from './view-state.ts';

export const SURROUNDS: { value: Surround; label: string; tip: string }[] = [
  { value: 'grey', label: '18%', tip: '18% grey: black and white logos both show' },
  { value: 'white', label: 'White', tip: 'On white' },
  { value: 'black', label: 'Black', tip: 'On black' },
  { value: 'colour', label: 'Colour', tip: 'On the one colour' },
];

export const surroundOf = (s: Surround, d: Pick<LogoDoc, 'colour'>): string =>
  s === 'grey' ? cssColor(GREY_18) : s === 'white' ? cssColor([1, 0, 0]) : s === 'black' ? cssColor([0, 0, 0]) : cssColor(d.colour);
