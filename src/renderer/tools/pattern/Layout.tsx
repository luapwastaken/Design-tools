// The layout groups (spec §3): Arrangement, Spacing and size, Rotation and jitter. Every value is
// typable and each change is one history step; fix() keeps the tile from collapsing. The arrangement
// choice itself sits in the options bar (PatternBar), drawn as pictograms.
import { layoutTile } from '../../../shared/pattern/layout.ts';
import type { Tile } from '../../../shared/pattern/types.ts';
import type { IconName } from '../../shell/tool.ts';
import { IconButton, InspectorGroup, InspectorRow, NumberField, Segmented, Slider, useDocNumber } from '../../ui/index.ts';
import { reseed, type Doc } from './actions.ts';
import { UnitSwitch } from './Unit.tsx';
import { fix, gapMin, LIMIT, lengthIn, PX_PER, rangeIn, UNIT_STEP, withTileSide, type Arrangement, type PatternDoc } from './doc.ts';
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

/** a length: the document keeps px, the field shows and takes the tool's unit */
const useLen = (doc: Doc, label: string, key: string, get: Get, set: Set) =>
  useDocNumber(doc, { label, key, get: (x) => get(x) / PX_PER[x.exportUnit], set: (x, v) => fix(set(x, v * PX_PER[x.exportUnit])) });

/** what a length field needs of its unit: the unit's name, step and a px range put on its steps */
const lenOf = (d: PatternDoc, range: readonly [number, number]) => {
  const [min, max] = rangeIn(d.exportUnit, range);
  return { min, max, step: UNIT_STEP[d.exportUnit], unit: d.exportUnit };
};

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
  // the tile's own size, in the tool's unit: asking for another scales the whole tile, shapes and gaps with it
  const tileW = useDocNumber(doc, { label: 'Change the tile width', key: 'tileW', get: (x) => layoutTile(x).width / PX_PER[x.exportUnit], set: (x, v) => withTileSide(x, 'width', v * PX_PER[x.exportUnit]) });
  const tileH = useDocNumber(doc, { label: 'Change the tile height', key: 'tileH', get: (x) => layoutTile(x).height / PX_PER[x.exportUnit], set: (x, v) => withTileSide(x, 'height', v * PX_PER[x.exportUnit]) });
  const side = lenOf(d, [LIMIT.side[0], LIMIT.side[1]]);
  return (
    <InspectorGroup id="pattern.arrangement" title="Arrangement" meta={`${lengthIn(tile.width, d.exportUnit)} × ${lengthIn(tile.height, d.exportUnit)} ${d.exportUnit}`} actions={<UnitSwitch doc={doc} d={d} />}>
      <InspectorRow label="Tile" pair info="The size of one repeat. Change either side and the whole tile scales with it, shapes and gaps included, so the pattern looks the same, larger or smaller.">
        <NumberField label="Width" hideLabel {...side} {...tileW} />
        <NumberField label="Height" hideLabel {...side} {...tileH} />
      </InspectorRow>
      <InspectorRow label={scatter ? 'Spots' : 'Cells'} pair info={scatter ? 'How many spots the scatter tries to fill, in columns and rows.' : 'How many cells the tile holds, columns and rows.'}>
        <NumberField label="Columns" min={LIMIT.count[0]} max={LIMIT.count[1]} {...cols} />
        <NumberField label="Rows" min={LIMIT.count[0]} max={LIMIT.count[1]} {...rows} />
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
  const gapX = useLen(doc, 'Change the gap across', 'gapX', (x) => x.gapX, (x, v) => ({ ...x, gapX: v }));
  const gapY = useLen(doc, 'Change the gap down', 'gapY', (x) => x.gapY, (x, v) => ({ ...x, gapY: v }));
  // scatter keeps one distance between shapes (layout averages the two gaps): set both
  const gap = useLen(doc, 'Change the gap', 'gap', (x) => Math.max(0, (x.gapX + x.gapY) / 2), (x, v) => ({ ...x, gapX: v, gapY: v }));
  // the range stays whole: moving one end past the other takes the other along
  const min = useLen(doc, 'Change the smallest size', 'sizeMin', (x) => x.sizeMin, (x, v) => ({ ...x, sizeMin: v, sizeMax: Math.max(x.sizeMax, v) }));
  const max = useLen(doc, 'Change the largest size', 'sizeMax', (x) => x.sizeMax, (x, v) => ({ ...x, sizeMax: v, sizeMin: Math.min(x.sizeMin, v) }));
  const unit = d.exportUnit;
  const gaps = lenOf(d, [gapMin(d), LIMIT.gapMax]);
  const sizes = lenOf(d, LIMIT.size);
  const scatter = d.arrangement === 'scatter';
  // layout's own count per tile, doubled for an odd half-drop or brick
  const across = tile.width / (d.cols * (d.arrangement === 'halfdrop' && d.cols % 2 ? 2 : 1));
  const down = tile.height / (d.rows * (d.arrangement === 'brick' && d.rows % 2 ? 2 : 1));
  return (
    <InspectorGroup id="pattern.spacing" title="Spacing and size" meta={scatter ? undefined : `Pitch ${lengthIn(across, unit)} × ${lengthIn(down, unit)} ${unit}`}>
      {scatter ? (
        <Slider label="Gap" info="The least room between the circles round any two shapes, so no two touch at any turn." {...lenOf(d, [0, LIMIT.gapMax])} {...gap} />
      ) : (
        <InspectorRow label="Gap" pair info="The same gap runs across the tile edge, so the repeat keeps its rhythm. Below 0 the shapes overlap.">
          <NumberField label="Across" {...gaps} {...gapX} />
          <NumberField label="Down" {...gaps} {...gapY} />
        </InspectorRow>
      )}
      <InspectorRow label="Size" pair info="Each shape’s longest side, measured on its artwork. Each item draws its own size in this range.">
        <NumberField label="From" {...sizes} {...min} />
        <NumberField label="To" {...sizes} {...max} />
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
  const jitter = useLen(doc, 'Change the jitter', 'jitter', (x) => x.jitter, (x, v) => ({ ...x, jitter: v }));
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
        {...lenOf(d, LIMIT.jitter)}
        disabled={scatter}
        {...jitter}
      />
    </InspectorGroup>
  );
}
