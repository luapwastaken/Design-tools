// The layout modules (spec §3): Arrangement, Spacing and size, Rotation and jitter. Every value is
// typable and each change is one history step; fix() keeps the tile from collapsing.
import type { Tile } from '../../../shared/pattern/types.ts';
import { IconButton, Module, NumberField, Segmented, Slider, useDocNumber } from '../../ui/index.ts';
import { cx } from '../../ui/cx.ts';
import { fmtPx } from '../common/names.ts';
import { reseed, type Doc } from './actions.ts';
import { fix, gapMin, LIMIT, type Arrangement, type PatternDoc } from './doc.ts';
import s from './Inspector.module.css';

const ARRANGEMENTS: { value: Arrangement; label: string; describe: string }[] = [
  { value: 'grid', label: 'Grid', describe: 'Rows and columns, every cell in line.' },
  { value: 'halfdrop', label: 'Half-drop', describe: 'Every other column drops by half a cell.' },
  { value: 'brick', label: 'Brick', describe: 'Every other row shifts by half a cell.' },
  { value: 'scatter', label: 'Scatter', describe: 'Spread evenly at random, never overlapping, seamless across the edges.' },
];

type Get = (d: PatternDoc) => number;
type Set = (d: PatternDoc, v: number) => PatternDoc;

/** a number in the document; the result always passes fix() */
const useNum = (doc: Doc, label: string, key: string, get: Get, set: Set) => useDocNumber(doc, { label, key, get, set: (d, v) => fix(set(d, v)) });

export function ArrangementModule({ doc, d, tile }: { doc: Doc; d: PatternDoc; tile: Tile }) {
  const cols = useNum(doc, 'Change the columns', 'cols', (x) => x.cols, (x, v) => ({ ...x, cols: v }));
  const rows = useNum(doc, 'Change the rows', 'rows', (x) => x.rows, (x, v) => ({ ...x, rows: v }));
  const seed = useNum(doc, 'Change the seed', 'seed', (x) => x.seed, (x, v) => ({ ...x, seed: v }));
  const a = ARRANGEMENTS.find((x) => x.value === d.arrangement)!;
  const spots = d.cols * d.rows;
  const scatter = d.arrangement === 'scatter';
  // an odd count can't alternate across the seam, so layout doubles the tile that way
  const doubled = d.arrangement === 'halfdrop' && d.cols % 2 ? 'columns' : d.arrangement === 'brick' && d.rows % 2 ? 'rows' : null;
  const note = scatter
    ? tile.items.length < spots
      ? `${tile.items.length} of ${spots} spots found room; the rest stay empty so nothing overlaps. Reseed for another draw.`
      : `${spots} spots spread over a ${d.cols} × ${d.rows} cell tile.`
    : doubled
      ? `An odd number of ${doubled}: the tile holds twice as many, so the offset repeats cleanly.`
      : null;
  return (
    <Module title="Arrangement" readout={fmtPx(Math.round(tile.width), Math.round(tile.height))}>
      <div className={s.stack}>
        <Segmented options={ARRANGEMENTS} value={d.arrangement} onChange={(arrangement) => doc.transact(`Arrange as ${ARRANGEMENTS.find((x) => x.value === arrangement)!.label.toLowerCase()}`, (x) => ({ ...x, arrangement }))} />
        <p className={s.describe}>{a.describe}</p>
        <div className={s.pair}>
          <NumberField label={scatter ? 'Across' : 'Columns'} min={LIMIT.count[0]} max={LIMIT.count[1]} {...cols} />
          <NumberField label={scatter ? 'Down' : 'Rows'} min={LIMIT.count[0]} max={LIMIT.count[1]} {...rows} />
        </div>
        {note && <p className={s.note}>{note}</p>}
        <div className={s.row}>
          <NumberField label="Seed" min={LIMIT.seed[0]} max={LIMIT.seed[1]} className={s.grow} {...seed} />
          <IconButton icon="casino" label="Reseed: a new draw of shapes, sizes and turns" shortcut="R" onClick={() => reseed(doc)} />
        </div>
      </div>
    </Module>
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
    <Module title="Spacing and size" readout={scatter ? undefined : `Pitch ${fmtPx(Math.round(across), Math.round(down))}`}>
      <div className={s.stack}>
        <div className={s.group}>
          {scatter ? (
            <Slider label="Gap" min={0} max={LIMIT.gapMax} unit="px" {...gap} />
          ) : (
            <>
              <Slider label="Gap across" min={gapMin(d)} max={LIMIT.gapMax} origin={0} unit="px" {...gapX} />
              <Slider label="Gap down" min={gapMin(d)} max={LIMIT.gapMax} origin={0} unit="px" {...gapY} />
            </>
          )}
          <p className={s.note}>
            {scatter ? 'The least room between the circles round any two shapes, so no two touch at any turn.' : 'The same gap runs across the tile edge, so the repeat keeps its rhythm. Below 0 the shapes overlap.'}
          </p>
        </div>
        <div className={s.group}>
          <Slider label="Size from" min={LIMIT.size[0]} max={LIMIT.size[1]} unit="px" {...min} />
          <Slider label="Size to" min={LIMIT.size[0]} max={LIMIT.size[1]} unit="px" {...max} />
          <p className={s.note}>Each shape’s longest side, measured on its artwork. Each item draws its own size in this range.</p>
        </div>
      </div>
    </Module>
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
    <Module title="Rotation and jitter">
      <div className={s.stack}>
        <Segmented label="Rotation" options={TURNS} value={r.mode} onChange={(mode) => doc.transact(mode === 'fixed' ? 'Turn every shape alike' : 'Turn each shape at random', (x) => ({ ...x, rotation: { ...x.rotation, mode } }))} />
        {r.mode === 'fixed' ? (
          <Slider label="Angle" min={LIMIT.angle[0]} max={LIMIT.angle[1]} origin={0} unit="°" {...angle} />
        ) : (
          <div className={s.group}>
            <Slider label="Turn from" min={LIMIT.angle[0]} max={LIMIT.angle[1]} origin={0} unit="°" {...from} />
            <Slider label="Turn to" min={LIMIT.angle[0]} max={LIMIT.angle[1]} origin={0} unit="°" {...to} />
          </div>
        )}
        <div className={cx(s.group, s.rule)}>
          <Slider label="Jitter" min={LIMIT.jitter[0]} max={LIMIT.jitter[1]} unit="px" disabled={scatter} {...jitter} />
          <p className={s.note}>{scatter ? 'Scatter already places each shape at random, so jitter waits for the other arrangements.' : 'Nudges each shape off its place, up to this far each way.'}</p>
        </div>
      </div>
    </Module>
  );
}
