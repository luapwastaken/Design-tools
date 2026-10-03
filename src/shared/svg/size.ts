// parseSize(): how big an SVG says it is. Width and height come out in CSS px (96 per inch) from
// any absolute unit; missing (or %, em) they follow the viewBox as a browser shows it. Without a
// viewBox the user space is px from the origin, so the viewBox is made from the size (v1 fell back
// to 100 × 100 for width="100mm").
import { getAttr, parseSvg, type El } from './xml.ts';

export type ViewBox = [x: number, y: number, w: number, h: number];
export type SvgSize = { viewBox: ViewBox; width: number; height: number };

const PX_PER: Record<string, number> = { '': 1, px: 1, in: 96, cm: 96 / 2.54, mm: 96 / 25.4, q: 96 / 101.6, pt: 96 / 72, pc: 16 };
const LENGTH = /^\s*\+?((?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?)\s*([a-z]*)\s*$/i;
/** what a browser gives an SVG that says neither its size nor a viewBox */
const DEFAULT_W = 300;
const DEFAULT_H = 150;

/** a length in px; null when missing, relative, zero or unreadable */
function px(v: string | null): number | null {
  const m = v === null ? null : LENGTH.exec(v);
  const n = m ? parseFloat(m[1]) * (PX_PER[m[2].toLowerCase()] ?? NaN) : NaN;
  return n > 0 && Number.isFinite(n) ? n : null;
}

function viewBoxOf(v: string | null): ViewBox | null {
  const n = v?.trim().split(/[\s,]+/).map(Number);
  return n?.length === 4 && n.every(Number.isFinite) && n[2] > 0 && n[3] > 0 ? (n as ViewBox) : null;
}

export const parseSize = (svg: string): SvgSize => sizeOf(parseSvg(svg));

export function sizeOf(root: El): SvgSize {
  const box = viewBoxOf(getAttr(root, 'viewBox'));
  const w = px(getAttr(root, 'width'));
  const h = px(getAttr(root, 'height'));
  if (!box) return { viewBox: [0, 0, w ?? DEFAULT_W, h ?? DEFAULT_H], width: w ?? DEFAULT_W, height: h ?? DEFAULT_H };
  const ratio = box[2] / box[3];
  if (w === null && h === null) return { viewBox: box, width: box[2], height: box[3] };
  return { viewBox: box, width: w ?? h! * ratio, height: h ?? w! / ratio };
}
