// Ramps mode (spec §4): the ramps ARE the artboard. Rows are ramps, columns are steps with their
// words; each swatch is big, on the neutral surround, over its value strip, with its hex and
// lightness. Under the board, the selected ramp's L, C and hue curves (Curves).
import { useSyncExternalStore, type CSSProperties, type KeyboardEvent } from 'react';
import { cssColor, toHex } from '../../../shared/color/index.ts';
import { MATERIALS } from '../../../shared/palette/ramp.ts';
import type { Swatch } from '../../../shared/types.ts';
import { cx } from '../../ui/cx.ts';
import { Icon, Tooltip } from '../../ui/index.ts';
import { fmtL, plural } from '../common/names.ts';
import { surroundOf } from '../common/surround.ts';
import { move, select, selected, type Doc } from './actions.ts';
import { Curves } from './Curves.tsx';
import { brokenSteps, looseOf, nameOf, rampName, stepsOf, wordOf, type IllustrationDoc } from './doc.ts';
import { proofOf } from './proof.ts';
import { RampOptions } from './RampOptions.tsx';
import { clicked, hot, type IllustrationView } from './view-state.ts';
import { stepWord } from '../common/names.ts';
import s from './Ramps.module.css';

const ARROWS: Record<string, [number, number]> = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] };
const cap = (t: string) => t.charAt(0).toUpperCase() + t.slice(1);

/** the step columns every row shares: from the lightest step any ramp has to the darkest */
export function span(d: IllustrationDoc): { lo: number; hi: number } {
  const steps = d.swatches.filter((w) => w.group !== undefined && w.step !== undefined && d.ramps.some((r) => r.id === w.group)).map((w) => w.step!);
  return { lo: Math.min(0, ...steps), hi: Math.max(0, ...steps) };
}

export function Ramps({ doc, d, v }: { doc: Doc; d: IllustrationDoc; v: IllustrationView }) {
  const lit = useSyncExternalStore(hot.subscribe, hot.get);
  const sel = selected(d, v.selected);
  const loose = looseOf(d);
  const { lo, hi } = span(d);
  const cols = hi - lo + 1;
  const surround = surroundOf(v.surround, d.swatches);
  const plain = v.surround === 'plain';
  const grid = { '--cols': cols } as CSSProperties;

  const onKeyDown = (e: KeyboardEvent) => {
    // on a step, up and down go to the next ramp as well (left and right also work from anywhere: the tool's shortcuts)
    const by = ARROWS[e.key];
    if (!by || !(e.target as Element).closest('[data-step]')) return;
    e.preventDefault();
    move(doc, by[0], by[1]);
  };

  return (
    <div className={s.mode}>
      <RampOptions d={d} v={v} />
      <section className={s.board} aria-label="Ramps" style={grid}>
        <div className={s.scroll} role="listbox" aria-label="Swatch board" onKeyDown={onKeyDown}>
          <div className={s.names} aria-hidden="true">
            <span />
            <div className={s.nameCols}>
              {Array.from({ length: cols }, (_, i) => (
                <span key={i}>{cap(stepWord(lo + i, lo, hi))}</span>
              ))}
            </div>
          </div>
          <div className={s.rows}>
            <div className={cx(s.mat, plain && s.plain)} style={{ '--surround': surround } as CSSProperties} />
            {d.ramps.map((r) => {
              const steps = stepsOf(d, r.id);
              const on = sel?.group === r.id;
              const broken = new Set(brokenSteps(steps));
              const material = MATERIALS.find((m) => m.id === r.material)?.label ?? r.material;
              const name = rampName(d, r);
              return (
                <div key={r.id} className={cx(s.row, on && s.on)} role="group" aria-label={`${name} ramp`}>
                  <button type="button" className={s.label} onClick={() => select(steps.find((w) => w.step === 0)?.id ?? steps[0]?.id ?? null)} tabIndex={-1}>
                    <span className={s.rname}>
                      {name}
                      {r.hero && <Icon name="star" size={14} fill className={s.hero} />}
                    </span>
                    <span className={s.rmeta}>
                      {material} · {plural(steps.length, 'step')}
                    </span>
                  </button>
                  <div className={cx(s.cells, plain && s.plain)}>
                    {steps.map((w) => (
                      <Cell key={w.id} d={d} v={v} w={w} col={w.step! - lo + 1} sel={sel?.id === w.id} lit={lit.includes(w.id)} broken={broken.has(w.id)} />
                    ))}
                  </div>
                </div>
              );
            })}
            {loose.length > 0 && (
              <div className={s.row} role="group" aria-label="Colours in no ramp">
                <div className={s.label}>
                  <span className={s.rname}>Loose</span>
                  <span className={s.rmeta}>{plural(loose.length, 'colour')}, in no ramp</span>
                </div>
                <div className={cx(s.cells, plain && s.plain)} style={{ '--cols': Math.max(cols, loose.length) } as CSSProperties}>
                  {loose.map((w, i) => (
                    <Cell key={w.id} d={d} v={v} w={w} col={i + 1} sel={sel?.id === w.id} lit={lit.includes(w.id)} broken={false} />
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
      </section>
      <Curves doc={doc} d={d} v={v} lo={lo} cols={cols} />
    </div>
  );
}

type CellProps = { d: IllustrationDoc; v: IllustrationView; w: Swatch; col: number; sel: boolean; lit: boolean; broken: boolean };

/** one swatch: the colour over its value in greyscale, then what Show says; a click selects (and loads the brush in Paint) */
function Cell({ d, v, w, col, sel, lit, broken }: CellProps) {
  const word = w.name.trim() ? wordOf(d, w) : null;
  const tip = `${nameOf(d, w)}${word ? ` · ${word}` : ''} · ${toHex(w.oklch).toUpperCase()} · L ${fmtL(w.oklch[0])}${w.edited ? ' · edited by hand' : ''}`;
  const seen = proofOf(w.oklch, v.proof);
  return (
    <Tooltip content={tip}>
      <button
        type="button"
        role="option"
        aria-selected={sel}
        aria-label={`${nameOf(d, w)}, ${toHex(w.oklch)}${w.edited ? ', edited' : ''}`}
        data-step={w.id}
        tabIndex={sel ? 0 : -1}
        className={cx(s.cell, sel && s.sel, lit && s.hot, w.edited && s.edited, broken && s.broken, w.step === 0 && s.base)}
        style={{ gridColumn: col }}
        onClick={(e) => {
          select(w.id);
          clicked.set({ id: w.id, at: performance.now() });
          e.currentTarget.focus();
        }}
        onKeyDown={(e) => {
          if (e.key !== 'Enter' && e.key !== ' ') return;
          e.preventDefault();
          select(w.id);
          clicked.set({ id: w.id, at: performance.now() });
        }}
      >
        <i className={s.colour} style={{ background: cssColor(seen) }}>
          {w.step === 0 && <b className={s.badge}>Base</b>}
        </i>
        <i className={s.value} style={{ background: cssColor([w.oklch[0], 0, 0]) }} />
        {v.show !== 'off' && (
          <span className={s.read}>
            {v.show === 'hex' ? (
              <>
                <span>{toHex(w.oklch).toUpperCase()}</span>
                <span>L {Math.round(w.oklch[0] * 100)}</span>
              </>
            ) : (
              <span className={s.nm}>{nameOf(d, w)}</span>
            )}
          </span>
        )}
      </button>
    </Tooltip>
  );
}
