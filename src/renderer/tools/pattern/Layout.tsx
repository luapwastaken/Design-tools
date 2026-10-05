// The layout groups (spec §3): Arrangement, Spacing and size, Rotation and jitter. Every value is
// typable and each change is one history step; fix() keeps the tile from collapsing. The arrangement
// choice itself sits in the options bar (PatternBar), drawn as pictograms.
import type { Tile } from '../../../shared/pattern/types.ts';
import type { IconName } from '../../shell/tool.ts';
import { IconButton, InspectorGroup, InspectorRow, NumberField, Segmented, Slider, useDocNumber } from '../../ui/index.ts';
import { fmtPx } from '../common/names.ts';
import { reseed, type Doc } from './actions.ts';
import { fix, gapMin, LIMIT, type Arrangement, type PatternDoc } from './doc.ts';
import s from './Inspector.module.css';

/** the arrangements as pictograms; `tip` is the one-line description */
export const ARRANGEMENTS: { value: Arrangement; label: string; icon: IconName; tip: string }[] = [
  { value: 'grid', label: 'Grid', icon: 'pattern', tip: 'Rows and columns, every cell in line.' },
  { value: 'halfdrop', label: 'Half-drop', icon: 'view_column', tip: 'Every other column drops by half a cell.' },
  { value: 'brick', label: 'Brick', icon: 'wall', tip: 'Every other row shifts by half a cell.' },
  { value: 'scatter', label: 'Scatter', icon: 'grain', tip: 'Spread evenly at random, never overlapping, seamless across the edges.' },
];

type Get = (d: PatternDoc) => number;
type Set = (d: PatternDoc, v: number) => PatternDoc;

/** a number in the document; the result always passes fix() */
const useNum = (doc: Doc, label: string, key: string, get: Get, set: Set) => useDocNumber(doc, { label, key, get, set: (d, v) => fix(set(d, v)) });

export function ArrangementModule({ doc, d, tile }: { doc: Doc; d: PatternDoc; tile: Tile }) {
  const cols = useNum(doc, 'Change the columns', 'cols', (x) => x.cols, (x, v) => ({ ...x, cols: v }));
  const rows = useNum(doc, 'Change the rows', 'rows', (x) => x.rows, (x, v) => ({ ...x, rows: v }));
  const seed = useNum(doc, 'Change the seed', 'seed', (x) => x.seed, (x, v) => ({ ...x, seed: v }));
  const spots = d.cols * d.rows;
  const scatter = d.arrangement === 'scatter';
  // an odd count can't alternate across the seam, so layout doubles the tile that way
  const doubled = d.arrangement === 'halfdrop' && d.cols % 2 ? 'columns' : d.arrangement === 'brick' && d.rows % 2 ? 'rows' : null;
  const note = scatter
    ? tile.items.length < spots
      ? `${tile.items.length} of ${spots} spots found room; the rest stay empty.`
      : null
    : doubled
      ? `Odd ${doubled}: the tile holds twice as many, so the offset repeats.`
      : null;
  return (
    <InspectorGroup id="pattern.arrangement" title="Arrangement" meta={fmtPx(Math.round(tile.width), Math.round(tile.height))}>
      <InspectorRow label={scatter ? 'Spots' : 'Cells'} pair info={scatter ? 'How many spots the scatter tries to fill, across and down.' : 'How many cells the tile holds, columns and rows.'}>
        <NumberField label={scatter ? 'Across' : 'Columns'} min={LIMIT.count[0]} max={LIMIT.count[1]} {...cols} />
        <NumberField label={scatter ? 'Down' : 'Rows'} min={LIMIT.count[0]} max={LIMIT.count[1]} {...rows} />
      </InspectorRow>
      {note && <p className={s.note}>{note}</p>}
      <InspectorRow label="Seed" info="The same seed always draws the same shapes, sizes and turns. R draws a new one.">
        <NumberField label="Seed" hideLabel min={LIMIT.seed[0]} max={LIMIT.seed[1]} className={s.grow} {...seed} />
        <IconButton icon="casino" label="Reseed: a new draw of shapes, sizes and turns" shortcut="R" onClick={() => reseed(doc)} />
      </InspectorRow>
    </InspectorGroup>
  );
}

export function SpacingModule({ doc, d, tile }: { doc: Doc; d: PatternDoc; tile: Tile }) {
  const gapX = useNum(doc, 'Change the gap across', 'gapX', (x) => x.gapX, (x, v) => ({ ...x, gapX: v }));
  const gapY = useNum(doc, 'Change the gap down', 'gapY', (x) => x.gapY, (x, v) => ({ ...x, gapY: v }));
  // scatter keeps one distance between shapes (layout averages the two gaps): set both
  const gap = useNum(doc, 'Change the gap', 'gap', (x) => Math.max(0, Math.round((x.gapX + x.gapY) / 2)), (x, v) => ({ ...x, gapX: v, gapY: v }));
  // the range stays whole: moving one end past the other takes the other along
  const min = useNum(doc, 'Change the smallest size', 'sizeMin', (x) => x.sizeMin, (x, v) => ({ ...x, sizeMin: v, sizeMax: Math.max(x.sizeMax, v) }));
  const max = useNum(doc, 'Change the largest size', 'sizeMax', (x) => x.sizeMax, (x, v) => ({ ...x, sizeMax: v, sizeMin: Math.min(x.sizeMin, v) }));
  const scatter = d.arrangement === 'scatter';
  // layout's own count per tile, doubled for an odd half-drop or brick
  const across = tile.width / (d.cols * (d.arrangement === 'halfdrop' && d.cols % 2 ? 2 : 1));
  const down = tile.height / (d.rows * (d.arrangement === 'brick' && d.rows % 2 ? 2 : 1));
  return (
    <InspectorGroup id="pattern.spacing" title="Spacing and size" meta={scatter ? undefined : `Pitch ${fmtPx(Math.round(across), Math.round(down))}`}>
      {scatter ? (
        <Slider label="Gap" info="The least room between the circles round any two shapes, so no two touch at any turn." min={0} max={LIMIT.gapMax} unit="px" {...gap} />
      ) : (
        <InspectorRow label="Gap" pair info="The same gap runs across the tile edge, so the repeat keeps its rhythm. Below 0 the shapes overlap.">
          <NumberField label="Across" min={gapMin(d)} max={LIMIT.gapMax} unit="px" {...gapX} />
          <NumberField label="Down" min={gapMin(d)} max={LIMIT.gapMax} unit="px" {...gapY} />
        </InspectorRow>
      )}
      <InspectorRow label="Size" pair info="Each shape’s longest side, measured on its artwork. Each item draws its own size in this range.">
        <NumberField label="From" min={LIMIT.size[0]} max={LIMIT.size[1]} unit="px" {...min} />
        <NumberField label="To" min={LIMIT.size[0]} max={LIMIT.size[1]} unit="px" {...max} />
      </InspectorRow>
    </InspectorGroup>
  );
}

const TURNS = [
  { value: 'fixed' as const, label: 'Fixed' },
  { value: 'random' as const, label: 'Random' },
];

export function RotationModule({ doc, d }: { doc: Doc; d: PatternDoc }) {
  const r = d.rotation;
  const angle = useNum(doc, 'Change the angle', 'angle', (x) => x.rotation.angle, (x, v) => ({ ...x, rotation: { ...x.rotation, angle: v } }));
  const from = useNum(doc, 'Change the turn range', 'turnMin', (x) => x.rotation.min, (x, v) => ({ ...x, rotation: { ...x.rotation, min: v, max: Math.max(x.rotation.max, v) } }));
  const to = useNum(doc, 'Change the turn range', 'turnMax', (x) => x.rotation.max, (x, v) => ({ ...x, rotation: { ...x.rotation, max: v, min: Math.min(x.rotation.min, v) } }));
  const jitter = useNum(doc, 'Change the jitter', 'jitter', (x) => x.jitter, (x, v) => ({ ...x, jitter: v }));
  const scatter = d.arrangement === 'scatter';
  return (
    <InspectorGroup id="pattern.rotation" title="Rotation and jitter">
      <Segmented label="Rotation" options={TURNS} value={r.mode} onChange={(mode) => doc.transact(mode === 'fixed' ? 'Turn every shape alike' : 'Turn each shape at random', (x) => ({ ...x, rotation: { ...x.rotation, mode } }))} />
      {r.mode === 'fixed' ? (
        <Slider label="Angle" min={LIMIT.angle[0]} max={LIMIT.angle[1]} origin={0} unit="°" {...angle} />
      ) : (
        <InspectorRow label="Turn" pair>
          <NumberField label="From" min={LIMIT.angle[0]} max={LIMIT.angle[1]} unit="°" {...from} />
          <NumberField label="To" min={LIMIT.angle[0]} max={LIMIT.angle[1]} unit="°" {...to} />
        </InspectorRow>
      )}
      <Slider
        label="Jitter"
        info={scatter ? 'Scatter already places each shape at random, so jitter waits for the other arrangements.' : 'Nudges each shape off its place, up to this far each way.'}
        min={LIMIT.jitter[0]}
        max={LIMIT.jitter[1]}
        unit="px"
        disabled={scatter}
        {...jitter}
      />
    </InspectorGroup>
  );
}
