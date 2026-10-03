/** A rectangle in px, from the top left, y down. */
export type Rect = { x: number; y: number; w: number; h: number };

/** Tiles of at most `size` px a side covering `width` × `height` exactly, row by row from the top left. */
export function tiles(width: number, height: number, size: number): Rect[] {
  if (![width, height, size].every((n) => Number.isInteger(n) && n >= 1)) {
    throw new RangeError(`Tiles need whole sizes of 1 px or more, not ${width} × ${height} in ${size} px tiles.`);
  }
  const out: Rect[] = [];
  for (let y = 0; y < height; y += size) {
    for (let x = 0; x < width; x += size) out.push({ x, y, w: Math.min(size, width - x), h: Math.min(size, height - y) });
  }
  return out;
}
