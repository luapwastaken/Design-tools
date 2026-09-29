// The edit view's geometry, pure so it is unit tested (test/logo-tool.test.ts): where a lockup sits
// in the view's content, and the icon handle that follows the pointer.
import { layoutLockup, type Layout } from '../../../shared/logo/layout.ts';
import { padOf } from '../../../shared/logo/svg.ts';
import type { Lockup, LogoDoc, Rect, Version } from '../../../shared/logo/types.ts';
import { LIMIT } from './doc.ts';

type Sizing = Pick<LogoDoc, 'pngHeight' | 'exportPadding' | 'clearspace'>;

/** the most pixels a side of the view's content gets, as of a PNG (raster.ts): beyond it, Fit would hit the zoom floor */
const CONTENT_MAX = 16384;

type Point = { x: number; y: number };

/**
 * Content px per layout unit (an icon height): the view's content is the lockup with its clearspace
 * at the size the PNG export draws it, so 100% zoom shows the PNG's own pixels (up to a PNG's
 * largest side).
 */
export function pxPerUnit(d: Sizing, lay: Pick<Layout, 'w' | 'h'>, version: Version = 'original'): number {
  const pad = padOf(d, version, d.exportPadding);
  const u = d.pngHeight / Math.max(1e-6, lay.h + 2 * pad);
  return Math.min(u, CONTENT_MAX / Math.max(1e-6, lay.w + 2 * d.clearspace, lay.h + 2 * d.clearspace));
}

/** the PNG export's pixels: the lockup with its export padding at the set height */
export function pngSize(d: Sizing, lay: Pick<Layout, 'w' | 'h'>, version: Version = 'original'): { w: number; h: number } {
  const pad = 2 * padOf(d, version, d.exportPadding);
  return { w: Math.max(1, Math.round(((lay.w + pad) / Math.max(1e-6, lay.h + pad)) * d.pngHeight)), h: d.pngHeight };
}

/** the icon's corners, clockwise from the top left */
export const corners = (r: Rect): Point[] => [
  { x: r.x, y: r.y },
  { x: r.x + r.w, y: r.y },
  { x: r.x + r.w, y: r.y + r.h },
  { x: r.x, y: r.y + r.h },
];
const OUT: Point[] = [
  { x: -1, y: -1 },
  { x: 1, y: -1 },
  { x: 1, y: 1 },
  { x: -1, y: 1 },
];

/**
 * A drag of an icon handle. The icon scales about its opposite corner, which stays at `a0` on
 * screen, and the wordmark keeps its size (`cap`: its cap height in screen px) while it moves to keep
 * the gap and the alignment. So the dragged corner sits on a straight line out of `a0`, and follows
 * the pointer exactly along it. (Holding the wordmark still instead sends the icon's inner corners
 * the wrong way: the gap is in icon heights, so a growing icon backs away from the wordmark.)
 */
export type Grip = { corner: number; a0: Point; cap: number };

const iconAspect = (d: Pick<LogoDoc, 'icon'>) => (d.icon ? d.icon.box.w / d.icon.box.h : 1);

/** where the dragged corner is at the lockup's ratio */
export function handleAt(d: Pick<LogoDoc, 'icon'>, l: Lockup, g: Grip): Point {
  const o = OUT[g.corner];
  const h = l.ratio * g.cap;
  return { x: g.a0.x + o.x * iconAspect(d) * h, y: g.a0.y + o.y * h };
}

/** the ratio that puts the dragged corner nearest the pointer: the pointer projected on the corner's line */
export function ratioFor(d: Pick<LogoDoc, 'icon'>, g: Grip, pointer: Point): number {
  const o = OUT[g.corner];
  const v = { x: o.x * iconAspect(d), y: o.y };
  const h = ((pointer.x - g.a0.x) * v.x + (pointer.y - g.a0.y) * v.y) / (v.x * v.x + v.y * v.y);
  const r = Math.round((h / g.cap) * 100) / 100;
  return Math.min(LIMIT.ratio[1], Math.max(LIMIT.ratio[0], r));
}

/**
 * The view (the Viewport's own terms: scale and the content point at the centre) that keeps the
 * grip: the icon's anchor corner at `a0` and the wordmark's cap height at `cap` screen px, once the
 * lockup has its new ratio. `box`: the view's size.
 */
export function heldView(d: Pick<LogoDoc, 'icon' | 'wordmark'> & Sizing, l: Lockup, g: Grip, box: { w: number; h: number }, version: Version = 'original') {
  const lay = layoutLockup(d, l);
  if (!lay.icon) return null;
  const u = pxPerUnit(d, lay, version);
  // in layout units the icon is 1 tall and the cap band 1 / ratio, so an icon height is ratio × cap on screen
  const scale = (l.ratio * g.cap) / u;
  const a = corners(lay.icon)[(g.corner + 2) % 4];
  const ax = (a.x + d.clearspace) * u;
  const ay = (a.y + d.clearspace) * u;
  return { scale, x: (box.w / 2 - g.a0.x) / scale + ax, y: (box.h / 2 - g.a0.y) / scale + ay };
}
