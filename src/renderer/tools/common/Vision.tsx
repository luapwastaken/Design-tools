import type { KeyboardEvent } from 'react';
import { cssColor, simulateCvd, type Cvd } from '../../../shared/color/index.ts';
import type { CvdClosest } from '../../../shared/palette/checks.ts';
import type { Swatch } from '../../../shared/types.ts';
import { Button, Icon, Module, NumberField, Tooltip } from '../../ui/index.ts';
import { cx } from '../../ui/cx.ts';
import { partPair } from './adjust.ts';
import { displayName } from './names.ts';
import type { CheckHost } from './Value.tsx';
import s from './Checks.module.css';

export type Kind = 'typical' | Cvd;
export const VISIONS: Kind[] = ['typical', 'protan', 'deutan', 'tritan', 'achromat'];

const LABEL: Record<Kind, string> = { typical: 'Typical', protan: 'Protan', deutan: 'Deutan', tritan: 'Tritan', achromat: 'Achromat' };
const CVDS = VISIONS.slice(1) as Cvd[];

/** the simulation a check opened on its own shows (and its list line names): this one while it merges a pair, else the first that does */
export const mergingCvd = (vision: Record<Kind, CvdClosest | null>, cvd: Cvd): Cvd => (vision[cvd]?.flag ? cvd : (CVDS.find((k) => vision[k]?.flag) ?? cvd));

/** one Tab stop; the arrows move and choose (brief §6) */
function pickByKey(e: KeyboardEvent<HTMLDivElement>, cur: Cvd, onCvd: (k: Cvd) => void) {
  const dir = e.key === 'ArrowDown' || e.key === 'ArrowRight' ? 1 : e.key === 'ArrowUp' || e.key === 'ArrowLeft' ? -1 : 0;
  if (!dir) return;
  e.preventDefault();
  const i = (CVDS.indexOf(cur) + dir + CVDS.length) % CVDS.length;
  onCvd(CVDS[i]);
  (e.currentTarget.children[i] as HTMLElement | undefined)?.focus();
}

const samePair = (x: CvdClosest | null, y: CvdClosest) => !!x && ((x.a.id === y.a.id && x.b.id === y.b.id) || (x.a.id === y.b.id && x.b.id === y.a.id));

/** Protan, deutan, tritan and achromat strips (Machado 2009), with each one's closest pair. */
type VisionProps = CheckHost & {
  vision: Record<Kind, CvdClosest | null>;
  /** the swatch names over the strips; off when there are too many to read */
  names?: boolean;
  flagE: number;
  onFlagE(v: number): void;
  cvd: Cvd;
  onCvd(k: Cvd): void;
  /** a short name for the rows' pair labels ("Skin 4/5"); sentences keep the full one */
  short?(w: Swatch): string;
  /** the label over each colour's strip (a ramp step's number, say), where the full name would be cut alike; its tooltip has the full name */
  column?(w: Swatch): string;
};

export function Vision({ swatches, onFix, pointAt, rules, className, vision, names = true, flagE, onFlagE, cvd, onCvd, short = displayName, column }: VisionProps) {
  const chosen = vision[cvd];
  // the same pair flagged under several simulations is one problem with one fix
  const kinds = chosen?.flag ? CVDS.filter((k) => vision[k]?.flag && samePair(vision[k], chosen)) : [];
  const elsewhere = CVDS.filter((k) => k !== cvd && vision[k]?.flag);
  // the spread that parts them under each simulation that merges them (a locked colour stays; no passing contrast pair breaks); null when none does
  const { changes: parted, blocked } = chosen?.flag ? partPair(chosen.a, chosen.b, kinds, flagE, swatches, rules) : { changes: null, blocked: false };
  const fix = () => chosen && parted && onFix(`Part ${displayName(chosen.a)} and ${displayName(chosen.b)}`, parted);
  return (
    <Module
      title="Colour vision"
      sub="Machado 2009"
      actions={<NumberField label="Flag <" value={flagE} min={1} max={40} step={0.5} precision={1} unit="ΔE" size="sm" width={112} onChange={onFlagE} />}
      scroll
      className={className}
    >
      {swatches.length < 2 ? (
        <p className={s.none}>With two or more colours, this shows how each colour vision deficiency sees them.</p>
      ) : (
        <>
          {names && (
            <div className={s.cvdNames} style={{ gridTemplateColumns: `repeat(${swatches.length}, 1fr)` }}>
              {swatches.map((w) => (
                <Tooltip key={w.id} content={displayName(w)} overflowOnly={!column}>
                  <span>{column ? column(w) : displayName(w)}</span>
                </Tooltip>
              ))}
            </div>
          )}
          <Row kind="typical" swatches={swatches} pair={vision.typical} pointAt={pointAt} short={short} />
          <div role="radiogroup" aria-label="Simulation" onKeyDown={(e) => pickByKey(e, cvd, onCvd)}>
            {CVDS.map((k) => (
              <Row key={k} kind={k} swatches={swatches} pair={vision[k]} pointAt={pointAt} on={cvd === k} onPick={() => onCvd(k)} short={short} />
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
                    {parted ? 'Moving them apart in value parts them.' : blocked ? 'Both are locked.' : 'No value spread parts them; change one of their hues.'}
                  </>
                ) : (
                  <>
                    Nothing merges under {LABEL[cvd].toLowerCase()}: the closest pair is {displayName(chosen.a)} and {displayName(chosen.b)}, ΔE {chosen.deltaE.toFixed(1)}.
                    {elsewhere.length > 0 && ` Flagged under ${elsewhere.map((k) => LABEL[k].toLowerCase()).join(', ')}.`}
                  </>
                )}
              </span>
              {(parted || blocked) && (
                <Button size="xs" onClick={fix} disabled={blocked} tooltip={blocked ? 'Both are locked. Press L on one to let it move.' : `Spread them in value until ΔE reaches ${flagE.toFixed(1)}. Locked colours stay.`}>
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

type RowProps = { kind: Kind; swatches: Swatch[]; pair: CvdClosest | null; pointAt: CheckHost['pointAt']; on?: boolean; onPick?(): void; short(w: Swatch): string };

function Row({ kind, swatches, pair, pointAt, on, onPick, short }: RowProps) {
  const flagged = kind !== 'typical' && !!pair?.flag;
  const inner = (
    <>
      <span className="lbl">{LABEL[kind]}</span>
      <span className={s.strip} style={{ gridTemplateColumns: `repeat(${swatches.length}, 1fr)` }}>
        {swatches.map((w) => (
          <i key={w.id} data-colour style={{ background: cssColor(kind === 'typical' ? w.oklch : simulateCvd(w.oklch, kind)) }} />
        ))}
      </span>
      <span className={cx(s.rd, flagged && s.worst)}>
        {flagged && <Icon name="error" size={14} className={s.dangerIcon} />}
        {pair && (
          <>
            {/* long names give way at their end; ΔE always shows */}
            <Tooltip content={`${displayName(pair.a)} / ${displayName(pair.b)}`} overflowOnly={short === displayName}>
              <span className={s.rdNames}>
                {short(pair.a)} / {short(pair.b)}
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
