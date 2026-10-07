// In context (plan unit X): the palette on a small website, a light and a dark version side by
// side. A palette is built for ONE ground: that half is graded (every text-on-fill pair, by the
// shared grade) and counted; the other half is the same colours derived onto the opposite ground, a
// picture only, labelled so and never counted. Pure presentation; which colour plays which part is
// decided in context-slots.ts.
import { createContext, memo, useContext, useMemo, useRef, type CSSProperties } from 'react';
import { cssColor } from '../../../shared/color/index.ts';
import type { Swatch } from '../../../shared/types.ts';
import { Icon, Module, Tooltip } from '../../ui/index.ts';
import { cx } from '../../ui/cx.ts';
import { describe, ownMode, scene, type Pair, type Scene, type Slot, type Status } from './context-slots.ts';
import s from './InContext.module.css';

const ORDERS: { name: string; meta: string; status: Status; label: string }[] = [
  { name: 'Tour poster', meta: 'A3 · 2 inks · 150', status: 'success', label: 'Printed' },
  { name: 'Zine covers', meta: 'A5 · 3 inks · 400', status: 'warning', label: 'Drying' },
  { name: 'Postcards', meta: 'A6 · 1 ink · 1,000', status: 'error', label: 'On hold' },
];
/** each day as a share of the busiest */
const WEEK = [38, 62, 45, 80, 71, 100, 54];
const DAYS = ['M', 'T', 'W', 'T', 'F', 'S', 'S'];

const css = (x: Slot) => cssColor(x.oklch);

/** a failing marker selects the swatch it is about (the artboard's, in Design) */
const PickSwatch = createContext<((id: string) => void) | null>(null);
/** false on the half that is not the palette's own ground: it grades nothing, so it marks nothing */
const Graded = createContext(true);

/** `hidden`: behind the Checks switch, it keeps the last scenes it drew rather than work out new ones unseen */
export const InContext = memo(function InContext({ swatches, hidden = false, onSelect }: { swatches: Swatch[]; hidden?: boolean; onSelect?(id: string): void }) {
  const last = useRef<[Scene | null, Scene | null] | null>(null);
  const [light, dark] = useMemo(
    () => (hidden && last.current ? last.current : (last.current = [scene(swatches, 'light'), scene(swatches, 'dark')])),
    [swatches, hidden],
  );
  // no colours: the tool keeps Preview shut (Build shows), so there is nothing to say here
  if (!light || !dark) return null;
  const own = ownMode(swatches);
  return (
    <PickSwatch.Provider value={onSelect ?? null}>
      <div className={s.root}>
        <div className={s.pair}>
          <Frame scene={light} own={own === 'light'} />
          <Frame scene={dark} own={own === 'dark'} />
        </div>
      </div>
    </PickSwatch.Provider>
  );
});

export const DERIVED = 'Derived from your colours, not built for this ground';

function Frame({ scene: sc, own }: { scene: Scene; own: boolean }) {
  const pairs = Object.values(sc.pairs);
  const failing = pairs.filter((p) => !p.ok);
  const title = sc.mode === 'light' ? 'Light' : 'Dark';
  const readout = !own ? (
    'PREVIEW ONLY'
  ) : failing.length ? (
    <>
      <span className={s.fail}>{failing.length} FAIL</span> · {pairs.length} PAIRS
    </>
  ) : (
    `${pairs.length} PAIRS PASS`
  );
  // the page is a picture to sighted users; the failures are its words for everyone else
  const label = `${title} website preview. ${!own ? `${DERIVED}.` : failing.length ? failing.map(describe).join(' ') : 'Every text colour reads on its fill.'}`;
  return (
    <Module title={title} sub={own ? `${sc.page.name} page · ${sc.text.name} text` : 'derived, not graded'} readout={readout} scroll className={s.frame}>
      {!own && (
        <p className={s.derived} data-derived="">
          <Icon name="info" size={16} />
          {DERIVED}. Not counted in the checks.
        </p>
      )}
      <Graded.Provider value={own}>
        <div className={s.fit}>
          <Site sc={sc} label={label} />
        </div>
      </Graded.Provider>
    </Module>
  );
}

function Site({ sc, label }: { sc: Scene; label: string }) {
  const p = sc.pairs;
  const vars = {
    '--pg': css(sc.page),
    '--sf': css(sc.surface),
    '--ln': css(sc.line),
    '--tx': css(sc.text),
    '--mu': css(sc.muted),
    '--pr': css(sc.primary),
    '--on-pr': css(sc.onPrimary),
    '--lk': css(sc.link),
    '--ac': css(sc.accent),
    '--hl': css(sc.highlight),
    '--on-hl': css(sc.onHighlight),
  } as CSSProperties;
  return (
    <div className={s.site} data-colour style={vars} role="img" aria-label={label}>
      <div className={s.nav}>
        <span className={s.brand}>
          <i className={s.logo} />
          Loam Press
          <Flag pair={p.text} inline />
        </span>
        <span className={s.links}>
          <span className={s.here}>Prints</span>
          <span>Inks</span>
          <span>Studio</span>
        </span>
        <span className={s.signin}>
          Sign in
          <Flag pair={p.link} inline />
        </span>
      </div>

      <div className={s.hero}>
        <p className={s.h1}>
          Small runs,
          <br />
          <span className={s.mark}>
            printed by hand.
            <Flag pair={p.mark} />
          </span>
        </p>
        <p className={s.lede}>
          Riso and letterpress for artists, bands and small brands. Send a file, choose your inks, and collect the prints
          next week.
          <Flag pair={p.muted} inline />
        </p>
        <div className={s.ctas}>
          <span className={s.primary}>
            Start an order
            <Flag pair={p.button} />
          </span>
          <span className={s.secondary}>
            See the inks
            <Flag pair={p.accent} />
          </span>
        </div>
      </div>

      <div className={s.cards}>
        <div className={s.card}>
          <div className={s.cardHead}>
            <span className={s.cardTitle}>
              Orders
              <Flag pair={p.cardTitle} inline />
            </span>
            <span className={s.meta}>
              3 open
              <Flag pair={p.cardMeta} inline />
            </span>
          </div>
          {ORDERS.map((o) => (
            <div key={o.name} className={s.order}>
              <span className={s.orderName}>
                {o.name}
                <span className={s.meta}>{o.meta}</span>
              </span>
              <Pill sc={sc} status={o.status} label={o.label} />
            </div>
          ))}
        </div>
        <div className={s.card}>
          <div className={s.cardHead}>
            <span className={s.cardTitle}>Prints this week</span>
            <span className={s.total}>1,240</span>
          </div>
          <div className={s.chart}>
            {WEEK.map((h, i) => (
              <i key={i} style={{ height: `${h}%` }}>
                {h === 100 && <Flag pair={p.bars} />}
              </i>
            ))}
          </div>
          <div className={s.days}>
            {DAYS.map((d, i) => (
              <span key={i}>{d}</span>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

/** A status pill. One the palette had no colour for is marked as made, so the page never claims a colour the brand doesn't own. */
function Pill({ sc, status, label }: { sc: Scene; status: Status; label: string }) {
  const { fill, ink } = sc.status[status];
  const pill = (
    <span className={cx(s.pill, !fill.swatchId && s.made)} style={{ background: css(fill), color: css(ink) }}>
      {label}
      <Flag pair={sc.pairs[status]} />
    </span>
  );
  // a failing pill's flag has its own tooltip, which names the made colour too
  if (fill.swatchId || !sc.pairs[status].ok) return pill;
  return <Tooltip content={`${fill.name}: the palette has no colour near this status's usual hue, so one is made for the preview.`}>{pill}</Tooltip>;
}

/**
 * A failing pair's marker, on the corner of the box it failed on, or `inline` after a run of text so
 * it covers none of it; hover says by how much.
 */
function Flag({ pair, inline }: { pair: Pair; inline?: boolean }) {
  const pick = useContext(PickSwatch);
  const graded = useContext(Graded);
  if (pair.ok || !graded) return null;
  const id = pair.fg.swatchId ?? pair.bg.swatchId;
  const go = pick && id ? () => pick(id) : undefined;
  return (
    <Tooltip content={go ? `${describe(pair)} Click to select ${pair.fg.swatchId ? pair.fg.name : pair.bg.name}.` : describe(pair)}>
      <span
        className={cx(inline ? s.flagInline : s.flag, go && s.pickable)}
        role={go ? 'button' : undefined}
        tabIndex={go ? 0 : undefined}
        onClick={go}
        onKeyDown={go && ((e) => e.key === 'Enter' && go())}
      >
        <Icon name="priority_high" size={14} />
      </span>
    </Tooltip>
  );
}
