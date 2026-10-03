// The SVG export's drawing (spec §3: pixel runs for small outputs), pure so it is unit tested.
import { toHex, type Oklch } from '../../../shared/color/index.ts';

/**
 * Each colour one compound path of horizontal runs, on a rect of the commonest colour; one unit is
 * one block and the file is sized so a block is `scale` px.
 */
export function runsSvg(indices: Uint8Array, w: number, h: number, colours: Oklch[], scale: number): string {
  const counts = new Uint32Array(colours.length);
  for (const v of indices) counts[v]++;
  const ground = counts.indexOf(Math.max(...counts));
  const runs: string[][] = colours.map(() => []);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; ) {
      const v = indices[y * w + x];
      let n = 1;
      while (x + n < w && indices[y * w + x + n] === v) n++;
      if (v !== ground) runs[v].push(`M${x} ${y}h${n}v1h-${n}z`);
      x += n;
    }
  }
  const fill = (i: number) => toHex(colours[i]);
  const paths = runs.flatMap((list, i) => (list.length ? [`<path fill="${fill(i)}" d="${list.join('')}"/>`] : []));
  return [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${w * scale}" height="${h * scale}" viewBox="0 0 ${w} ${h}" shape-rendering="crispEdges">`,
    `<rect width="${w}" height="${h}" fill="${fill(ground)}"/>`,
    ...paths,
    '</svg>',
  ].join('\n');
}
