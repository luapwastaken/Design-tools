// Lockup geometry in "icon height = 1" units, from each part's ARTWORK box. A file's own box (an
// Illustrator artboard with a margin, a PNG's transparent border) never reaches the maths, so it
// can't skew the gap or the alignment (v1's biggest layout error).
import { ALIGNS, needsIcon, needsWordmark, sideBySide, type Align, type Lockup, type LogoDoc, type Part, type Rect } from './types.ts';

export type Layout = { w: number; h: number; icon?: Rect; wordmark?: Rect };

/** a part that can be drawn: markup or pixels, with artwork that has an area */
export const usable = (p: Part | null): p is Part => !!p && !!(p.svg || p.png) && p.box.w > 0 && p.box.h > 0;

/** the wordmark's cap band in its own units; without type metrics its artwork box stands in */
export function capBand(p: Part): { top: number; base: number } {
  const t = p.type;
  return t && t.baseline > t.capTop ? { top: t.capTop, base: t.baseline } : { top: p.box.y, base: p.box.y + p.box.h };
}

/** both rects moved so their union starts at 0 0 */
function fit(a: Rect, b: Rect): Layout & { icon: Rect; wordmark: Rect } {
  const x = Math.min(a.x, b.x);
  const y = Math.min(a.y, b.y);
  const icon = { ...a, x: a.x - x, y: a.y - y };
  const wordmark = { ...b, x: b.x - x, y: b.y - y };
  return {
    w: Math.max(icon.x + icon.w, wordmark.x + wordmark.w),
    h: Math.max(icon.y + icon.h, wordmark.y + wordmark.h),
    icon,
    wordmark,
  };
}

export function layoutLockup(doc: Pick<LogoDoc, 'icon' | 'wordmark'>, lockup: Lockup): Layout {
  const { kind, gap } = lockup;
  const icon = needsIcon(kind) && usable(doc.icon) ? doc.icon : null;
  const wm = needsWordmark(kind) && usable(doc.wordmark) ? doc.wordmark : null;
  const ir: Rect | null = icon && { x: 0, y: 0, w: icon.box.w / icon.box.h, h: 1 };
  if (!wm) return ir ? { w: ir.w, h: 1, icon: ir } : { w: 0, h: 0 };

  const band = capBand(wm);
  const s = 1 / (Math.max(lockup.ratio, 1e-3) * (band.base - band.top));
  const wr: Rect = { x: 0, y: 0, w: wm.box.w * s, h: wm.box.h * s };
  if (!ir) return { w: wr.w, h: wr.h, wordmark: wr };

  const align = ALIGNS[kind].includes(lockup.align) ? lockup.align : 'center';
  if (sideBySide(kind)) {
    const capTop = (band.top - wm.box.y) * s;
    const base = (band.base - wm.box.y) * s;
    const at: Partial<Record<Align, number>> = { cap: (capTop + base) / 2 - 0.5, baseline: base - 1, top: 0, bottom: wr.h - 1 };
    const iy = at[align] ?? wr.h / 2 - 0.5;
    const rev = kind === 'horizontal-rev';
    return fit({ ...ir, x: rev ? wr.w + gap : 0, y: iy }, { ...wr, x: rev ? 0 : ir.w + gap });
  }
  const width = Math.max(ir.w, wr.w);
  const x = (w: number) => (align === 'start' ? 0 : align === 'end' ? width - w : (width - w) / 2);
  return fit({ ...ir, x: x(ir.w), y: 0 }, { ...wr, x: x(wr.w), y: 1 + gap });
}

/** what the clearspace is counted in: icon heights, or with no icon the wordmark's cap height */
export const spaceUnit = (doc: Pick<LogoDoc, 'icon' | 'wordmark'>): string =>
  usable(doc.icon) ? 'icon height' : doc.wordmark?.type ? 'cap height' : 'wordmark height';

/** the clearspace box round a lockup, in the same units: `doc.clearspace` icon heights on every side */
export function clearspaceRect(doc: Pick<LogoDoc, 'icon' | 'wordmark' | 'clearspace'>, lockup: Lockup): Rect {
  const { w, h } = layoutLockup(doc, lockup);
  const c = doc.clearspace;
  return { x: -c, y: -c, w: w + 2 * c, h: h + 2 * c };
}
