// The Halftone board's measures (spec §2): coverage per ink and the most ink anywhere, and the inks
// under the pointer. Props only: the tool measures, these show.
import { cssColor, type Oklch } from '../../../shared/color/index.ts';
import { cx } from '../../ui/cx.ts';
import { InspectorGroup, Tooltip } from '../../ui/index.ts';
import s from './Meters.module.css';

/** one ink's plate, coverage 0..1; null while it is measured */
export type InkCoverage = { id: string; label: string; colour: Oklch; mean: number | null; peak: number | null; hidden?: boolean };
/** coverage 0..1 at a point; a spot ink leads with its colour (a digit would run into the number) */
export type InkValue = { label: string; value: number; colour?: Oklch };

const pct = (v: number) => Math.round(v * 100);

/**
 * The Coverage module: per ink the mean (the bar) inside the peak (behind it), and in the header
 * the largest sum of inks at any point (`maxInk` 0..number of inks), which a press limits.
 */
export function Meters({ inks, maxInk }: { inks: InkCoverage[]; maxInk: number | null }) {
  return (
    <InspectorGroup id="halftone.coverage" title="Coverage" sub="Mean / peak" meta={maxInk === null ? undefined : `Max ink ${pct(maxInk)}%`}>
      <div className={s.list}>
        {inks.map((k) => (
          <div key={k.id} className={cx(s.row, k.hidden && s.hidden)}>
            <i className={s.chip} data-colour style={{ background: cssColor(k.colour) }} />
            <Tooltip content={k.label} overflowOnly>
              <span className={s.label}>{k.label}</span>
            </Tooltip>
            <span className={s.bar} aria-hidden>
              {k.peak !== null && <i className={s.peak} style={{ width: `${pct(k.peak)}%` }} />}
              {k.mean !== null && <i className={s.mean} style={{ width: `${pct(k.mean)}%` }} />}
            </span>
            <span className={s.value}>{k.mean === null || k.peak === null ? '–' : `${pct(k.mean)} / ${pct(k.peak)}`}</span>
          </div>
        ))}
      </div>
    </InspectorGroup>
  );
}

/** from the pointer to the readout's corner, as on the board; it flips to stay in the view */
const OFFSET = { x: 20, y: 19 };
const ROOM = { key: 40, h: 26, pad: 30 };

/**
 * The inks under the pointer (C 13 M 80 Y 85 K 25 %), beside it: for a Viewport's `probe`, which
 * gives `at` in view px and the view's size.
 */
export function InkProbe({ at, inks, view }: { at: { x: number; y: number }; inks: InkValue[]; view: { width: number; height: number } }) {
  const left = at.x + OFFSET.x + inks.length * ROOM.key + ROOM.pad > view.width;
  const up = at.y + OFFSET.y + ROOM.h > view.height;
  const x = left ? `calc(-100% - ${OFFSET.x}px)` : `${OFFSET.x}px`;
  const y = up ? `calc(-100% - ${OFFSET.y}px)` : `${OFFSET.y}px`;
  return (
    <div className={s.probe} style={{ left: at.x, top: at.y, transform: `translate(${x}, ${y})` }}>
      {inks.map((k, i) =>
        k.colour ? (
          <span key={i} className={s.entry} aria-label={`${k.label} ${pct(k.value)}%`}>
            <i className={s.probeChip} data-colour style={{ background: cssColor(k.colour) }} />
            {pct(k.value)}
          </span>
        ) : (
          <span key={i}>
            <span className={s.key}>{k.label}</span>
            {pct(k.value)}
          </span>
        ),
      )}
      <span className={s.key}>%</span>
    </div>
  );
}
