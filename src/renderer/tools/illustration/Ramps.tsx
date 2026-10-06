// The Selected ramp section (top right): the selected ramp's steps as big labelled tiles. A click
// selects a step (and loads the brush in Paint); the Colour picker edits it. Show, Surround and the
// lens are in Ramp settings; Regenerate is here.
import { useSyncExternalStore, type CSSProperties, type KeyboardEvent } from 'react';
import { cssColor, toHex } from '../../../shared/color/index.ts';
import { greyOf, valueOf } from '../../../shared/color/value.ts';
import type { Swatch } from '../../../shared/types.ts';
import { cx } from '../../ui/cx.ts';
import { Button, EmptyState, Tooltip } from '../../ui/index.ts';
import { fmtV, plural, stepWord } from '../common/names.ts';
import { Section } from '../common/Section.tsx';
import { surroundOf } from '../common/surround.ts';
import { move, select, selected, type Doc } from './actions.ts';
import { brokenSteps, looseOf, nameOf, rampName, revertRamp, rampOf, stepsOf, wordOf, type IllustrationDoc } from './doc.ts';
import { proofOf } from './proof.ts';
import { clicked, hot, type IllustrationView } from './view-state.ts';
import s from './Ramps.module.css';

const ARROWS: Record<string, [number, number]> = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] };
const cap = (t: string) => t.charAt(0).toUpperCase() + t.slice(1);

export function SelectedRamp({ doc, d, v }: { doc: Doc; d: IllustrationDoc; v: IllustrationView }) {
  const lit = useSyncExternalStore(hot.subscribe, hot.get);
  const sel = selected(d, v.selected);
  const r = rampOf(d, sel?.group);
  const loose = looseOf(d);
  const looseOn = !r && !!sel && loose.some((w) => w.id === sel.id);
  const list = r ? stepsOf(d, r.id) : looseOn ? loose : [];
  const steps = list.map((w) => w.step ?? 0);
  const [lo, hi] = [Math.min(0, ...steps), Math.max(0, ...steps)];
  const broken = new Set(r ? brokenSteps(list) : []);
  const edited = list.filter((w) => w.edited).length;
  const name = r ? rampName(d, r) : 'Loose colours';
  const surround = surroundOf(v.board, d.swatches);
  const plain = v.board === 'plain';

  const onKeyDown = (e: KeyboardEvent) => {
    // on a step, up and down go to the next ramp as well (left and right also work from anywhere: the tool's shortcuts)
    const by = ARROWS[e.key];
    if (!by || !(e.target as Element).closest('[data-step]')) return;
    e.preventDefault();
    move(doc, by[0], by[1]);
  };

  return (
    <Section
      title={list.length ? name : 'Selected ramp'}
      sub={
        list.length ? (
          <>
            <Tooltip content={`${plural(edited, 'step')} edited by hand: the ramp leaves ${edited === 1 ? 'it' : 'them'} when it changes`} disabled={!edited}>
              <span>
                {plural(list.length, 'step')}
                {edited ? ` · ${edited} edited` : ''}
              </span>
            </Tooltip>
            {' · click a step to edit it'}
          </>
        ) : undefined
      }
      className={s.selected}
      actions={
        r && (
          <Button size="xs" variant="ghost" icon="restart_alt" disabled={!edited} onClick={() => doc.transact(`Regenerate ${name}`, (x) => revertRamp(x, r.id))} tooltip="Every hand-edited step goes back to what the ramp makes">
            {edited ? `Regenerate (${edited} edited)` : 'Regenerate'}
          </Button>
        )
      }
    >
      {!list.length ? (
        <EmptyState icon="layers" title="No ramp yet" detail="Add a base colour, and its steps show here, from highlight to deep shadow." className={s.none} />
      ) : (
        <div className={cx(s.steps, !plain && s.mat)} style={{ '--cols': list.length, '--surround': surround } as CSSProperties} role="listbox" aria-label="Swatch board" onKeyDown={onKeyDown}>
          {list.map((w) => (
            <Step key={w.id} d={d} v={v} w={w} word={r ? cap(stepWord(w.step ?? 0, lo, hi)) : null} on={sel?.id === w.id} lit={lit.includes(w.id)} broken={broken.has(w.id)} plain={plain} />
          ))}
        </div>
      )}
    </Section>
  );
}

type StepProps = { d: IllustrationDoc; v: IllustrationView; w: Swatch; word: string | null; on: boolean; lit: boolean; broken: boolean; plain: boolean };

/** one step: the colour big, then its word and hex; the neutral ring marks the selected one */
function Step({ d, v, w, word, on, lit, broken, plain }: StepProps) {
  const hex = toHex(w.oklch).toUpperCase();
  const named = w.name.trim() ? wordOf(d, w) : null;
  const tip = `${nameOf(d, w)}${named ? ` · ${named}` : ''} · ${hex} · V ${fmtV(w.oklch)}${w.edited ? ' · edited by hand' : ''}`;
  const seen = proofOf(w.oklch, v.proof);
  const pick = () => {
    select(w.id);
    clicked.set({ id: w.id, at: performance.now() });
  };
  return (
    <Tooltip content={tip}>
      <button
        type="button"
        role="option"
        aria-selected={on}
        aria-label={`${nameOf(d, w)}, ${toHex(w.oklch)}${w.edited ? ', edited' : ''}`}
        data-step={w.id}
        tabIndex={on ? 0 : -1}
        className={cx(s.step, on && s.sel, lit && s.hot, w.edited && s.edited, broken && s.broken, w.step === 0 && s.base, plain && s.plain)}
        onClick={(e) => {
          pick();
          e.currentTarget.focus();
        }}
        onKeyDown={(e) => {
          if (e.key !== 'Enter' && e.key !== ' ') return;
          e.preventDefault();
          pick();
        }}
      >
        <i className={s.colour} data-colour style={{ background: cssColor(seen) }}>
          {w.step === 0 && <b className={s.badge}>Base</b>}
        </i>
        <i className={s.value} style={{ background: cssColor(greyOf(valueOf(w.oklch))) }} />
        {v.show !== 'off' && (
          <span className={s.read}>
            {v.show === 'hex' ? (
              <>
                <span className={s.word}>{word ?? nameOf(d, w)}</span>
                <span className={s.hex}>{hex}</span>
              </>
            ) : (
              <span className={s.word}>{nameOf(d, w)}</span>
            )}
          </span>
        )}
      </button>
    </Tooltip>
  );
}
