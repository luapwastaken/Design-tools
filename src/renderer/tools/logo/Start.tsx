// The empty state (plan unit V): two places to drop, the icon and the wordmark. Each drawing says
// what the tool will do with that part: the icon gets handles, the wordmark is read for its cap
// height and baseline.
import { StartFrame } from '../common/DropStart.tsx';
import type { Doc } from './actions.ts';
import { PartZone } from './PartDrop.tsx';
import s from './Start.module.css';

const IconGlyph = () => (
  <svg width="72" height="72" viewBox="0 0 72 72" fill="none" stroke="currentColor">
    <rect x="12.5" y="12.5" width="47" height="47" strokeDasharray="3 3" />
    <circle cx="36" cy="36" r="14.5" strokeWidth="2" />
    {[12, 60].flatMap((x) => [12, 60].map((y) => <rect key={`${x} ${y}`} x={x - 3.5} y={y - 3.5} width="7" height="7" fill="currentColor" stroke="none" />))}
  </svg>
);

const WordmarkGlyph = () => (
  <svg width="148" height="72" viewBox="0 0 148 72" fill="currentColor">
    <path d="M0 22.5H148M0 52.5H148" stroke="currentColor" strokeDasharray="3 3" fill="none" />
    <path d="M34 22h7v31h-7zM53 22h7v31h-7zM41 35h12v6H41zM96 33h7v31h-7z" />
    <circle cx="78" cy="43" r="7.5" fill="none" stroke="currentColor" strokeWidth="6" />
    <circle cx="110.5" cy="43" r="7.5" fill="none" stroke="currentColor" strokeWidth="6" />
  </svg>
);

export function Start({ doc }: { doc: Doc }) {
  return (
    <StartFrame note="SVG keeps every lockup editable in Illustrator; a PNG works too, with a flat tint for the colour versions. Padding in the file never counts: parts are measured by their artwork. Ctrl V pastes SVG markup into the icon first, then the wordmark.">
      <div className={s.zones}>
        <PartZone doc={doc} role="icon" glyph={<IconGlyph />} />
        <PartZone doc={doc} role="wordmark" glyph={<WordmarkGlyph />} />
      </div>
    </StartFrame>
  );
}
