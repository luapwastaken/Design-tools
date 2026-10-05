// Check palette tab: the palette as each colour vision sees it, and in greyscale (value), each row
// naming the colours that collide and carrying its fix; then print: ≈CMYK, gamut and, on request,
// the nearest reference inks.
import { useMemo } from 'react';
import { contrast, cssColor, hexToOklch, simulateCvd, toSrgbGamut, type Cvd, type Oklch } from '../../../shared/color/index.ts';
import { printInfo, type CvdClosest, type PrintInfo, type ValueCollision } from '../../../shared/palette/checks.ts';
import type { InkMatch } from '../../../shared/palette/inks.ts';
import type { Swatch } from '../../../shared/types.ts';
import { cx } from '../../ui/cx.ts';
import { Button, Icon, IconButton, NumberField, toast, Tooltip } from '../../ui/index.ts';
import { cvdFix, valueFix } from '../common/adjust.ts';
import { plural } from '../common/names.ts';
import { VISIONS, type Kind } from '../common/Vision.tsx';
import { setColours, type Doc } from './actions.ts';
import { displayName, listNames, type DesignDoc, type DesignView, type Simulate } from './doc.ts';
import type { Results } from './results.ts';
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
      <div className={s.h3}>
        Colour vision and value
        <small>how the palette reads for everyone</small>
        <span className={s.flags}>
          <NumberField label="Flag ΔE <" value={v.flagE} min={1} max={40} step={0.5} precision={1} size="sm" width={120} onChange={(flagE) => patchView({ flagE })} />
          <NumberField label="Flag ΔL <" value={v.flagL} min={1} max={20} step={0.5} precision={1} size="sm" width={120} onChange={(flagL) => patchView({ flagL })} />
        </span>
      </div>
      {few ? (
        <p className={s.none}>With two or more colours, this shows how each colour vision deficiency sees them, and which look the same in greyscale.</p>
      ) : (
        <div className={s.cvs} role="group" aria-label="Colour vision and value">
          <VisionRow kind="typical" shown={shown} pair={r.vision.typical} sim={v.sim} />
          {CVDS.map((k) => (
            <VisionRow key={k} kind={k} shown={shown} pair={r.vision[k]} sim={v.sim} r={r} flagE={v.flagE} onFix={fix} />
          ))}
          <ValueRow shown={shown} r={r} flagL={v.flagL} sim={v.sim} onFix={fix} />
        </div>
      )}
      <PrintBlock doc={doc} d={d} v={v} r={r} />
    </>
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
    const others = shown.filter((w) => w.id !== pair.a.id && w.id !== pair.b.id).map((w) => w.oklch[0]);
    for (const k of kinds) [a, b] = cvdFix(a, b, k, flagE, others) ?? [a, b];
    return a === pair.a.oklch && b === pair.b.oklch ? null : { [pair.a.id]: a, [pair.b.id]: b };
  })();
  return (
    <div className={s.cv} {...(pair ? pointAt([pair.a.id, pair.b.id]) : {})}>
      <Label text={LABEL[kind]} to={kind === 'typical' ? 'normal' : kind} sim={sim} />
      <span className={s.strip} style={{ gridTemplateColumns: `repeat(${shown.length}, 1fr)` }}>
        {shown.map((w) => (
          <i key={w.id} style={{ background: cssColor(kind === 'typical' ? w.oklch : simulateCvd(w.oklch, kind)) }} />
        ))}
      </span>
      <span className={cx(s.res, flagged && s.bad)}>
        {flagged && pair ? (
          <>
            <span>
              {displayName(pair.a)} and {displayName(pair.b)} look alike
            </span>
            {parted && onFix && (
              <Button size="xs" onClick={() => onFix(`Part ${displayName(pair.a)} and ${displayName(pair.b)}`, parted)} tooltip={`Spread them in lightness until ΔE reaches ${flagE!.toFixed(1)}`}>
                Part them
              </Button>
            )}
            {!parted && <small>change one hue</small>}
          </>
        ) : (
          'All colours distinct'
        )}
      </span>
    </div>
  );
}

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

function ValueRow({ shown, r, flagL, sim, onFix }: { shown: Swatch[]; r: Results; flagL: number; sim: Simulate; onFix(label: string, c: Record<string, Oklch>): void }) {
  const cs = r.collisions;
  const cluster = cs.length ? clusterOf(cs) : [];
  const ids = new Set(cluster.map((w) => w.id));
  const elsewhere = cs.filter((c) => !ids.has(c.a.id) || !ids.has(c.b.id)).length;
  const fits = (cluster.length - 1) * (flagL + 0.5) <= 100;
  const spread = () => {
    const others = shown.filter((w) => !ids.has(w.id)).map((w) => w.oklch[0]);
    // a spread that breaks a contrast pair which passes now just trades one problem for another
    const passing = r.contrast.filter((p) => p.ratio >= p.target);
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
    <div className={s.cv} {...pointAt(cluster.map((w) => w.id))}>
      <Label text="Greyscale" to="greyscale" sim={sim} />
      <span className={s.strip} style={{ gridTemplateColumns: `repeat(${shown.length}, 1fr)` }}>
        {shown.map((w) => (
          <Tooltip key={w.id} content={`${displayName(w)}: L ${(w.oklch[0] * 100).toFixed(1)}`}>
            <i style={{ background: cssColor([w.oklch[0], 0, 0]) }} />
          </Tooltip>
        ))}
      </span>
      <span className={cx(s.res, cs.length > 0 && s.bad)}>
        {cs.length ? (
          <>
            <span>
              {cluster.length === 2 ? `${displayName(cluster[0])} and ${displayName(cluster[1])} have the same lightness` : `${listNames(cluster.map(displayName))} have the same lightness`}
              {elsewhere > 0 ? `, and ${plural(elsewhere, 'more pair')}` : ''}
            </span>
            <Button size="xs" onClick={spread} tooltip={fits ? `Spread them in lightness until ΔL reaches ${(flagL + 0.5).toFixed(1)}` : 'Spread them as evenly as lightness allows'}>
              Spread them
            </Button>
          </>
        ) : (
          'Every colour stands apart in value'
        )}
      </span>
    </div>
  );
}

// ── print ────────────────────────────────────────────────────────────────────────────────────────

function PrintBlock({ doc, d, v, r }: { doc: Doc; d: DesignDoc; v: DesignView; r: Results }) {
  const out = r.outOfSrgb;
  const toSrgb = () =>
    setColours(doc, out.length === 1 ? `Bring ${displayName(out[0])} into sRGB` : `Bring ${out.length} colours into sRGB`, Object.fromEntries(out.map((w) => [w.id, toSrgbGamut(w.oklch)])));
  const rows = useMemo(() => d.swatches.map((w) => [w, printInfo(w)] as [Swatch, PrintInfo]), [d.swatches]);
  return (
    <>
      <div className={s.h3}>
        Print
        <small>{v.inks ? '≈CMYK estimate · reference inks' : '≈CMYK estimate'}</small>
        <span className={s.flags}>
          {out.length > 0 && (
            <Button size="xs" onClick={toSrgb} tooltip="Reduce chroma until each shows exactly on an sRGB screen">
              Map into sRGB
            </Button>
          )}
          {v.inks ? (
            <IconButton icon="close" label="Hide the reference inks" size="sm" onClick={() => patchView({ inks: false })} />
          ) : (
            <Button size="xs" iconEnd="chevron_right" onClick={() => patchView({ inks: true })} tooltip="The nearest Riso, RAL, HKS and NCS inks for each colour">
              Inks
            </Button>
          )}
        </span>
      </div>
      {rows.length === 0 ? (
        <p className={s.none}>Each colour’s ≈CMYK and gamut shows here.</p>
      ) : v.inks ? (
        <PrintTable doc={doc} rows={rows} />
      ) : (
        <div className={s.prints}>
          {rows.map(([w, info]) => (
            <div key={w.id} className={s.print} {...pointAt([w.id])}>
              <i className={s.pchip} style={{ background: cssColor(w.oklch) }} />
              <span className={s.pname}>{displayName(w)}</span>
              <span className={s.pnum}>{info.cmyk.join(' ')}</span>
              <Gamut ok={info.inSrgb} label={info.inSrgb ? 'In gamut' : 'Out of sRGB'} />
            </div>
          ))}
        </div>
      )}
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
          <i className={s.pchip} style={{ background: cssColor(w.oklch) }} />
          <span className={s.pname}>{displayName(w)}</span>
          <span className={s.pnum}>{info.cmyk.join(' ')}</span>
          <Gamut ok={info.inSrgb} label={info.inSrgb ? 'In' : 'Out'} bare />
          <Gamut ok={info.inP3} label={info.inP3 ? 'In' : 'Out'} bare />
          {info.nearest.map((m) => (
            <Tooltip key={m.library} content={`Match ${displayName(w)} to ${fullInk(m)} (ΔE ${m.deltaE.toFixed(1)})`}>
              <button type="button" className={s.ink} onClick={() => match(w, m)}>
                <i className={s.pchip} style={{ background: cssColor(hexToOklch(m.hex)) }} />
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
