// A plate on a sheet a printer can use (the Marks switch): the page with 3 mm of bleed, crop marks at
// the trim corners, a registration target at the middle of each side and the ink's name in the slug.
// Plates are 0 where ink prints and 255 where the paper shows, so a mark is drawn by writing 0. Pure
// but for the slug's text, which the caller draws (it needs a canvas) and hands in.

/** how far the picture runs past the trim, mm */
export const BLEED_MM = 3;
/** the sheet round the trim, mm: room for the bleed, the marks and the slug */
export const MARGIN_MM = 12;
const GAP_MM = 1;
const CROP_MM = 5;
const LINE_MM = 0.25;
const TARGET_AT_MM = 7.5;
const TARGET_R_MM = 2;
const TARGET_ARM_MM = 3.5;
/** the slug's text starts this far in from the trim's left edge, and is this tall */
export const SLUG_LEFT_MM = 2;
export const SLUG_BASELINE_MM = 9;
export const SLUG_TEXT_MM = 2.4;

export type Slug = { data: Uint8Array; w: number; h: number };

const px = (mm: number, dpi: number) => (mm * dpi) / 25.4;

/** the sheet's size for a plate of `w` × `h` print pixels, and where the trim sits on it */
export function sheetOf(w: number, h: number, dpi: number): { w: number; h: number; margin: number; bleed: number } {
  const margin = Math.round(px(MARGIN_MM, dpi));
  return { w: w + 2 * margin, h: h + 2 * margin, margin, bleed: Math.min(Math.round(px(BLEED_MM, dpi)), margin) };
}

/** a source index mirrored back into 0..n-1 (the edge repeats once, then turns round) */
const mirror = (i: number, n: number): number => {
  const m = ((i % (2 * n)) + 2 * n) % (2 * n);
  return m < n ? m : 2 * n - 1 - m;
};

/**
 * The plate on its sheet. The page sits at the margin; the band of bleed round it is the page's
 * edge mirrored, which carries the screen on past the trim without making up any picture. `slug`
 * is the ink's name as coverage (0..255, 255 inked) and is set bottom left, under the trim.
 */
export function withMarks(grey: Uint8Array, w: number, h: number, dpi: number, slug: Slug | null): Uint8Array {
  const sheet = sheetOf(w, h, dpi);
  const { margin: m, bleed: b } = sheet;
  const out = new Uint8Array(sheet.w * sheet.h).fill(255);
  for (let y = m - b; y < m + h + b; y++) {
    const row = mirror(y - m, h) * w;
    for (let x = m - b; x < m + w + b; x++) out[y * sheet.w + x] = grey[row + mirror(x - m, w)];
  }
  const ink = (x: number, y: number) => {
    if (x >= 0 && y >= 0 && x < sheet.w && y < sheet.h) out[y * sheet.w + x] = 0;
  };
  const line = Math.max(1, Math.round(px(LINE_MM, dpi)));
  const lo = Math.floor(line / 2);
  const box = (x0: number, y0: number, x1: number, y1: number) => {
    for (let y = Math.round(y0); y < Math.round(y1); y++) for (let x = Math.round(x0); x < Math.round(x1); x++) ink(x, y);
  };

  // crop marks: at each trim corner, one line along each side, clear of the bleed
  const near = b + px(GAP_MM, dpi);
  const far = near + px(CROP_MM, dpi);
  for (const [cx, sx] of [[m, -1], [m + w, 1]] as const) {
    for (const [cy, sy] of [[m, -1], [m + h, 1]] as const) {
      box(sx < 0 ? cx - far : cx + near, cy - lo, sx < 0 ? cx - near : cx + far, cy - lo + line);
      box(cx - lo, sy < 0 ? cy - far : cy + near, cx - lo + line, sy < 0 ? cy - near : cy + far);
    }
  }

  // registration targets: a ring with a cross through it, at the middle of each side
  const r = px(TARGET_R_MM, dpi);
  const arm = px(TARGET_ARM_MM, dpi);
  const at = px(TARGET_AT_MM, dpi);
  for (const [tx, ty] of [[m + w / 2, m - at], [m + w / 2, m + h + at], [m - at, m + h / 2], [m + w + at, m + h / 2]]) {
    const [x0, y0] = [Math.round(tx - arm), Math.round(ty - arm)];
    const [x1, y1] = [Math.round(tx + arm), Math.round(ty + arm)];
    for (let y = y0; y <= y1; y++) {
      for (let x = x0; x <= x1; x++) {
        const d = Math.hypot(x + 0.5 - tx, y + 0.5 - ty);
        const onRing = Math.abs(d - r) <= line / 2;
        const onCross = Math.abs(x + 0.5 - tx) <= line / 2 || Math.abs(y + 0.5 - ty) <= line / 2;
        if (onRing || onCross) ink(x, y);
      }
    }
  }

  if (slug) {
    const x0 = m + Math.round(px(SLUG_LEFT_MM, dpi));
    const y0 = m + h + Math.round(px(SLUG_BASELINE_MM, dpi)) - slug.h;
    for (let y = 0; y < slug.h; y++) {
      for (let x = 0; x < slug.w; x++) {
        const cover = slug.data[y * slug.w + x];
        const at = (y0 + y) * sheet.w + x0 + x;
        if (cover && x0 + x < sheet.w && y0 + y < sheet.h && y0 + y >= 0) out[at] = Math.min(out[at], 255 - cover);
      }
    }
  }
  return out;
}

/** the slug's room: how wide its text may run before the registration target at the bottom middle, and how tall it is, print px */
export function slugRoom(w: number, dpi: number): { w: number; h: number } {
  return { w: Math.max(0, Math.round(w / 2 - px(SLUG_LEFT_MM + TARGET_ARM_MM + 1, dpi))), h: Math.ceil(px(SLUG_TEXT_MM * 1.4, dpi)) };
}
