import type { KeyboardEvent } from 'react';
import { cssColor, simulateCvd, type Cvd } from '../../../shared/color/index.ts';
import type { CvdClosest } from '../../../shared/palette/checks.ts';
import { Button, Icon, Module, NumberField, Tooltip } from '../../ui/index.ts';
import { cx } from '../../ui/cx.ts';
import { setColours } from './actions.ts';
import { cvdFix } from './adjust.ts';
import type { CheckProps } from './Checks.tsx';
import { displayName } from './doc.ts';
import { VISIONS, type Vision as Kind } from './results.ts';
import { patchView, pointAt } from './view-state.ts';
import s from './Checks.module.css';

const LABEL: Record<Kind, string> = { typical: 'Typical', protan: 'Protan', deutan: 'Deutan', tritan: 'Tritan', achromat: 'Achromat' };
const CVDS = VISIONS.slice(1) as Cvd[];

/** one Tab stop; the arrows move and choose (brief §6) */
function pickByKey(e: KeyboardEvent<HTMLDivElement>, cur: Cvd) {
  const dir = e.key === 'ArrowDown' || e.key === 'ArrowRight' ? 1 : e.key === 'ArrowUp' || e.key === 'ArrowLeft' ? -1 : 0;
  if (!dir) return;
  e.preventDefault();
  const i = (CVDS.indexOf(cur) + dir + CVDS.length) % CVDS.length;
  patchView({ cvd: CVDS[i] });
  (e.currentTarget.children[i] as HTMLElement | undefined)?.focus();
}

const samePair = (x: CvdClosest | null, y: CvdClosest) => !!x && ((x.a.id === y.a.id && x.b.id === y.b.id) || (x.a.id === y.b.id && x.b.id === y.a.id));

/** Protan, deutan, tritan and achromat strips (Machado 2009), with each one's closest pair. */
export function Vision({ doc, d, v, vision }: CheckProps & { vision: Record<Kind, CvdClosest | null> }) {
  const chosen = vision[v.cvd];
  // the same pair flagged under several simulations is one problem with one fix
  const kinds = chosen?.flag ? CVDS.filter((k) => vision[k]?.flag && samePair(vision[k], chosen)) : [];
  const elsewhere = CVDS.filter((k) => k !== v.cvd && vision[k]?.flag);
  // the spread that parts them under each simulation that merges them; null when none does
  const parted = (() => {
    if (!chosen?.flag) return null;
    let a = chosen.a.oklch;
    let b = chosen.b.oklch;
    const others = d.swatches.filter((w) => w !== chosen.a && w !== chosen.b).map((w) => w.oklch[0]);
    for (const k of kinds) [a, b] = cvdFix(a, b, k, v.flagE, others) ?? [a, b];
    return a === chosen.a.oklch && b === chosen.b.oklch ? null : { [chosen.a.id]: a, [chosen.b.id]: b };
  })();
  const fix = () => chosen && parted && setColours(doc, `Part ${displayName(chosen.a)} and ${displayName(chosen.b)}`, parted);
  return (
    <Module
      title="Colour vision"
      sub="Machado 2009"
      actions={<NumberField label="Flag <" value={v.flagE} min={1} max={40} step={0.5} precision={1} unit="ΔE" size="sm" width={112} onChange={(flagE) => patchView({ flagE })} />}
      scroll
      className={s.vision}
    >
      {d.swatches.length < 2 ? (
        <p className={s.none}>With two or more colours, this shows how each colour vision deficiency sees them.</p>
      ) : (
        <>
          <div className={s.cvdNames} style={{ gridTemplateColumns: `repeat(${d.swatches.length}, 1fr)` }}>
            {d.swatches.map((w) => (
              <Tooltip key={w.id} content={displayName(w)} overflowOnly>
                <span>{displayName(w)}</span>
              </Tooltip>
            ))}
          </div>
          <Row kind="typical" d={d} pair={vision.typical} />
          <div role="radiogroup" aria-label="Simulation" onKeyDown={(e) => pickByKey(e, v.cvd)}>
            {CVDS.map((k) => (
              <Row key={k} kind={k} d={d} pair={vision[k]} on={v.cvd === k} onPick={() => patchView({ cvd: k })} />
            ))}
          </div>
          {chosen && (
            <div className={cx(s.flag, chosen.flag && s.bad)} {...pointAt([chosen.a.id, chosen.b.id])}>
              <Icon name={chosen.flag ? 'error' : 'check'} size={16} />
              <span className={s.flagText}>
                {chosen.flag ? (
                  <>
                    <b>
                      {displayName(chosen.a)} and {displayName(chosen.b)}
                    </b>{' '}
                    merge under {kinds.length === 4 ? 'every simulation' : kinds.map((k) => LABEL[k].toLowerCase()).join(', ')}.{' '}
                    {parted ? 'Moving them apart in lightness parts them.' : 'No lightness spread parts them; change one of their hues.'}
                  </>
                ) : (
                  <>
                    Nothing merges under {LABEL[v.cvd].toLowerCase()}: the closest pair is {displayName(chosen.a)} and {displayName(chosen.b)}, ΔE {chosen.deltaE.toFixed(1)}.
                    {elsewhere.length > 0 && ` Flagged under ${elsewhere.map((k) => LABEL[k].toLowerCase()).join(', ')}.`}
                  </>
                )}
              </span>
              {parted && (
                <Button size="xs" onClick={fix} tooltip={`Spread them in lightness until ΔE reaches ${v.flagE.toFixed(1)}`}>
                  Part them
                </Button>
              )}
            </div>
          )}
        </>
      )}
    </Module>
  );
}

function Row({ kind, d, pair, on, onPick }: { kind: Kind; d: CheckProps['d']; pair: CvdClosest | null; on?: boolean; onPick?(): void }) {
  const flagged = kind !== 'typical' && !!pair?.flag;
  const inner = (
    <>
      <span className="lbl">{LABEL[kind]}</span>
      <span className={s.strip} style={{ gridTemplateColumns: `repeat(${d.swatches.length}, 1fr)` }}>
        {d.swatches.map((w) => (
          <i key={w.id} style={{ background: cssColor(kind === 'typical' ? w.oklch : simulateCvd(w.oklch, kind)) }} />
        ))}
      </span>
      <span className={cx(s.rd, flagged && s.worst)}>
        {flagged && <Icon name="error" size={14} className={s.dangerIcon} />}
        {pair && (
          <>
            {/* long names give way at their end; ΔE always shows */}
            <Tooltip content={`${displayName(pair.a)} / ${displayName(pair.b)}`} overflowOnly>
              <span className={s.rdNames}>
                {displayName(pair.a)} / {displayName(pair.b)}
              </span>
            </Tooltip>
            <span>{pair.deltaE.toFixed(1)}</span>
          </>
        )}
      </span>
    </>
  );
  const hover = pair ? pointAt([pair.a.id, pair.b.id]) : {};
  if (!onPick) return <div className={s.cvdRow} {...hover}>{inner}</div>;
  return (
    <button type="button" role="radio" aria-checked={on} tabIndex={on ? 0 : -1} className={cx(s.cvdRow, s.pick, on && s.on)} onClick={onPick} {...hover}>
      {inner}
    </button>
  );
}
