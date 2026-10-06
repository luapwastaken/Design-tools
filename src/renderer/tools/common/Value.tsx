import type { CSSProperties } from 'react';
import { cssColor, type Oklch } from '../../../shared/color/index.ts';
import { greyOf, valueOf } from '../../../shared/color/value.ts';
import type { ValueCollision } from '../../../shared/palette/checks.ts';
import type { Swatch } from '../../../shared/types.ts';
import { Button, Icon, Module, NumberField, Ticks, Tooltip } from '../../ui/index.ts';
import { cx } from '../../ui/cx.ts';
import { spreadCluster, type FixRules } from './adjust.ts';
import { displayName, fmtV, listNames, plural } from './names.ts';
import { useWidth } from './useWidth.ts';
import s from './Checks.module.css';

/** hovering or focusing a check's row lights its swatches where the tool shows them */
export type PointAt = (ids: string[]) => { onPointerEnter(): void; onPointerLeave(): void; onFocus(): void; onBlur(): void };

/** what the Value and Colour vision checks need from the tool that shows them */
export type CheckHost = {
  swatches: Swatch[];
  /** one history step: new colours by swatch id */
  onFix(label: string, changes: Record<string, Oklch>): void;
  pointAt: PointAt;
  /** which colours a one-click fix may not move, which move first, and what it must not break */
  rules?: FixRules;
  className?: string;
};

const pct = (l: number) => `${Math.min(1, Math.max(0, l)) * 100}%`;
const clamp01 = (l: number) => Math.min(1, Math.max(0, l));
const LANE = 13;
/** 10px Plex Mono: 0.6em advance plus the pin's letter spacing */
const CHAR = 7.2;
/** a pin shows this much of a long name; its tooltip has all of it */
const NAME_CHARS = 10;
const cut = (name: string) => (name.length > NAME_CHARS ? `${name.slice(0, NAME_CHARS - 1)}…` : name);
const label = (w: Swatch) => `${cut(displayName(w))} ${fmtV(w.oklch)}`;

/**
 * Pin labels in up to three lanes, each in the first lane where it clears the one before; near an
 * edge a label hangs inwards from its stem instead of centring on it. A label with no lane to
 * spare is left off (a bare stem) rather than printed over another; its tooltip names it.
 */
function laneOut(list: Swatch[], width: number) {
  const ends = [-Infinity, -Infinity, -Infinity];
  const at = list.map((w) => {
    const x = clamp01(valueOf(w.oklch)) * width;
    const wide = label(w).length * CHAR;
    const align: 'start' | 'centre' | 'end' = x - wide / 2 < 0 ? 'start' : x + wide / 2 > width ? 'end' : 'centre';
    const left = align === 'start' ? x : align === 'end' ? x - wide : x - wide / 2;
    const lane = ends.findIndex((e) => left >= e + 12);
    if (lane >= 0) ends[lane] = left + wide;
    return { lane: lane >= 0 ? lane : null, align };
  });
  return { at, count: Math.max(1, ...at.map((a) => (a.lane ?? 0) + 1)) };
}
// the value ramp is a measurement scale, drawn from the colour module like any content colour
const RAMP = `linear-gradient(90deg in oklab, ${cssColor([0, 0, 0])}, ${cssColor([1, 0, 0])})`;

/** the runs of swatches that chain together through collisions: each reads as one grey (lightest first), the worst run first */
export function clustersOf(collisions: ValueCollision[]): Swatch[][] {
  const runs: Map<string, Swatch>[] = [];
  for (const c of collisions) {
    const hit = runs.filter((r) => r.has(c.a.id) || r.has(c.b.id));
    const [into, ...rest] = hit.length ? hit : [new Map<string, Swatch>()];
    for (const w of [c.a, c.b]) into.set(w.id, w);
    for (const r of rest) {
      r.forEach((w, id) => into.set(id, w));
      runs.splice(runs.indexOf(r), 1);
    }
    if (!hit.length) runs.push(into);
  }
  return runs.map((r) => [...r.values()].sort((a, b) => valueOf(a.oklch) - valueOf(b.oklch)));
}

/** the swatches that chain into the worst collision: together they read as one grey (lightest last) */
const clusterOf = (collisions: ValueCollision[]): Swatch[] => clustersOf(collisions).find((r) => r.some((w) => w.id === collisions[0].a.id)) ?? [];

type ValueProps = CheckHost & {
  collisions: ValueCollision[];
  /** the flag gap, in value units (0..100) */
  flagL: number;
  onFlagL(v: number): void;
  /** what the scale compares, when it isn't every swatch */
  sub?: string;
};

/** The palette in greyscale by value (what greyscale shows) on a ruler; the worst run that reads as one grey is flagged. */
export function Value({ swatches, onFix, pointAt, rules, className, collisions, flagL, onFlagL, sub }: ValueProps) {
  const byV = [...swatches].sort((a, b) => valueOf(a.oklch) - valueOf(b.oklch));
  const hit = new Set(collisions.flatMap((c) => [c.a.id, c.b.id]));
  const { ref: ruler, width } = useWidth<HTMLDivElement>();
  const lanes = laneOut(byV, width);
  const cluster = collisions.length ? clusterOf(collisions) : [];
  const ids = new Set(cluster.map((w) => w.id));
  const elsewhere = collisions.filter((c) => !ids.has(c.a.id) || !ids.has(c.b.id)).length;
  const gap = flagL + 0.5;
  // value runs 0 to 100: past a point a run can't all stand apart, only spread as evenly as it goes
  const fits = (cluster.length - 1) * gap <= 100;

  // a locked colour stays, the supporting colours move before the brand ones, and no contrast pair that passes breaks
  const others = swatches.filter((w) => !ids.has(w.id)).map((w) => valueOf(w.oklch));
  const spread = cluster.length ? spreadCluster(cluster, flagL / 100, others, rules) : { changes: null, blocked: false };
  const fix = () => {
    if (!spread.changes) return;
    const names = cluster.map(displayName);
    onFix(cluster.length === 2 ? `Spread ${names[0]} and ${names[1]} in value` : `Spread ${cluster.length} swatches in value`, spread.changes);
  };

  return (
    <Module
      title="Value"
      sub={sub ? `${sub} · Rec. 709 luma` : 'Rec. 709 luma'}
      readout={swatches.length > 1 ? (collisions.length ? plural(collisions.length, 'collision') : 'No collisions') : undefined}
      actions={
        <>
          <NumberField label="Flag <" value={flagL} min={1} max={20} step={0.5} precision={1} unit="ΔV" size="sm" width={112} onChange={onFlagL} />
        </>
      }
      scroll
      className={className}
    >
      {byV.length === 0 ? (
        <p className={s.none}>The palette's values show here, in greyscale.</p>
      ) : (
        <>
          <div className={s.vstrip}>
            {byV.map((w) => (
              <Tooltip key={w.id} content={displayName(w)}>
                <i data-colour style={{ background: cssColor(w.oklch) }} {...pointAt([w.id])} />
              </Tooltip>
            ))}
          </div>
          <div className={s.vstrip}>
            {byV.map((w) => (
              <i key={w.id} style={{ background: cssColor(greyOf(valueOf(w.oklch))) }} {...pointAt([w.id])} />
            ))}
          </div>
          <div ref={ruler} className={s.vscale} style={{ '--ramp': `${lanes.count * LANE + 8}px` } as CSSProperties}>
            {byV.map((w, i) => {
              const { lane, align } = lanes.at[i];
              const top = lane === null ? lanes.count * LANE : lane * LANE;
              return (
                <Tooltip key={w.id} content={`${displayName(w)} · V ${fmtV(w.oklch)}`}>
                  <span
                    className={cx(s.pin, align === 'start' && s.rgt, align === 'end' && s.lft, lane === null && s.bare, hit.has(w.id) && s.warn)}
                    style={{ left: pct(valueOf(w.oklch)), top, '--stem': `${lane === null ? 8 : (lanes.count - lane) * LANE - 4}px` } as CSSProperties}
                    {...pointAt([w.id])}
                  >
                    {lane !== null && <span className={s.pl}>{label(w)}</span>}
                    <i className={s.stem} />
                  </span>
                </Tooltip>
              );
            })}
            <i className={s.vramp} style={{ backgroundImage: RAMP }} />
            {collisions.map((c) => (
              <i key={`${c.a.id}:${c.b.id}`} className={s.vbracket} style={{ left: pct(Math.min(valueOf(c.a.oklch), valueOf(c.b.oklch))), width: pct(c.deltaV) }} />
            ))}
            <span className={s.vticks}>
              <Ticks />
            </span>
            {[0, 20, 40, 60, 80, 100].map((n) => (
              <span key={n} className={s.vnum} style={{ left: `${n}%`, transform: n === 0 ? 'none' : n === 100 ? 'translateX(-100%)' : undefined }}>
                {n}
              </span>
            ))}
          </div>
          {/* one flag, however many collide: the worst run, and how many more wait after it */}
          {cluster.length > 0 && (
            <div className={cx(s.flag, s.bad)} {...pointAt(cluster.map((w) => w.id))}>
              <Icon name="error" size={16} />
              <span className={s.flagText}>
                <Run list={cluster} />
                {cluster.length === 2 ? ` sit ${(Math.abs(valueOf(cluster[1].oklch) - valueOf(cluster[0].oklch)) * 100).toFixed(1)} apart and read as one value.` : ' read as one value.'}
                {!fits && ` ${cluster.length} colours can't all stand ${flagL.toFixed(1)} apart; spread evenly they sit ${(100 / (cluster.length - 1)).toFixed(1)} apart.`}
                {elsewhere > 0 && ` ${plural(elsewhere, 'other pair')} collide${elsewhere === 1 ? 's' : ''} too.`}
              </span>
              <Button
                size="xs"
                onClick={fix}
                disabled={!spread.changes}
                tooltip={
                  spread.blocked
                    ? 'Every one of them is locked. Press L on one to let it move.'
                    : !spread.changes
                      ? 'No spread keeps the locked colours and the passing contrast pairs. Change a hue.'
                      : fits
                        ? `Space them ${gap.toFixed(1)} apart in value, order and hues kept. Locked colours stay.`
                        : 'Space them evenly from black to white, order and hues kept'
                }
              >
                {!fits ? 'Spread evenly' : cluster.length === 2 ? 'Spread apart' : `Spread these ${cluster.length}`}
              </Button>
            </div>
          )}
        </>
      )}
    </Module>
  );
}

/** "Moss 48.7 and Iron 54.1", "G1 50.0, G2 52.0 and 3 more" */
function Run({ list }: { list: Swatch[] }) {
  const shown = list.length > 4 ? list.slice(0, 3) : list;
  const parts = shown.map((w) => `${displayName(w)} ${fmtV(w.oklch)}`);
  const more = list.length - shown.length;
  const text = more ? `${parts.join(', ')} and ${more} more` : listNames(parts);
  return <b>{text}</b>;
}
