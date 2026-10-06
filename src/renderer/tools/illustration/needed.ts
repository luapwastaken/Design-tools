// The colours a light needs that the ramp doesn't have: the glow of light through thin cloth, light
// bounced back by the surround, a highlight in the light's own colour. The picture reads them from
// small tables built from the ramp (shade.ts); this finds the ones the picture really uses, so the
// tab can offer them to the palette. Pure.
import { toOklch, type Oklch } from '../../../shared/color/index.ts';
import { toOklab } from '../../../shared/palette/space.ts';
import type { Look, Stats } from './shade.ts';

export type Needed = { kind: 'glow' | 'bounce' | 'shine'; name: string; why: string; oklch: Oklch };

/** a colour within this OKLab distance of one the palette has is that colour */
const SAME = 0.04;
/** what share of the object light must reach before its colour counts as needed */
const SHARE = { glow: 0.06, bounce: 0.12, shine: 0.004 };

const distance = (a: Oklch, b: Oklch) => {
  const [p, q] = [toOklab(a), toOklab(b)];
  return Math.hypot(p[0] - q[0], p[1] - q[1], p[2] - q[2]);
};

const at = (lut: Uint8ClampedArray, i: number): Oklch => toOklch({ mode: 'rgb', r: lut[i * 3] / 255, g: lut[i * 3 + 1] / 255, b: lut[i * 3 + 2] / 255 });

/** the table entry where `share` of the weight lies at or below it, and the weight in all */
function quantile(w: Float64Array, share: number): [number, number] {
  const total = w.reduce((a, b) => a + b, 0);
  let sum = 0;
  for (let i = 0; i < w.length; i++) {
    sum += w[i];
    if (total > 0 && sum >= total * share) return [i, total];
  }
  return [0, total];
}

/** the colour of the glow the frame used, on average: what the bar of step use shows for the share of the object that glows */
export function glowColour(stats: Stats, look: Look): Oklch | null {
  const [mid, total] = quantile(stats.glow, 0.5);
  return total > 0 ? at(look.glow, mid) : null;
}

/**
 * The colours the frame behind `stats` used that none of `have` is near, at most four, named for
 * the ramp. `look` is the ramp as it is (not as a vision proof shows it).
 */
export function neededColours(stats: Stats, look: Look, have: Oklch[], ramp: string): Needed[] {
  const out: Needed[] = [];
  if (stats.total <= 0) return out;
  const add = (kind: Needed['kind'], name: string, why: string, oklch: Oklch) => {
    if ([...have, ...out.map((o) => o.oklch)].some((c) => distance(c, oklch) < SAME)) return;
    out.push({ kind, name: `${ramp} ${name}`, why, oklch });
  };
  const [glowMid, glow] = quantile(stats.glow, 0.5);
  if (glow >= stats.total * SHARE.glow) {
    add('glow', 'glow', 'Light coming through', at(look.glow, glowMid));
    add('glow', 'glow bright', 'Light coming through, where it is strongest', at(look.glow, quantile(stats.glow, 0.92)[0]));
  }
  const [bounceMid, bounce] = quantile(stats.bounce, 0.5);
  if (look.tinted && bounce >= stats.total * SHARE.bounce) add('bounce', 'bounce', 'Light bounced back from the surround', at(look.bounce, bounceMid));
  if (stats.shine >= stats.total * SHARE.shine) {
    // the highlight step, taken part of the way toward the light's own colour, as the picture shows it
    const top = at(look.lut, 255);
    const lab = toOklab(top);
    const to = toOklab(toOklch({ mode: 'rgb', r: look.spec[0] / 255, g: look.spec[1] / 255, b: look.spec[2] / 255 }));
    const k = 0.45;
    add('shine', 'shine', 'The highlight in the light’s own colour', toOklch({ mode: 'oklab', l: lab[0] + (to[0] - lab[0]) * k, a: lab[1] + (to[1] - lab[1]) * k, b: lab[2] + (to[2] - lab[2]) * k }, top[2]));
  }
  return out;
}
