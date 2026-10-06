// Check palette tab: the palette as each colour vision sees it, and by value (its greys), each row
// naming the colours that collide and carrying its fix; then print: ≈CMYK, gamut and, on request,
// the nearest reference inks.
import { useMemo } from 'react';
import { cssColor, hexToOklch, simulateCvd, toSrgbGamut, type Cvd, type Oklch } from '../../../shared/color/index.ts';
import { valueOf } from '../../../shared/color/value.ts';
import { printInfo, type CvdClosest, type PrintInfo } from '../../../shared/palette/checks.ts';
import type { InkMatch } from '../../../shared/palette/inks.ts';
import type { Swatch } from '../../../shared/types.ts';
import { cx } from '../../ui/cx.ts';
import { Button, Icon, NumberField, toast, Tooltip } from '../../ui/index.ts';
import { cvdFix } from '../common/adjust.ts';
import { Value } from '../common/Value.tsx';
import { VISIONS, type Kind } from '../common/Vision.tsx';
import { setColours, type Doc } from './actions.ts';
import { displayName, type DesignDoc, type DesignView, type Simulate } from './doc.ts';
import type { Results, Verdict } from './results.ts';
import { patchView, pointAt } from './view-state.ts';
import s from './Tabs.module.css';

const LABEL: Record<Kind, string> = { typical: 'Typical vision', protan: 'Protanopia', deutan: 'Deuteranopia', tritan: 'Tritanopia', achromat: 'Achromatopsia' };
const CVDS = VISIONS.slice(1) as Cvd[];
const samePair = (x: CvdClosest | null, y: CvdClosest) => !!x && ((x.a.id === y.a.id && x.b.id === y.b.id) || (x.a.id === y.b.id && x.b.id === y.a.id));

const LIB = { riso: 'Riso', ral: 'RAL', hks: 'HKS', ncs: 'NCS' } as const;
const inkLabel = (m: InkMatch) => (m.library === 'ral' ? m.id.replace(/^RAL/, 'RAL ') : m.name);
/** with its library, which RAL, HKS and NCS names already carry ("HKS 5 K") */
const fullInk = (m: InkMatch) => (inkLabel(m).startsWith(LIB[m.library]) ? inkLabel(m) : `${LIB[m.library]} ${inkLabel(m)}`);

export function CheckTab({ doc, d, v, r }: { doc: Doc; d: DesignDoc; v: DesignView; r: Results }) {
  const shown = r.shown;
  const fix = (label: string, changes: Record<string, Oklch>) => setColours(doc, label, changes);
  const few = shown.length < 2;
  return (
    <>
      <Verdicts list={r.verdicts} />
      <div className={s.h3} data-check="vision">
        Colour vision
        <small>how the palette reads for everyone · Machado 2009</small>
        <span className={s.flags}>
          <NumberField label="Flag ΔE <" value={v.flagE} min={1} max={40} step={0.5} precision={1} size="sm" width={120} onChange={(flagE) => patchView({ flagE })} />
        </span>
      </div>
      {few ? (
        <p className={s.none}>With two or more colours, this shows how each colour vision deficiency sees them, and which look the same in greyscale.</p>
      ) : (
        <div className={s.cvs} role="group" aria-label="Colour vision">
          <div className={cx(s.cv, s.names)} aria-hidden="true">
            <span />
            <span className={s.nameStrip} style={{ gridTemplateColumns: `repeat(${shown.length}, 1fr)` }}>
              {shown.map((w) => (
                <span key={w.id}>{displayName(w)}</span>
              ))}
            </span>
            <span />
          </div>
          <VisionRow kind="typical" shown={shown} pair={r.vision.typical} sim={v.sim} />
          {CVDS.map((k) => (
            <VisionRow key={k} kind={k} shown={shown} pair={r.vision[k]} sim={v.sim} r={r} flagE={v.flagE} onFix={fix} />
          ))}
        </div>
      )}
      <div data-check="value" className={s.valueBox}>
        <Value
          swatches={shown}
          onFix={fix}
          pointAt={pointAt}
          collisions={r.collisions}
          contrast={r.contrast}
          flagL={v.flagL}
          onFlagL={(flagL) => patchView({ flagL })}
        />
      </div>
      <div data-check="print" />
      <PrintBlock doc={doc} d={d} r={r} />
    </>
  );
}

/** one line per check, problems first; a click goes to the check (Contrast has its own tab) */
function Verdicts({ list }: { list: Verdict[] }) {
  const rank = (x: Verdict) => (x.ok === false ? 0 : x.ok === undefined ? 1 : 2);
  const sorted = [...list].sort((a, b) => rank(a) - rank(b));
  const go = (id: string) => (id === 'contrast' ? patchView({ tab: 'contrast' }) : document.querySelector(`[data-check="${id}"]`)?.scrollIntoView({ block: 'start' }));
  return (
    <div className={s.verdicts} role="list" aria-label="Checks">
      {sorted.map((x) => (
        <button key={x.id} type="button" role="listitem" className={cx(s.verdict, x.ok === false && s.bad)} data-verdict={x.id} onClick={() => go(x.id)}>
          <Icon name={x.ok === false ? 'error' : x.ok ? 'check_circle' : x.icon} size={16} />
          <b>{x.label}</b>
          <span>{x.verdict}</span>
        </button>
      ))}
    </div>
  );
}

const toggleSim = (to: Simulate, sim: Simulate) => patchView(sim === to ? { sim: 'normal' } : { sim: to, ...((CVDS as string[]).includes(to) && { cvd: to as Cvd }) });

function Label({ text, to, sim }: { text: string; to: Simulate; sim: Simulate }) {
  if (to === 'normal') return <span className={s.cvLabel}>{text}</span>;
  return (
    <Tooltip content={sim === to ? 'Show the palette as it is' : 'Show the palette row this way'}>
      <button type="button" className={cx(s.cvLabel, s.cvBtn, sim === to && s.cvOn)} aria-pressed={sim === to} onClick={() => toggleSim(to, sim)}>
        {text}
      </button>
    </Tooltip>
  );
}

function VisionRow({ kind, shown, pair, sim, r, flagE, onFix }: { kind: Kind; shown: Swatch[]; pair: CvdClosest | null; sim: Simulate; r?: Results; flagE?: number; onFix?(label: string, c: Record<string, Oklch>): void }) {
  const flagged = kind !== 'typical' && !!pair?.flag;
  // the same pair flagged under several simulations is one problem with one fix
  const kinds = flagged && r ? CVDS.filter((k) => r.vision[k]?.flag && samePair(r.vision[k], pair!)) : [];
  const parted = (() => {
    if (!flagged || !pair || flagE === undefined) return null;
    let a = pair.a.oklch;
    let b = pair.b.oklch;
    const others = shown.filter((w) => w.id !== pair.a.id && w.id !== pair.b.id).map((w) => valueOf(w.oklch));
    for (const k of kinds) [a, b] = cvdFix(a, b, k, flagE, others) ?? [a, b];
    return a === pair.a.oklch && b === pair.b.oklch ? null : { [pair.a.id]: a, [pair.b.id]: b };
  })();
  return (
    <div className={s.cv} {...(pair ? pointAt([pair.a.id, pair.b.id]) : {})}>
      <Label text={LABEL[kind]} to={kind === 'typical' ? 'normal' : kind} sim={sim} />
      <span className={s.strip} style={{ gridTemplateColumns: `repeat(${shown.length}, 1fr)` }}>
        {shown.map((w) => (
          <i key={w.id} data-colour style={{ background: cssColor(kind === 'typical' ? w.oklch : simulateCvd(w.oklch, kind)) }} />
        ))}
      </span>
      <span className={cx(s.res, flagged && s.bad)}>
        {!pair ? null : flagged ? (
          <>
            <span>
              {displayName(pair.a)} and {displayName(pair.b)} look alike, ΔE {pair.deltaE.toFixed(1)}
            </span>
            {parted && onFix && (
              <Button size="xs" onClick={() => onFix(`Part ${displayName(pair.a)} and ${displayName(pair.b)}`, parted)} tooltip={`Spread them in value until ΔE reaches ${flagE!.toFixed(1)}`}>
                Part them
              </Button>
            )}
            {!parted && <small>change one hue</small>}
          </>
        ) : (
          <span>
            {kind === 'typical' ? 'Closest pair' : 'Nothing merges: closest pair'} {displayName(pair.a)} / {displayName(pair.b)}, ΔE {pair.deltaE.toFixed(1)}
          </span>
        )}
      </span>
    </div>
  );
}

// ── print ────────────────────────────────────────────────────────────────────────────────────────

function PrintBlock({ doc, d, r }: { doc: Doc; d: DesignDoc; r: Results }) {
  const out = r.outOfSrgb;
  const toSrgb = () =>
    setColours(doc, out.length === 1 ? `Bring ${displayName(out[0])} into sRGB` : `Bring ${out.length} colours into sRGB`, Object.fromEntries(out.map((w) => [w.id, toSrgbGamut(w.oklch)])));
  const rows = useMemo(() => d.swatches.map((w) => [w, printInfo(w)] as [Swatch, PrintInfo]), [d.swatches]);
  return (
    <>
      <div className={s.h3}>
        Print inks
        <small>≈CMYK estimate · nearest Riso, RAL, HKS and NCS inks · click one to match</small>
        <span className={s.flags}>
          {out.length > 0 && (
            <Button size="xs" onClick={toSrgb} tooltip="Reduce chroma until each shows exactly on an sRGB screen">
              Map into sRGB
            </Button>
          )}
        </span>
      </div>
      {rows.length === 0 ? <p className={s.none}>Each colour’s ≈CMYK, gamut and nearest inks show here.</p> : <PrintTable doc={doc} rows={rows} />}
    </>
  );
}

function PrintTable({ doc, rows }: { doc: Doc; rows: [Swatch, PrintInfo][] }) {
  // a click in a table you read changes a colour: the toast says so and takes it back
  const match = (w: Swatch, m: InkMatch) => {
    const what = `${displayName(w)} to ${fullInk(m)}`;
    setColours(doc, `Match ${what}`, { [w.id]: hexToOklch(m.hex) });
    const after = doc.get();
    toast.show({ icon: 'format_color_fill', message: `Matched ${what}.`, when: () => doc.get() === after, undo: () => void (doc.get() === after && doc.undo()) });
  };
  return (
    <div className={s.ptable} role="table" aria-label="Print">
      <div className={s.prow} role="row">
        <span />
        <span className="lbl">Swatch</span>
        <span className="lbl">≈CMYK</span>
        <span className="lbl">sRGB</span>
        <span className="lbl">P3</span>
        {Object.values(LIB).map((l) => (
          <span key={l} className="lbl">
            {l} ΔE
          </span>
        ))}
      </div>
      {rows.map(([w, info]) => (
        <div key={w.id} className={s.prow} role="row" {...pointAt([w.id])}>
          <i className={s.pchip} data-colour style={{ background: cssColor(w.oklch) }} />
          <span className={s.pname}>{displayName(w)}</span>
          <span className={s.pnum}>{info.cmyk.join(' ')}</span>
          <Gamut ok={info.inSrgb} label={info.inSrgb ? 'In' : 'Out'} bare />
          <Gamut ok={info.inP3} label={info.inP3 ? 'In' : 'Out'} bare />
          {info.nearest.map((m) => (
            <Tooltip key={m.library} content={`Match ${displayName(w)} to ${fullInk(m)} (ΔE ${m.deltaE.toFixed(1)})`}>
              <button type="button" className={s.ink} onClick={() => match(w, m)}>
                <i className={s.pchip} data-colour style={{ background: cssColor(hexToOklch(m.hex)) }} />
                <span className={s.inkName}>{inkLabel(m)}</span>
                <span className={s.pnum}>{m.deltaE.toFixed(1)}</span>
              </button>
            </Tooltip>
          ))}
        </div>
      ))}
    </div>
  );
}

function Gamut({ ok, label, bare }: { ok: boolean; label: string; bare?: boolean }) {
  return (
    <span className={cx(bare ? s.gamBare : s.gam, !ok && s.bad)}>
      {bare && <Icon name={ok ? 'check' : 'close'} size={14} />}
      {label}
    </span>
  );
}
