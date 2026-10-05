import { useMemo } from 'react';
import { cssColor, hexToOklch, toSrgbGamut } from '../../../shared/color/index.ts';
import { printInfo, type PrintInfo } from '../../../shared/palette/checks.ts';
import type { InkMatch } from '../../../shared/palette/inks.ts';
import type { Swatch } from '../../../shared/types.ts';
import { Button, Icon, IconButton, Module, toast, Tooltip } from '../../ui/index.ts';
import { cx } from '../../ui/cx.ts';
import { setColours, type Doc } from './actions.ts';
import { displayName, type DesignDoc } from './doc.ts';
import { pointAt } from './view-state.ts';
import s from './Dock.module.css';

const LIB = { riso: 'Riso', ral: 'RAL', hks: 'HKS', ncs: 'NCS' } as const;
const inkLabel = (m: InkMatch) => (m.library === 'ral' ? m.id.replace(/^RAL/, 'RAL ') : m.name);
/** with its library, which RAL, HKS and NCS names already carry ("HKS 5 K") */
const fullInk = (m: InkMatch) => (inkLabel(m).startsWith(LIB[m.library]) ? inkLabel(m) : `${LIB[m.library]} ${inkLabel(m)}`);

/**
 * The Print card: ≈CMYK and gamut per swatch. "Inks" opens it across the whole dock with the nearest
 * Riso, RAL, HKS and NCS inks, which a click matches a swatch to.
 */
export function Print({ doc, d, out, expanded, onExpand }: { doc: Doc; d: DesignDoc; out: Swatch[]; expanded: boolean; onExpand(on: boolean): void }) {
  const toSrgb = () =>
    setColours(doc, out.length === 1 ? `Bring ${displayName(out[0])} into sRGB` : `Bring ${out.length} colours into sRGB`, Object.fromEntries(out.map((w) => [w.id, toSrgbGamut(w.oklch)])));
  return (
    <Module
      title="Print"
      sub={expanded ? '≈CMYK estimate · reference inks' : '≈CMYK'}
      readout={d.swatches.length ? (out.length ? `${out.length} out of sRGB` : 'All in sRGB') : undefined}
      actions={
        <>
          {out.length > 0 && (
            <Button size="xs" onClick={toSrgb} tooltip="Reduce chroma until each shows exactly on an sRGB screen">
              Map into sRGB
            </Button>
          )}
          {expanded ? (
            <IconButton icon="close" label="Back to the checks" size="sm" onClick={() => onExpand(false)} />
          ) : (
            <Button size="xs" iconEnd="chevron_right" onClick={() => onExpand(true)} tooltip="The nearest Riso, RAL, HKS and NCS inks for each colour">
              Inks
            </Button>
          )}
        </>
      }
      scroll
      flush
      className={s.card}
    >
      {expanded ? <PrintTable doc={doc} swatches={d.swatches} /> : <PrintList swatches={d.swatches} />}
    </Module>
  );
}

function PrintList({ swatches }: { swatches: Swatch[] }) {
  const rows = useMemo(() => swatches.map((w) => [w, printInfo(w)] as [Swatch, PrintInfo]), [swatches]);
  return (
    <div className={s.plist}>
      {rows.map(([w, info]) => (
        <div key={w.id} className={s.pitem} {...pointAt([w.id])}>
          <i className={s.pchip} style={{ background: cssColor(w.oklch) }} />
          <span className={s.pname}>{displayName(w)}</span>
          <span className={s.pnum}>{info.cmyk.join(' ')}</span>
          <Gamut ok={info.inSrgb} />
        </div>
      ))}
    </div>
  );
}

function PrintTable({ doc, swatches }: { doc: Doc; swatches: Swatch[] }) {
  // nearest inks search every library with CIEDE2000: only while this is the one open
  const rows = useMemo(() => swatches.map((w) => [w, printInfo(w)] as [Swatch, PrintInfo]), [swatches]);
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
          <Gamut ok={info.inSrgb} />
          <Gamut ok={info.inP3} />
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

function Gamut({ ok }: { ok: boolean }) {
  return (
    <span className={cx(s.gam, !ok && s.bad)}>
      <Icon name={ok ? 'check' : 'close'} size={14} />
      {ok ? 'In' : 'Out'}
    </span>
  );
}
