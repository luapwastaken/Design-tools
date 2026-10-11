// Export (spec §3): the SVG for Illustrator, the screen PNG at any width and the separations as TIFF
// plates, all from the one cell list the view draws, through the shared export path. The doc bar's
// Export menu runs them; the inspector's group holds the sizes and options they use.
import { svgProblem } from '../../../shared/halftone/svg.ts';
import { intoFolder, leaf, saveFile } from '../../lib/export.ts';
import { useShell } from '../../shell/core/index.ts';
import { Button, Icon, IconButton, InspectorGroup, InspectorRow, NumberField, Segmented, Toggle } from '../../ui/index.ts';
import { cx } from '../../ui/cx.ts';
import { LastExport, useExport } from '../common/Export.tsx';
import { fmtPx, plural } from '../common/names.ts';
import { MM_PER, printPx, type HalftoneDoc } from './doc.ts';
import { pngFor, pngLimit, pngHeightOf, pngMaxWidth, pngWidthOf, platesFor, platesLimit, svgFor, svgWeight } from './exports.ts';
import { shownDots, svgMegabytes, SVG_HEAVY_MB, svgOver, type Screened } from './screening.ts';
import { patchView, type HalftoneView } from './view-state.ts';
import s from './Export.module.css';

const BITS = [
  { value: '8' as const, label: 'Greyscale', tip: '8-bit plates: every dot edge anti-aliased' },
  { value: '1' as const, label: '1-bit', tip: '1-bit plates: ink or no ink, for a Riso master or film' },
];

const FILES = [
  { value: 'tiff' as const, label: 'TIFF', tip: 'Black ink on white, uncompressed, for a RIP or a Riso master' },
  { value: 'png' as const, label: 'PNG', tip: 'Black ink on a clear ground, compressed, to lay over other work' },
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
  const pngW = pngWidthOf(d, v.pngWidth);
  const pngH = pngHeightOf(d, pngW);
  const pngProblem = pngLimit(pngW, pngH);
  const plateProblem = platesLimit(d, v.marks);
  const ready = !!screened && !!d.source;
  const noInk = !d.source ? 'Open an image first.' : visible.length ? null : 'Every ink is hidden, so there is nothing to export. Show one first.';
  const blocked = noInk ?? error ?? (ready ? null : 'Still screening.');

  const file = (what: string, ext: string, filterName: string, suggestedName: string, data: (report: (done: number, detail?: string) => void) => Promise<ArrayBuffer | string>) =>
    ex.file(what, async (report) => saveFile({ tool: 'halftone', suggestedName, ext, filterName, data: await data(report) }));

  // why the SVG can't be made from this document: said in the group, where it is read, as well as on the menu row
  const svgWhy = svgProblem(d) ?? (screened && !fm ? svgOver(shownDots(screened, d), !screened.held) : null);
  // a file for each ink stays under the dot cap while the biggest ink does, so it can go where the whole SVG can't
  const biggest = screened ? Math.max(0, ...screened.inks.map((k, i) => (d.inks[i]?.visible ? k.count : 0))) : 0;
  const svgInkWhy = svgProblem(d) ?? (screened && !fm ? svgOver(biggest, !screened.held) : null);
  return {
    ex,
    fm,
    visible,
    pngW,
    pngH,
    pngProblem,
    plateProblem,
    svgWhy,
    svgInkWhy,
    blocked,
    /** the doc bar's Export button: why it is off, or null */
    why: blocked ?? (ex.busy ? 'An export is running' : null),
    svg: () => file('SVG', 'svg', 'SVG for Illustrator', `${name} halftone`, () => svgFor(d, { paper: v.svgPaper })),
    // a file for each ink that shows, into one folder: the same dots, in files Illustrator and Figma can open
    svgPerInk: () =>
      ex.run('SVG files', async (report) => {
        let n = 0;
        const folder = await intoFolder('halftone', async (write) => {
          for (const [index, ink] of d.inks.entries()) {
            if (!ink.visible) continue;
            report(n / visible.length, ink.name);
            await write(`${name} ${ink.process ? ink.process.toUpperCase() : index + 1} ${ink.name}.svg`, await svgFor(d, { only: index, paper: v.svgPaper }));
            n++;
          }
          return true;
        });
        return folder ? { path: folder, label: `${plural(n, 'SVG')} into ${leaf(folder)}` } : null;
      }),
    png: () => file('PNG', 'png', 'PNG image', `${name} halftone`, (report) => pngFor(d, pngW, report)),
    copyPng: () => ex.copyPng('PNG', (report) => pngFor(d, pngW, report)),
    // the folder is asked for first and each plate is written as it is made, so no job holds them all
    plates: () =>
      ex.run('separations', async (report) => {
        let n = 0;
        const folder = await intoFolder('halftone', async (write) => {
          await platesFor(
            d,
            v.bits,
            name,
            report,
            async (f) => {
              await write(f.name, f.data);
              n++;
            },
            { marks: v.marks, png: v.plateFile === 'png' },
          );
          return true;
        });
        return folder ? { path: folder, label: `${plural(n, 'plate')} into ${leaf(folder)}` } : null;
      }),
  };
}

export type HalftoneExport = ReturnType<typeof useHalftoneExport>;

export function ExportModule({ d, v, screened, out }: { d: HalftoneDoc; v: HalftoneView; screened: Screened | null; out: HalftoneExport }) {
  const { fm, visible, pngW, pngH, pngProblem, plateProblem, svgWhy } = out;
  const px = printPx(d);
  const weight = screened && !fm ? svgWeight(screened, d) : null;
  const mb = screened && !fm ? svgMegabytes(screened, d) : 0;
  const heavy = mb > SVG_HEAVY_MB;
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
      {heavy && (
        <div className={s.heavy} role="status">
          <span className={cx('lbl', s.heavyText)}>
            <Icon name="warning" size={14} />
            <span>
              About {Math.round(mb)} MB is a lot for Illustrator or Figma to open. {visible.length > 1 ? `A file for each ink averages about ${Math.round(mb / visible.length)} MB.` : 'Lower the frequency or the size to lighten it.'}
            </span>
          </span>
          {visible.length > 1 && (
            <Button size="xs" icon="download" disabled={!!out.blocked || !!out.svgInkWhy || out.ex.busy !== null} onClick={() => void out.svgPerInk()}>
              One SVG per ink
            </Button>
          )}
        </div>
      )}
      <InspectorRow label="Paper" info="Draws the paper as a rectangle at the back of the SVG, to see the inks on their stock. Delete it before print: it would print as a tint.">
        <Toggle label="Paper in the SVG" checked={v.svgPaper && d.paper.include} disabled={!d.paper.include} onChange={(svgPaper) => patchView({ svgPaper })} />
      </InspectorRow>
      <InspectorRow
        label="PNG width"
        pair
        info={`sRGB, as wide as the page prints unless you change it, ${d.paper.include ? 'flat on the paper' : 'clear round the dots'}${d.feel.bake && (d.feel.misregister > 0 || d.feel.texture > 0) ? ', with the print feel' : ''}.`}
      >
        <NumberField label="Width" hideLabel min={16} max={pngMaxWidth(d.size)} unit="px" value={pngW} onChange={(pngWidth) => patchView({ pngWidth })} />
        <span className={s.sizeCell}>
          <span className={cx('val', s.size, pngProblem && s.danger)}>{fmtPx(pngW, pngH)}</span>
          <IconButton icon="restart_alt" label="Match the page's print size" size="sm" disabled={v.pngWidth === null} onClick={() => patchView({ pngWidth: null })} />
        </span>
      </InspectorRow>
      <InspectorRow
        label="Separations"
        info={`${plural(visible.length, 'plate')} at ${d.size.dpi} ppi (${fmtPx(px.w, px.h)}), into one folder. Black is ink.${visible.length < d.inks.length ? ' Hidden inks stay out.' : ''}${coarse ? ` A 1-bit cell holds ${coarse} tones at this dpi.` : ''}`}
      >
        <Segmented fit options={BITS} value={v.bits === 1 ? '1' : '8'} onChange={(b) => patchView({ bits: b === '1' ? 1 : 8 })} />
      </InspectorRow>
      <InspectorRow label="Plate file" info="A TIFF is uncompressed, so a big plate is a big file. A PNG is compressed and its paper is clear, so the plates lay over each other.">
        <Segmented fit options={FILES} value={v.plateFile} onChange={(plateFile) => patchView({ plateFile })} />
      </InspectorRow>
      <InspectorRow label="Marks" info="Each plate on a larger sheet: 3 mm of the edge mirrored as bleed, crop marks at the corners, a registration target on each side and the ink's name below the trim.">
        <Toggle label="Crop and registration marks" checked={v.marks} onChange={(marks) => patchView({ marks })} />
      </InspectorRow>
      {problem && <span className={cx('lbl', s.danger)}>{problem}</span>}
      <LastExport last={v.last} />
    </InspectorGroup>
  );
}
