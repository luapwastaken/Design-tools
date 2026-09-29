// svgColours(): the colours an SVG paints with, for taking a palette from a logo (Design, Illustration).
import { parseCss, type Oklch } from '../color/index.ts';
import { getAttr, parseSvg, textOf, walk } from './xml.ts';

const PAINTS = ['fill', 'stroke', 'stop-color', 'flood-color'];
const PAINT = /(?:^|[;\s{])(?:fill|stroke|stop-color|flood-color)\s*:\s*([^;}]+)/g;
const SKIP = /^(none|transparent|inherit|currentcolor|context-fill|context-stroke)$|^url\(/i;
const SHAPES = new Set(['path', 'rect', 'circle', 'ellipse', 'polygon', 'polyline', 'text']);
const BLACK: Oklch = [0, 0, 0];

/**
 * Every paint the SVG names, in document order, then its <style> rules. Any CSS colour counts,
 * keywords too (Figma writes fill="white"). Shapes that name no paint at all draw black, the SVG
 * default. Throws when the markup can't be read.
 */
export function svgColours(svg: string): Oklch[] {
  const found: Oklch[] = [];
  const take = (v: string | null | undefined) => {
    const t = v?.trim();
    const o = t && !SKIP.test(t) ? parseCss(t) : null;
    if (o) found.push(o);
  };
  const styles: string[] = [];
  let shapes = false;
  for (const { el } of walk(parseSvg(svg))) {
    for (const a of PAINTS) take(getAttr(el, a));
    for (const m of (getAttr(el, 'style') ?? '').matchAll(PAINT)) take(m[1]);
    if (el.name === 'style') styles.push(textOf(el));
    shapes ||= SHAPES.has(el.name);
  }
  for (const s of styles) for (const m of s.matchAll(PAINT)) take(m[1]);
  return found.length || !shapes ? found : [BLACK];
}
