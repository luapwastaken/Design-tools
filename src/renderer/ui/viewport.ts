// The Viewport's maths and keys (foundation spec §9), pure so they are unit tested
// (test/viewport.test.ts). Screen positions are CSS px from the view's top left; content
// positions are the content's own px.
import { comboOf, type KeyLike } from '../shell/core/keys.ts';

export type Point = { x: number; y: number };
export type Size = { w: number; h: number };
/** a zoom and the content point at the view's centre; centring keeps a window resize from sliding the work away */
export type View = { scale: number; x: number; y: number };
/** what a tool keeps in its view state: Fit follows the view and content sizes until you zoom or pan */
export type Zoom = 'fit' | View;

export const MIN_SCALE = 0.01;
export const MAX_SCALE = 64;
/** the pasteboard kept around fitted content */
const PAD = 24;
/** how much of the content stays on screen however far you pan */
const KEEP = 48;
/** Illustrator's and Photoshop's steps, so the buttons and keys land on 100% and the familiar thirds */
const STOPS = [0.01, 0.015, 0.02, 0.03, 0.04, 0.05, 0.0625, 1 / 12, 0.125, 1 / 6, 0.25, 1 / 3, 0.5, 2 / 3, 1, 1.5, 2, 3, 4, 6, 8, 12, 16, 24, 32, 48, 64];

export const clampScale = (s: number) => Math.min(MAX_SCALE, Math.max(MIN_SCALE, s));

export function fitView(content: Size, box: Size): View {
  const w = Math.max(1, content.w);
  const h = Math.max(1, content.h);
  const room = (n: number) => Math.max(1, n - 2 * Math.min(PAD, n / 8));
  return { scale: clampScale(Math.min(room(box.w) / w, room(box.h) / h)), x: w / 2, y: h / 2 };
}

/**
 * With a grid of `cell` content px (Dither's blocks), the scale that makes a cell a whole number of
 * device pixels: the nearest, or the next up or down (`dir`), so nearest-neighbour draws every cell
 * the same size. Below one device pixel a cell, where the view smooths, any scale is kept.
 */
export function snapScale(scale: number, cell: number, dpr: number, dir: -1 | 0 | 1 = 0): number {
  const k = cell * dpr;
  const px = scale * k;
  if (!(px >= 1)) return scale;
  const whole = dir > 0 ? Math.ceil(px - 1e-9) : dir < 0 ? Math.floor(px + 1e-9) : Math.round(px);
  return clampScale(Math.max(1, whole) / k);
}

export const resolveZoom = (z: Zoom, content: Size, box: Size): View => (z === 'fit' ? fitView(content, box) : z);

/** where content (0, 0) sits on screen */
export const originOf = (v: View, box: Size): Point => ({ x: box.w / 2 - v.x * v.scale, y: box.h / 2 - v.y * v.scale });

export const toContent = (v: View, box: Size, at: Point): Point => ({ x: v.x + (at.x - box.w / 2) / v.scale, y: v.y + (at.y - box.h / 2) / v.scale });

/** the view at `scale` with the content point under `at` (screen) staying put */
export function zoomAt(v: View, scale: number, at: Point, box: Size): View {
  const s = clampScale(scale);
  const p = toContent(v, box, at);
  return { scale: s, x: p.x - (at.x - box.w / 2) / s, y: p.y - (at.y - box.h / 2) / s };
}

/** the content follows the pointer by (dx, dy) screen px */
export const panBy = (v: View, dx: number, dy: number): View => ({ ...v, x: v.x - dx / v.scale, y: v.y - dy / v.scale });

/** never lose the work: at least KEEP px of it (or of the view, when that's smaller) stays in view */
export function clampView(v: View, content: Size, box: Size): View {
  const axis = (c: number, len: number, room: number) => {
    const m = Math.min(KEEP, room / 2);
    return Math.min(len + (room / 2 - m) / v.scale, Math.max((m - room / 2) / v.scale, c));
  };
  return { scale: v.scale, x: axis(v.x, content.w, box.w), y: axis(v.y, content.h, box.h) };
}

/** the next step in or out from `scale` */
export function stepScale(scale: number, dir: 1 | -1): number {
  const eps = 1e-6;
  const next = dir > 0 ? STOPS.find((s) => s > scale * (1 + eps)) : STOPS.findLast((s) => s < scale * (1 - eps));
  return next ?? (dir > 0 ? MAX_SCALE : MIN_SCALE);
}

/** wheel notches to a zoom factor; a touchpad pinch arrives as Ctrl+wheel in small deltas */
export function wheelFactor(e: { deltaY: number; deltaMode: number; ctrlKey: boolean }): number {
  const px = e.deltaY * (e.deltaMode === 1 ? 40 : e.deltaMode === 2 ? 800 : 1);
  return Math.min(2, Math.max(0.5, Math.exp(-px * (e.ctrlKey ? 0.01 : 0.002))));
}

export type ZoomKey = 'fit' | 'actual' | 'in' | 'out';

/**
 * Ctrl+0 Fit, Ctrl+Alt+0 100%, Ctrl+= and Ctrl+- (with or without Shift, and the numpad's + and -).
 * AltGr is Ctrl+Alt on Windows: AltGr+0 types a character on many layouts, so it is left alone.
 */
export function zoomKey(e: KeyLike, altGraph = false): ZoomKey | null {
  const c = comboOf(e);
  if (!c.ctrl || altGraph) return null;
  if (c.key === '0') return c.shift ? null : c.alt ? 'actual' : 'fit';
  if (c.alt) return null;
  if (c.key === '=' || c.key === '+') return 'in';
  if (c.key === '-' || c.key === '_') return 'out';
  return null;
}

export const sameZoom = (a: Zoom | undefined, b: Zoom | undefined): boolean =>
  a === b || (typeof a === 'object' && typeof b === 'object' && a.scale === b.scale && a.x === b.x && a.y === b.y);

/** a zoom read back from saved view state: anything odd is Fit */
export function asZoom(raw: unknown): Zoom {
  if (typeof raw !== 'object' || raw === null) return 'fit';
  const { scale, x, y } = raw as Record<string, unknown>;
  const num = (n: unknown): n is number => typeof n === 'number' && Number.isFinite(n);
  return num(scale) && num(x) && num(y) && scale >= MIN_SCALE && scale <= MAX_SCALE ? { scale, x, y } : 'fit';
}
