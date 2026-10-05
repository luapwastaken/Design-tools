// The empty state (plan unit V): one place to drop an image, a GIF or a video, and the other ways in
// (a file, the Library, a paste). The glyph is the tool itself: an image, the divider, and the same
// image through scanlines, so it says what it does before it's used.
import { DropStart } from '../common/DropStart.tsx';
import { pickFile, type Doc } from './actions.ts';

const W = 128;
const H = 40;
const MID = 62;
// the right half as scanlines: two px lit, two dark, as the CRT effect draws them
const LINES = Array.from({ length: H / 4 }, (_, n) => n * 4);

const Glyph = () => (
  <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`} fill="currentColor" shapeRendering="crispEdges" aria-hidden="true">
    <rect x="0" y="0" width={MID} height={H} fillOpacity="0.32" />
    {LINES.map((y) => (
      <rect key={y} x={MID + 3} y={y} width={W - MID - 3} height="2" />
    ))}
    <rect x={MID} y="0" width="1" height={H} />
    <rect x={MID - 3} y={H / 2 - 6} width="7" height="12" rx="1.5" />
  </svg>
);

export const Start = ({ doc }: { doc: Doc }) => (
  <DropStart
    tool="postfx"
    glyph={<Glyph />}
    title="Drop an image, a GIF or a video"
    line="Or paste one with Ctrl V."
    note=""
    choose={{ label: 'Choose a file', onClick: () => pickFile(doc) }}
  />
);
