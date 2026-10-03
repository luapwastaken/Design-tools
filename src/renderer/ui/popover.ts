// Where a floating layer (tooltip, menu, submenu) goes. Everything stays inside the window and clear
// of the Windows caption buttons, which the title-bar overlay draws over the top-right corner.

export const CAPTION = { w: 140, h: 40 };
const M = 4; // clearance from the window edges

export type Placement = { x: number; y: number; origin: string };

const clamp = (v: number, lo: number, hi: number) => Math.min(Math.max(v, lo), Math.max(lo, hi));

function finish(x: number, y: number, w: number, h: number) {
  const vw = innerWidth;
  const vh = innerHeight;
  x = clamp(x, M, vw - M - w);
  y = clamp(y, M, vh - M - h);
  if (y < CAPTION.h && x + w > vw - CAPTION.w) x = Math.max(M, vw - CAPTION.w - w);
  return { x, y };
}

/** Below the anchor (tooltips centred, menus left-aligned); above it when there's no room below. */
export function placeBelow(a: DOMRect, w: number, h: number, align: 'start' | 'center', gap: number): Placement {
  let y = a.bottom + gap;
  const above = y + h > innerHeight - M && a.top - gap - h >= M;
  if (above) y = a.top - gap - h;
  const p = finish(align === 'center' ? a.left + a.width / 2 - w / 2 : a.left, y, w, h);
  return { ...p, origin: `${clamp(a.left + a.width / 2 - p.x, 0, w)}px ${above ? h : 0}px` };
}

/** Beside the anchor, centred on it (tooltips on an icon rail); on its left when there's no room on the right. */
export function placeRight(a: DOMRect, w: number, h: number, gap: number): Placement {
  const left = a.right + gap + w > innerWidth - M;
  const p = finish(left ? a.left - gap - w : a.right + gap, a.top + a.height / 2 - h / 2, w, h);
  return { ...p, origin: `${left ? w : 0}px ${h / 2}px` };
}

/** A context menu at the pointer, opening away from the nearest window edges. */
export function placeAtPoint(px: number, py: number, w: number, h: number): Placement {
  const x = px + w > innerWidth - M ? px - w : px;
  const y = py + h > innerHeight - M ? py - h : py;
  const p = finish(x, y, w, h);
  return { ...p, origin: `${clamp(px - p.x, 0, w)}px ${clamp(py - p.y, 0, h)}px` };
}

/** A submenu beside its row: right, or left when the right edge is too close. */
export function placeBeside(a: DOMRect, w: number, h: number): Placement {
  const left = a.right - 2 + w > innerWidth - M;
  const p = finish(left ? a.left - w + 2 : a.right - 2, a.top - 4, w, h);
  return { ...p, origin: `${left ? w : 0}px ${clamp(a.top - p.y, 0, h)}px` };
}
