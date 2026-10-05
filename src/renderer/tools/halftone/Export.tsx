// Export (spec §3): the SVG for Illustrator, the screen PNG at any width and the separations as TIFF
// plates, all from the one cell list the view draws, through the shared export path. The doc bar's
// Export menu runs them; the inspector's group holds the sizes and options they use.
import { svgProblem } from '../../../shared/halftone/svg.ts';
import { intoFolder, leaf, saveFile } from '../../lib/export.ts';
import { useShell } from '../../shell/core/index.ts';
import { InspectorGroup, InspectorRow, NumberField, Segmented } from '../../ui/index.ts';
import { cx } from '../../ui/cx.ts';
import { LastExport, useExport } from '../common/Export.tsx';
import { fmtPx, plural } from '../common/names.ts';
import { MM_PER, printPx, type HalftoneDoc } from './doc.ts';
import { pngFor, pngLimit, pngMaxWidth, platesFor, platesLimit, svgFor, svgWeight } from './exports.ts';
import { shownDots, svgOver, type Screened } from './screening.ts';
import { patchView, type HalftoneView } from './view-state.ts';
import s from './Export.module.css';

const BITS = [
  { value: '8' as const, label: 'Greyscale', tip: '8-bit plates: every dot edge anti-aliased' },
  { value: '1' as const, label: '1-bit', tip: '1-bit plates: ink or no ink, for a Riso master or film' },
];

const fmt = (mm: number, unit: HalftoneDoc['size']['unit']) => (mm / MM_PER[unit]).toFixed(unit === 'mm' ? 1 : 2);

/**
 * The exports, made once: the doc bar's Export menu runs them, the inspector group holds their sizes.
 * `error`: why the document as it is can't be screened; every export waits for a screen that can.
 */
export function useHalftoneExport(d: HalftoneDoc, v: HalftoneView, screened: Screened | null, error: string | null) {
  const name = useShell((st) => st.docNames.halftone) ?? d.source?.name ?? 'Halftone';
  const ex = useExport((last) => patchView({ last }));
  const fm = d.screen.shape === 'stochastic';
  const visible = d.inks.filter((i) => i.visible);
  const pngH = Math.max(1, Math.round((v.pngWidth * d.size.h) / d.size.w));
  const pngProblem = pngLimit(v.pngWidth, pngH);
  const plateProblem = platesLimit(d);
  const ready = !!screened && !!d.source;
  const noInk = !d.source ? 'Open an image first.' : visible.length ? null : 'Every ink is hidden, so there is nothing to export. Show one first.';
  const blocked = noInk ?? error ?? (ready ? null : 'Still screening.');

  const file = (what: string, ext: string, filterName: string, suggestedName: string, data: (report: (done: number, detail?: string) => void) => Promise<ArrayBuffer | string>) =>
    ex.file(what, async (report) => saveFile({ tool: 'halftone', suggestedName, ext, filterName, data: await data(report) }));

  // why the SVG can't be made from this document: said in the group, where it is read, as well as on the menu row
  const svgWhy = svgProblem(d) ?? (screened && !fm ? svgOver(shownDots(screened, d), !screened.held) : null);
  return {
    ex,
    fm,
    visible,
    pngH,
    pngProblem,
    plateProblem,
    svgWhy,
    blocked,
    /** the doc bar's Export button: why it is off, or null */
    why: blocked ?? (ex.busy ? 'An export is running' : null),
    svg: () => file('SVG', 'svg', 'SVG for Illustrator', `${name} halftone`, () => svgFor(d)),
    png: () => file('PNG', 'png', 'PNG image', `${name} halftone`, (report) => pngFor(d, v.pngWidth, report)),
    copyPng: () => ex.copyPng('PNG', (report) => pngFor(d, v.pngWidth, report)),
    // the folder is asked for first and each plate is written as it is made, so no job holds them all
    plates: () =>
      ex.run('separations', async (report) => {
        let n = 0;
        const folder = await intoFolder('halftone', async (write) => {
          await platesFor(d, v.bits, name, report, async (f) => {
            await write(f.name, f.data);
            n++;
          });
          return true;
        });
        return folder ? { path: folder, label: `${plural(n, 'plate')} into ${leaf(folder)}` } : null;
      }),
  };
}

export type HalftoneExport = ReturnType<typeof useHalftoneExport>;

export function ExportModule({ d, v, screened, out }: { d: HalftoneDoc; v: HalftoneView; screened: Screened | null; out: HalftoneExport }) {
  const { fm, visible, pngH, pngProblem, plateProblem, svgWhy } = out;
  const px = printPx(d);
  const weight = screened && !fm ? svgWeight(screened, d) : null;
  // a 1-bit cell of n × n print pixels holds n² + 1 tones; under 8 × 8 it reads as coarse
  const cellPx = d.size.dpi / d.screen.lpi;
  const coarse = v.bits === 1 && !fm && cellPx < 8 ? Math.round(cellPx * cellPx) + 1 : null;
  const unit = d.size.unit;
  const problem = svgWhy ?? pngProblem ?? plateProblem;

  return (
    <InspectorGroup id="halftone.export" title="Export" meta={`${fmt(d.size.w, unit)} × ${fmt(d.size.h, unit)} ${unit}`}>
      <InspectorRow
        label="SVG"
        info={`Vector dots for Illustrator, one group per ink, each ink one compound path, sized in ${unit === 'mm' ? 'mm' : 'inches'}. It matches the view dot for dot.`}
      >
        <span className={cx('val', s.size)}>{weight ?? (fm ? 'Not for FM' : 'Vector dots')}</span>
      </InspectorRow>
      <InspectorRow
        label="PNG width"
        pair
        info={`sRGB at any width, ${d.paper.include ? 'flat on the paper' : 'clear round the dots'}${d.feel.bake && (d.feel.misregister > 0 || d.feel.texture > 0) ? ', with the print feel' : ''}.`}
      >
        <NumberField label="Width" hideLabel min={16} max={pngMaxWidth(d.size)} unit="px" value={v.pngWidth} onChange={(pngWidth) => patchView({ pngWidth })} />
        <span className={cx('val', s.size, pngProblem && s.danger)}>{fmtPx(v.pngWidth, pngH)}</span>
      </InspectorRow>
      <InspectorRow
        label="Separations"
        info={`${plural(visible.length, 'plate')} at ${d.size.dpi} ppi (${fmtPx(px.w, px.h)}), TIFF, into one folder. Black is ink.${visible.length < d.inks.length ? ' Hidden inks stay out.' : ''}${coarse ? ` A 1-bit cell holds ${coarse} tones at this dpi.` : ''}`}
      >
        <Segmented fit options={BITS} value={v.bits === 1 ? '1' : '8'} onChange={(b) => patchView({ bits: b === '1' ? 1 : 8 })} />
      </InspectorRow>
      {problem && <span className={cx('lbl', s.danger)}>{problem}</span>}
      <LastExport last={v.last} />
    </InspectorGroup>
  );
}
