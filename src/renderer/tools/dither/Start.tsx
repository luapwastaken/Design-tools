// The empty state (plan unit V): one place to drop an image, a GIF or a sequence, and the other
// ways in (a file, the Library, a paste). The glyph is a ramp on a Bayer screen, so the tool says
// what it does before it's used.
import { DropStart } from '../common/DropStart.tsx';
import { pickImage, type Doc } from './actions.ts';
import { useView } from './view-state.ts';

const BAYER = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5];
const COLS = 32;
const ROWS = 8;
const CELL = 4;
// the blocks a Bayer 4 × 4 screen inks along a ramp from paper to solid
const RAMP = Array.from({ length: COLS * ROWS }, (_, n) => [n % COLS, Math.floor(n / COLS)]).filter(([x, y]) => (x + 0.5) / COLS > (BAYER[(y % 4) * 4 + (x % 4)] + 0.5) / 16);

const Glyph = () => (
  <svg width={COLS * CELL} height={ROWS * CELL} viewBox={`0 0 ${COLS * CELL} ${ROWS * CELL}`} fill="currentColor" shapeRendering="crispEdges" aria-hidden="true">
    {RAMP.map(([x, y]) => (
      <rect key={`${x}.${y}`} x={x * CELL} y={y * CELL} width={CELL} height={CELL} />
    ))}
  </svg>
);

export function Start({ doc }: { doc: Doc }) {
  const { times } = useView();
  return (
    <DropStart
      tool="dither"
      glyph={<Glyph />}
      title="Drop an image to dither"
      line="A photo, a render, a pattern or a logo: PNG, JPEG, WebP, TIFF or SVG at full resolution. An animated GIF, or several frames of a sequence at once, plays frame by frame. Ctrl V pastes one."
      note={
        <>
          It starts as a 1-bit Mac at 2 px blocks. The pixel size is the block in the file: what you see at 100% is what exports
          {times === 1 ? '' : times === 0 ? ', though the export is set to 1 px a block' : `, though the export is set to ${times} × that`}. Transparency is flattened on white.
        </>
      }
      choose={{ label: 'Choose files', onClick: () => pickImage(doc) }}
    />
  );
}
