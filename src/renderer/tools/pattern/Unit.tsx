// The unit lengths show in, across the whole tool: tile, spacing, sizes, jitter and the artboard.
// Where it sits is only where the hand is (Arrangement and Export); the choice is the document's one.
import { Segmented } from '../../ui/index.ts';
import type { Doc } from './actions.ts';
import { withUnit, type PatternDoc, type Unit } from './doc.ts';

const UNITS: { value: Unit; label: string }[] = [
  { value: 'px', label: 'px' },
  { value: 'mm', label: 'mm' },
  { value: 'in', label: 'in' },
];

export const UnitSwitch = ({ doc, d, className }: { doc: Doc; d: PatternDoc; className?: string }) => (
  <Segmented mono fit options={UNITS} value={d.exportUnit} onChange={(u) => doc.transact(`Show lengths in ${u}`, (x) => withUnit(x, u))} className={className} />
);
