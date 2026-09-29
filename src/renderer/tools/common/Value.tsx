import type { CSSProperties } from 'react';
import { contrast, cssColor, type Oklch } from '../../../shared/color/index.ts';
import type { ContrastPair, ValueCollision } from '../../../shared/palette/checks.ts';
import type { Swatch } from '../../../shared/types.ts';
import { Button, Icon, Module, NumberField, Ticks, Tooltip } from '../../ui/index.ts';
import { cx } from '../../ui/cx.ts';
import { valueFix } from './adjust.ts';
import { displayName, fmtL, listNames, plural } from './names.ts';
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
  className?: string;
};

const pct = (l: number) => `${Math.min(1, Math.max(0, l)) * 100}%`;
const clamp01 = (l: number) => Math.min(1, Math.max(0, l));
const LANE = 13;
/** 10px Plex Mono: 0.6em advance plus the pin's letter spacing */
const CHAR = 6.2;
/** a pin shows this much of a long name; its tooltip has all of it */
const NAME_CHARS = 10;
const cut = (name: string) => (name.length > NAME_CHARS ? `${name.slice(0, NAME_CHARS - 1)}…` : name);
const label = (w: Swatch) => `${cut(displayName(w))} ${fmtL(w.oklch[0])}`;

/**
 * Pin labels in up to three lanes, each in the first lane where it clears the one before; near an
 * edge a label hangs inwards from its stem instead of centring on it. A label with no lane to
 * spare is left off (a bare stem) rather than printed over another; its tooltip names it.
 */
function laneOut(list: Swatch[], width: number) {
  const ends = [-Infinity, -Infinity, -Infinity];
  const at = list.map((w) => {
    const x = clamp01(w.oklch[0]) * width;
    const wide = label(w).length * CHAR;
    const align: 'start' | 'centre' | 'end' = x - wide / 2 < 0 ? 'start' : x + wide / 2 > width ? 'end' : 'centre';
    const left = align === 'start' ? x : align === 'end' ? x - wide : x - wide / 2;
    const lane = ends.findIndex((e) => left >= e + 8);
    if (lane >= 0) ends[lane] = left + wide;
    return { lane: lane >= 0 ? lane : null, align };
  });
  return { at, count: Math.max(1, ...at.map((a) => (a.lane ?? 0) + 1)) };
}
// the value ramp is a measurement scale, drawn from the colour module like any content colour
const RAMP = `linear-gradient(90deg in oklab, ${cssColor([0, 0, 0])}, ${cssColor([1, 0, 0])})`;

/** the swatches that chain into the worst collision: together they read as one grey (lightest last) */
function clusterOf(collisions: ValueCollision[]): Swatch[] {
  const found = new Map([collisions[0].a, collisions[0].b].map((w) => [w.id, w]));
  for (let grew = true; grew; ) {
    grew = false;
    for (const c of collisions) {
      if (found.has(c.a.id) === found.has(c.b.id)) continue;
      for (const w of [c.a, c.b]) found.set(w.id, w);
      grew = true;
    }
  }
  return [...found.values()].sort((a, b) => a.oklch[0] - b.oklch[0]);
}

type ValueProps = CheckHost & {
  collisions: ValueCollision[];
  /** contrast pairs: a spread that breaks one which passes now isn't offered */
  contrast?: ContrastPair[];
  flagL: number;
  onFlagL(v: number): void;
  /** what the scale compares, when it isn't every swatch */
  sub?: string;
};

/** The palette in greyscale by OKLCH lightness on a ruler; the worst run that reads as one grey is flagged. */
export function Value({ swatches, onFix, pointAt, className, collisions, contrast: pairs = [], flagL, onFlagL, sub }: ValueProps) {
  const byL = [...swatches].sort((a, b) => a.oklch[0] - b.oklch[0]);
  const hit = new Set(collisions.flatMap((c) => [c.a.id, c.b.id]));
  const { ref: ruler, width } = useWidth<HTMLDivElement>();
  const lanes = laneOut(byL, width);
  const cluster = collisions.length ? clusterOf(collisions) : [];
  const ids = new Set(cluster.map((w) => w.id));
  const elsewhere = collisions.filter((c) => !ids.has(c.a.id) || !ids.has(c.b.id)).length;
  const gap = flagL + 0.5;
  // lightness runs 0 to 100: past a point a run can't all stand apart, only spread as evenly as it goes
  const fits = (cluster.length - 1) * gap <= 100;

  const fix = () => {
    const others = swatches.filter((w) => !ids.has(w.id)).map((w) => w.oklch[0]);
    // a spread that breaks a contrast pair which passes now just trades one problem for another
    const passing = pairs.filter((p) => p.ratio >= p.target);
    const ok = (next: Oklch[]) => {
      const moved = new Map(cluster.map((w, i) => [w.id, next[i]]));
      const now = (w: Swatch) => moved.get(w.id) ?? w.oklch;
      return passing.every((p) => contrast(now(p.text), now(p.ground)) >= p.target);
    };
    const next = valueFix(cluster.map((w) => w.oklch), flagL / 100, others, ok);
    const names = cluster.map(displayName);
    onFix(cluster.length === 2 ? `Spread ${names[0]} and ${names[1]} in lightness` : `Spread ${cluster.length} swatches in lightness`, Object.fromEntries(cluster.map((w, i) => [w.id, next[i]])));
  };

  return (
    <Module
      title="Value"
      sub={sub ? `${sub} · OKLCH lightness` : 'OKLCH lightness'}
      readout={swatches.length > 1 ? (collisions.length ? plural(collisions.length, 'collision') : 'No collisions') : undefined}
      actions={
        <NumberField label="Flag <" value={flagL} min={1} max={20} step={0.5} precision={1} unit="ΔL" size="sm" width={112} onChange={onFlagL} />
      }
      scroll
      className={className}
    >
      {byL.length === 0 ? (
        <p className={s.none}>The palette's lightness steps show here, in greyscale.</p>
      ) : (
        <>
          <div className={s.vstrip}>
            {byL.map((w) => (
              <Tooltip key={w.id} content={displayName(w)}>
                <i style={{ background: cssColor(w.oklch) }} {...pointAt([w.id])} />
              </Tooltip>
            ))}
          </div>
          <div className={s.vstrip}>
            {byL.map((w) => (
              <i key={w.id} style={{ background: cssColor([w.oklch[0], 0, 0]) }} {...pointAt([w.id])} />
            ))}
          </div>
          <div ref={ruler} className={s.vscale} style={{ '--ramp': `${lanes.count * LANE + 8}px` } as CSSProperties}>
            {byL.map((w, i) => {
              const { lane, align } = lanes.at[i];
              const top = lane === null ? lanes.count * LANE : lane * LANE;
              return (
                <Tooltip key={w.id} content={`${displayName(w)} · L ${fmtL(w.oklch[0])}`}>
                  <span
                    className={cx(s.pin, align === 'start' && s.rgt, align === 'end' && s.lft, lane === null && s.bare, hit.has(w.id) && s.warn)}
                    style={{ left: pct(w.oklch[0]), top, '--stem': `${lane === null ? 8 : (lanes.count - lane) * LANE - 4}px` } as CSSProperties}
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
              <i key={`${c.a.id}:${c.b.id}`} className={s.vbracket} style={{ left: pct(Math.min(c.a.oklch[0], c.b.oklch[0])), width: pct(c.deltaL) }} />
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
                {cluster.length === 2 ? ` sit ${(Math.abs(cluster[1].oklch[0] - cluster[0].oklch[0]) * 100).toFixed(1)} apart and read as one value.` : ' read as one value.'}
                {!fits && ` ${cluster.length} colours can't all stand ${flagL.toFixed(1)} apart; spread evenly they sit ${(100 / (cluster.length - 1)).toFixed(1)} apart.`}
                {elsewhere > 0 && ` ${plural(elsewhere, 'other pair')} collide${elsewhere === 1 ? 's' : ''} too.`}
              </span>
              <Button size="xs" onClick={fix} tooltip={fits ? `Space them ${gap.toFixed(1)} apart in lightness, order and hues kept` : 'Space them evenly from black to white, order and hues kept'}>
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
  const parts = shown.map((w) => `${displayName(w)} ${fmtL(w.oklch[0])}`);
  const more = list.length - shown.length;
  const text = more ? `${parts.join(', ')} and ${more} more` : listNames(parts);
  return <b>{text}</b>;
}
