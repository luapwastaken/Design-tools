// The empty state (plan unit V): one place to drop an image, and the other ways in (a file, the
// Library, a paste). The glyph is a halftone ramp, so the tool says what it does before it's used.
import { DropStart } from '../common/DropStart.tsx';
import { pickImage, type Doc } from './actions.ts';

// a ramp of round dots on a 45° screen, from bare paper to nearly solid
const RAMP = Array.from({ length: 9 * 5 }, (_, n) => {
  const [i, j] = [n % 9, Math.floor(n / 9)];
  const cx = 8 + i * 13 + (j % 2 ? 6.5 : 0);
  const cy = 8 + j * 13;
  return { cx, cy, r: Math.max(0.6, Math.sqrt((0.06 + (cx / 124) * 0.8) / Math.PI) * 13 * 0.62) };
});

const Glyph = () => (
  <svg width="128" height="64" viewBox="0 0 128 64" fill="currentColor" aria-hidden="true">
    {RAMP.filter((d) => d.cx < 124).map((d, k) => (
      <circle key={k} cx={d.cx} cy={d.cy} r={d.r} />
    ))}
  </svg>
);

export const Start = ({ doc }: { doc: Doc }) => (
  <DropStart
    tool="halftone"
    glyph={<Glyph />}
    title="Drop an image to screen"
    line="A render, a photo, a pattern or a logo: PNG, JPEG, WebP, TIFF (16-bit ones read at 8-bit precision), GIF or SVG, at full resolution with its transparency. Ctrl V pastes one."
    note="It prints to A4 at 300 DPI and 60 lines to the inch until you change the output size. What you see is what prints: the SVG, the PNG and the plates are drawn from the same dots."
    choose={{ label: 'Choose file', onClick: () => pickImage(doc) }}
  />
);
