// The built-in shapes. Each viewBox is drawn tight to the artwork, so it is the slot's bounds without
// measuring. No fill: they draw black, like any SVG, until a slot takes palette colours.

export type BuiltinShape = { id: string; name: string; svg: string };

const shape = (id: string, name: string, viewBox: string, body: string): BuiltinShape => ({
  id,
  name,
  svg: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${viewBox}">${body}</svg>`,
});

/** a regular five-point star on a circle of 50, the classic proportion (inner radius 0.382 of outer) */
function star5(): BuiltinShape {
  const pts = Array.from({ length: 10 }, (_, k) => {
    const r = k % 2 ? 50 * 0.381966 : 50;
    const a = ((-90 + k * 36) * Math.PI) / 180;
    return [50 + r * Math.cos(a), 50 + r * Math.sin(a)].map((v) => +v.toFixed(3));
  });
  const xs = pts.map((p) => p[0]);
  const ys = pts.map((p) => p[1]);
  const [x, y] = [Math.min(...xs), Math.min(...ys)];
  const box = [x, y, Math.max(...xs) - x, Math.max(...ys) - y].map((v) => +v.toFixed(3));
  return shape('star-5', 'Star 5', box.join(' '), `<polygon points="${pts.flat().join(' ')}"/>`);
}

export const BUILTIN_SHAPES: BuiltinShape[] = [
  shape('circle', 'Circle', '0 0 100 100', '<circle cx="50" cy="50" r="50"/>'),
  shape('square', 'Square', '0 0 100 100', '<rect width="100" height="100"/>'),
  star5(),
  shape('sparkle-4', 'Sparkle 4', '0 0 100 100', '<path d="M50 0C53 38 62 47 100 50C62 53 53 62 50 100C47 62 38 53 0 50C38 47 47 38 50 0Z"/>'),
  shape('cross', 'Cross', '0 0 100 100', '<path d="M35 0h30v35h35v30h-35v35h-30v-35h-35v-30h35z"/>'),
  shape('diamond', 'Diamond', '0 0 70 100', '<polygon points="35 0 70 50 35 100 0 50"/>'),
  // v1's "Star 2 blobby"
  shape(
    'blob',
    'Blob',
    '0 0 259.49 267.09',
    '<path d="M172.11,216.11c-69.47,73.47-79.54,70.27-102.87-27.56-91.19-43.27-91.53-53.88-5.57-106.25,13.23-100.34,22.33-103.76,99.37-38.21,99.23-17.99,105.92-11.44,67.03,82.72,47.97,88.27,43.02,97.49-57.96,89.3Z"/>',
  ),
  // v1's bracket geometry
  shape(
    'chevron',
    'Chevron',
    '0 0 183.93 139.1',
    '<path d="M.09,0l47.4.05,71.05,42.73-71.14,42.58-47.4-.05,71.14-42.58L.09,0Z"/><path d="M65.39,96.32l71.14-42.58,47.4.05-71.14,42.58,71.05,42.73-47.4-.05-71.05-42.73Z"/>',
  ),
];
