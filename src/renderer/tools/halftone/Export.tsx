// Export (spec §3): the SVG for Illustrator, the screen PNG at any width and the separations as TIFF
// plates, all from the one cell list the view draws, through the shared export path.
import { useState, type ReactNode } from 'react';
import { svgProblem } from '../../../shared/halftone/svg.ts';
import { saveFile, saveToFolder } from '../../lib/export.ts';
import { useShell } from '../../shell/core/index.ts';
import { Button, IconButton, Module, NumberField, Progress, Segmented, toast } from '../../ui/index.ts';
import { cx } from '../../ui/cx.ts';
import { plural } from '../common/names.ts';
import { MM_PER, printPx, type HalftoneDoc } from './doc.ts';
import { pngFor, pngLimit, platesFor, platesLimit, svgFor, svgWeight } from './exports.ts';
import { shownDots, svgOver, type Screened } from './screening.ts';
import { patchView, type HalftoneView } from './view-state.ts';
import s from './Export.module.css';

const BITS = [
  { value: '8' as const, label: 'Greyscale', tip: '8-bit plates: every dot edge anti-aliased' },
  { value: '1' as const, label: '1-bit', tip: '1-bit plates: ink or no ink, for a Riso master or film' },
];

function Row({ name, desc, children, action, main }: { name: string; desc: ReactNode; children?: ReactNode; action: ReactNode; main?: boolean }) {
  return (
    <div className={cx(s.item, main && s.main)}>
      <div className={s.text}>
        <b className={s.name}>{name}</b>
        <p className={s.desc}>{desc}</p>
      </div>
      {action}
      {children && <div className={s.more}>{children}</div>}
    </div>
  );
}

const fmt = (mm: number, unit: HalftoneDoc['size']['unit']) => (mm / MM_PER[unit]).toFixed(unit === 'mm' ? 1 : 2);
const clock = (at: number) => new Date(at).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });

/** `error`: why the document as it is can't be screened; every export waits for a screen that can */
export function ExportModule({ d, v, screened, error }: { d: HalftoneDoc; v: HalftoneView; screened: Screened | null; error: string | null }) {
  const name = useShell((st) => st.docNames.halftone) ?? d.source?.name ?? 'Halftone';
  const [busy, setBusy] = useState<{ what: string; done: number | null; detail?: string } | null>(null);
  const fm = d.screen.shape === 'stochastic';
  const visible = d.inks.filter((i) => i.visible);
  const px = printPx(d);
  const pngH = Math.max(1, Math.round((v.pngWidth * d.size.h) / d.size.w));
  const pngProblem = pngLimit(v.pngWidth, pngH);
  const plateProblem = platesLimit(d);
  const ready = !!screened && !!d.source;
  const noInk = !d.source ? 'Open an image first.' : visible.length ? null : 'Every ink is hidden, so there is nothing to export. Show one first.';
  const blocked = noInk ?? error;

  const run = async (what: string, make: (progress: (done: number, detail?: string) => void) => Promise<{ path: string; label: string } | null>) => {
    setBusy({ what, done: null });
    try {
      const out = await make((done, detail) => setBusy({ what, done, detail }));
      if (!out) return;
      patchView({ last: { name: out.label, path: out.path, at: Date.now() } });
      toast.show({ icon: 'download', message: `Exported ${out.label}.` });
    } catch (e) {
      toast.show({ kind: 'error', message: `Couldn't make the ${what}: ${e instanceof Error ? e.message : String(e)}` });
    } finally {
      setBusy(null);
    }
  };
  const file = (what: string, ext: string, filterName: string, suggestedName: string, data: (p: (done: number, detail?: string) => void) => Promise<ArrayBuffer | string>) =>
    run(what, async (p) => {
      const path = await saveFile({ tool: 'halftone', suggestedName, ext, filterName, data: await data(p) });
      return path ? { path, label: path.split(/[\\/]/).pop()! } : null;
    });

  const svg = () => file('SVG', 'svg', 'SVG for Illustrator', `${name} halftone`, () => svgFor(d));
  const png = () => file('PNG', 'png', 'PNG image', `${name} halftone`, (p) => pngFor(d, v.pngWidth, p));
  const plates = () =>
    run('separations', async (p) => {
      const files = await platesFor(d, v.bits, name, p);
      const r = await saveToFolder({ tool: 'halftone', files });
      return r && { path: r.folder, label: `${plural(r.written.length, 'plate')} into ${r.folder.split(/[\\/]/).pop()}` };
    });

  const off = busy !== null || !ready;
  const svgOff = svgProblem(d) ?? blocked ?? (screened && !fm ? svgOver(shownDots(screened, d), !screened.held) : null);
  const weight = screened && !fm ? svgWeight(screened, d) : null;
  // a 1-bit cell of n × n print pixels holds n² + 1 tones; under 8 × 8 it reads as coarse
  const cellPx = d.size.dpi / d.screen.lpi;
  const coarse = v.bits === 1 && !fm && cellPx < 8 ? Math.round(cellPx * cellPx) + 1 : null;
  const unit = d.size.unit;

  return (
    <Module title="Export" readout={`${fmt(d.size.w, unit)} × ${fmt(d.size.h, unit)} ${unit}`}>
      <div className={s.list}>
        <Row
          main
          name="SVG for Illustrator"
          desc={`Vector dots, one group per ink, each ink one compound path, sized in ${unit === 'mm' ? 'mm' : 'inches'}. It matches the view dot for dot.`}
          action={
            <Button variant="primary" size="lg" icon="download" disabled={off || !!svgOff} tooltip={svgOff ?? undefined} onClick={() => void svg()}>
              {busy?.what === 'SVG' ? 'Exporting…' : 'Export'}
            </Button>
          }
        >
          {weight && <span className="lbl">{weight}</span>}
        </Row>

        <Row
          name="PNG for screen"
          desc={`sRGB at any width, ${d.paper.include ? 'flat on the paper' : 'clear round the dots'}${d.feel.bake && (d.feel.misregister > 0 || d.feel.texture > 0) ? ', with the print feel' : ''}.`}
          action={
            <Button icon="download" disabled={off || !!pngProblem || !!blocked} tooltip={pngProblem ?? blocked ?? undefined} onClick={() => void png()}>
              {busy?.what === 'PNG' ? 'Exporting…' : 'Export'}
            </Button>
          }
        >
          <div className={s.pair}>
            <NumberField label="W" min={16} max={16384} unit="px" value={v.pngWidth} onChange={(pngWidth) => patchView({ pngWidth })} />
            <span className={cx(s.size, pngProblem && s.danger)}>
              {v.pngWidth.toLocaleString('en')} × {pngH.toLocaleString('en')} px
            </span>
          </div>
        </Row>

        <Row
          name="Separations"
          desc={`${plural(visible.length, 'plate')} at ${d.size.dpi} ppi (${px.w.toLocaleString('en')} × ${px.h.toLocaleString('en')} px), ${v.bits === 1 ? '1-bit' : 'greyscale'} TIFF, into one folder. Black is ink.${visible.length < d.inks.length ? ' Hidden inks stay out.' : ''}${coarse ? ` A 1-bit cell holds ${coarse} tones at this dpi.` : ''}`}
          action={
            <Button icon="folder_open" disabled={off || !!plateProblem || !!blocked} tooltip={plateProblem ?? blocked ?? undefined} onClick={() => void plates()}>
              {busy?.what === 'separations' ? 'Exporting…' : 'Export…'}
            </Button>
          }
        >
          <Segmented options={BITS} value={v.bits === 1 ? '1' : '8'} onChange={(b) => patchView({ bits: b === '1' ? 1 : 8 })} />
        </Row>

        {busy && busy.done !== null && <Progress label={`Making the ${busy.what}`} value={busy.done} detail={busy.detail} />}
      </div>
      {v.last && (
        <div className={s.last}>
          <span className="lbl">Last export</span>
          <span className={s.lastName}>{v.last.name}</span>
          <span className={s.lastAt}>{clock(v.last.at)}</span>
          <IconButton icon="folder_open" label="Show in Explorer" size="xs" onClick={() => void window.api.invoke('shell.reveal', v.last!.path).catch(() => toast.show({ kind: 'error', message: `${v.last!.name} isn't there any more.` }))} />
        </div>
      )}
    </Module>
  );
}
