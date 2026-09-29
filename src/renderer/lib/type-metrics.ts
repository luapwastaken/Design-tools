// Where a wordmark's letters sit (Logo plan unit T): cap top and baseline, found from the artwork,
// so a lockup aligns an icon to the letters and not to the file's box or a descender. The letters
// are the drawing's connected shapes. The baseline is the highest line enough of them stand on, and
// the cap top is the top of the tallest ones. Per-row ink coverage looks simpler but gets fooled: a T's
// bar reads as a baseline, and so does a word whose letters mostly descend. A TM or an R in a ring
// beside the letters, a ring joined on top of an A, and a letter anti-aliasing broke in two are
// told from the letters. Artwork that isn't one line of type (joined script, bouncing letters, two
// lines the same size) gets no metrics, and the lockup uses the artwork box instead. What the
// drawing can't tell apart: a word whose every piece reaches below the line (gpp) is read on its
// descender line.
import type { Part } from '../../shared/logo/types.ts';
import { framed } from '../../shared/svg/index.ts';

export type TypeMetrics = NonNullable<Part['type']>;

/**
 * A connected shape in px; right and bottom are exclusive, so they are edges like top and left.
 * `feet`: where each of its columns' ink ends, left to right. By row, top to bottom: `spans`, its
 * leftmost and rightmost pixel as pairs, and `ink`, how many pixels.
 */
type Shape = { top: number; bottom: number; left: number; right: number; feet: Int32Array; spans: Int32Array; ink: Int32Array };

const height = (s: Shape) => s.bottom - s.top;
const median = (v: number[]) => [...v].sort((a, b) => a - b)[v.length >> 1];

/** the 8-connected shapes of an RGBA image's ink: alpha of at least half the strongest */
function shapes(rgba: ArrayLike<number>, w: number, h: number): Shape[] {
  let max = 0;
  for (let i = 3; i < rgba.length; i += 4) if (rgba[i] > max) max = rgba[i];
  const cut = Math.max(1, max / 2);
  const ink = (x: number, y: number) => rgba[(y * w + x) * 4 + 3] >= cut;
  const runs: { y: number; x0: number; x1: number }[] = [];
  const parent: number[] = [];
  const find = (i: number): number => {
    while (parent[i] !== i) i = parent[i] = parent[parent[i]];
    return i;
  };
  let above: number[] = [];
  for (let y = 0; y < h; y++) {
    const row: number[] = [];
    for (let x = 0; x < w; x++) {
      if (!ink(x, y)) continue;
      const x0 = x;
      while (x < w && ink(x, y)) x++;
      const id = runs.push({ y, x0, x1: x }) - 1;
      parent.push(id);
      // a run above that shares a column with this one, or touches it at a corner
      for (const a of above) if (runs[a].x0 <= x && runs[a].x1 >= x0) parent[find(a)] = find(id);
      row.push(id);
    }
    above = row;
  }
  const byRoot = new Map<number, Shape>();
  runs.forEach((r, i) => {
    const s = byRoot.get(find(i));
    if (!s) byRoot.set(find(i), { top: r.y, bottom: r.y + 1, left: r.x0, right: r.x1, feet: new Int32Array(0), spans: new Int32Array(0), ink: new Int32Array(0) });
    else {
      s.top = Math.min(s.top, r.y);
      s.bottom = Math.max(s.bottom, r.y + 1);
      s.left = Math.min(s.left, r.x0);
      s.right = Math.max(s.right, r.x1);
    }
  });
  for (const s of byRoot.values()) {
    s.feet = new Int32Array(s.right - s.left);
    s.spans = new Int32Array(2 * height(s)).fill(-1);
    s.ink = new Int32Array(height(s));
  }
  runs.forEach((r, i) => {
    const s = byRoot.get(find(i))!;
    for (let x = r.x0; x < r.x1; x++) s.feet[x - s.left] = r.y + 1;
    const at = 2 * (r.y - s.top);
    if (s.spans[at] < 0 || r.x0 < s.spans[at]) s.spans[at] = r.x0;
    s.spans[at + 1] = Math.max(s.spans[at + 1], r.x1);
    s.ink[r.y - s.top] += r.x1 - r.x0;
  });
  return [...byRoot.values()];
}

/**
 * Where a letter itself starts: below a ring set on it and touching it (an Å in many faces), else
 * its top. The ring is narrow over a much wider letter, with a neck where they meet; an f's hook or
 * a T's bar has nothing much wider under it.
 */
function crown(s: Shape): number {
  const n = height(s);
  const width = (i: number) => s.spans[2 * i + 1] - s.spans[2 * i];
  // the widest row from each row down
  const under = new Int32Array(n + 1);
  for (let i = n - 1; i >= 0; i--) under[i] = Math.max(under[i + 1], width(i));
  let above = 0;
  let neck = -1;
  for (let i = 0; i <= 0.4 * n; i++) {
    const w = width(i);
    if (above && w <= 0.75 * above && under[i] >= 2 * above) {
      if (neck < 0 || w <= width(neck)) neck = i;
    } else if (neck >= 0) break;
    above = Math.max(above, w);
  }
  return s.top + Math.max(0, neck);
}

/**
 * Cap top, baseline and, when the letters have one below the caps, x-height top, as px edges of an
 * RGBA image of the artwork (y grows down). Null when it doesn't read as one line of type.
 */
export function findType(rgba: ArrayLike<number>, w: number, h: number): TypeMetrics | null {
  const all = shapes(rgba, w, h);
  // a frame round the letters, or a swash wrapped under them, is not a letter
  const holds = (a: Shape, b: Shape) => a !== b && height(b) >= 0.2 * height(a) && a.left <= b.left && a.right >= b.right && a.top <= b.top && a.bottom >= b.bottom;
  const free = all.filter((a) => !all.some((b) => holds(a, b)));
  const tallest = Math.max(0, ...free.map(height));
  // dots, most accents, hyphens and full stops are far shorter than any letter
  const letters = free.filter((s) => height(s) >= 0.3 * tallest);
  if (letters.length < 2) return null;
  const tol = Math.max(1.5, 0.04 * median(letters.map(height)));
  const tops = new Map(letters.map((s) => [s, crown(s)]));
  const wide = (list: Shape[]) => list.reduce((t, s) => t + s.right - s.left, 0);
  /** the ink of these shapes above and below row b */
  const split = (list: Shape[], b: number) => {
    let [up, down] = [0, 0];
    for (const s of list) s.ink.forEach((n, i) => (s.top + i < b ? (up += n) : (down += n)));
    return down / Math.max(1, up);
  };
  const mid = (s: Shape) => (s.left + s.right) / 2;

  for (const b of [...new Set(letters.map((s) => s.bottom))].sort((p, q) => p - q)) {
    const line = letters.filter((s) => s.top < b && s.bottom >= b);
    // flat letters end on the baseline, round ones overshoot it a little
    const standing = line.filter((s) => s.bottom <= b + tol && standsOn(s, b, tol));
    if (standing.length < Math.max(2, Math.ceil(0.3 * line.length))) continue;
    const size = median(standing.map(height));
    // a descender is shorter than the letters, and a tail on a few of them: when most of the line
    // carries on below with much of its ink, this is the bottom of a TM or an R in a ring
    const through = line.filter((s) => !standing.includes(s));
    if (Math.max(...line.map((s) => s.bottom)) - b > size || (wide(through) > wide(standing) && split(through, b) > 0.6)) continue;
    // off the line there may be marks or a small tagline, never letters this size above or below it.
    // Within its height a TM or an R in a ring may stand beside it (smaller, or rising above lower
    // case), or a piece of a letter anti-aliasing broke off, over the rest of it.
    const top = Math.min(...line.map((s) => s.top));
    const low = free.filter((s) => s.top < b && s.bottom >= b - tol);
    const aside = (s: Shape) =>
      s.bottom > top + tol && s.top < b - tol && (height(s) < 0.65 * (b - top) || s.top < top - tol || low.some((o) => o !== s && o.left <= mid(s) && mid(s) < o.right));
    if (letters.some((s) => !line.includes(s) && height(s) >= 0.45 * size && !aside(s))) continue;

    const ups = line.map((s) => tops.get(s)!).sort((p, q) => p - q);
    // the flat tops, not an O's overshoot above them
    const capTop = Math.max(...ups.filter((t) => t <= ups[0] + tol));
    // the lowest tops enough letters share, not a broken-off piece's
    const need = Math.max(2, Math.ceil(0.3 * line.length));
    const x = [...ups].reverse().find((t) => ups.filter((u) => Math.abs(u - t) <= tol).length >= need);
    return x !== undefined && b - x < 0.85 * (b - capTop) ? { capTop, baseline: b, xTop: x } : { capTop, baseline: b };
  }
  return null;
}

/**
 * A run of joined letters (a script, or letters set touching) is as deep as its deepest letter: it
 * stands on its bottom only when a fair share of its columns end there, not when one p or g does.
 */
function standsOn(s: Shape, b: number, tol: number): boolean {
  const w = s.right - s.left;
  if (w < 1.5 * height(s)) return true;
  let there = 0;
  for (const y of s.feet) if (y >= b - tol) there++;
  return there >= 0.3 * w;
}

/** the analysis image: 1024 px wide, at least 256 tall for a very wide wordmark, never over 4096 */
function scaleFor(w: number, h: number): number {
  return Math.min(4096 / Math.max(w, h), Math.max(1024 / w, 256 / h));
}

/**
 * A wordmark's type in its own units, from the part's artwork box: an SVG's user units or a trimmed
 * PNG's pixels. Undefined when it doesn't read as one line of type.
 */
export async function measureType(part: Pick<Part, 'svg' | 'png' | 'box'>): Promise<TypeMetrics | undefined> {
  const { box } = part;
  if (!part.svg && !part.png) throw new Error('The part has no artwork to measure.');
  const k = scaleFor(box.w, box.h);
  const w = Math.max(1, Math.round(box.w * k));
  const h = Math.max(1, Math.round(box.h * k));
  const url = part.svg ? URL.createObjectURL(new Blob([framed(part.svg, w, h, [box.x, box.y, box.w, box.h])], { type: 'image/svg+xml' })) : null;
  const ctx = new OffscreenCanvas(w, h).getContext('2d', { willReadFrequently: true })!;
  try {
    const img = new Image();
    img.src = url ?? part.png!;
    await img.decode();
    if (url) ctx.drawImage(img, 0, 0, w, h);
    else ctx.drawImage(img, box.x, box.y, box.w, box.h, 0, 0, w, h);
  } finally {
    if (url) URL.revokeObjectURL(url);
  }
  const rows = findType(ctx.getImageData(0, 0, w, h).data, w, h);
  if (!rows) return undefined;
  const unit = (px: number) => box.y + (px / h) * box.h;
  return { capTop: unit(rows.capTop), baseline: unit(rows.baseline), ...(rows.xTop === undefined ? {} : { xTop: unit(rows.xTop) }) };
}
