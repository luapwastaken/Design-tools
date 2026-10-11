// Export (spec §3): the Illustrator swatch, a vector artboard and a PNG, every size in a real unit,
// all through the shared export path (lib/export saveFile).
import { artboardProblem, artboardSvg, tileSvg } from '../../../shared/pattern/svg.ts';
import type { Tile } from '../../../shared/pattern/types.ts';
import { saveFile } from '../../lib/export.ts';
import { useShell } from '../../shell/core/index.ts';
import { InspectorGroup, InspectorRow, NumberField, Segmented, Toggle, useDocNumber } from '../../ui/index.ts';
import { cx } from '../../ui/cx.ts';
import { LastExport, useExport } from '../common/Export.tsx';
import { fmtPx } from '../common/names.ts';
import type { Doc } from './actions.ts';
import { LIMIT, lengthIn, presetOf, PX_PER, PRESETS, sideRange, UNIT_STEP, withPreset, type PatternDoc } from './doc.ts';
import { boardPng, tilePng, tooBig } from './raster.ts';
import { UnitSwitch } from './Unit.tsx';
import { patchView, type PatternView } from './view-state.ts';
import s from './Export.module.css';
import i from './Inspector.module.css';

const PRINTS = [
  { value: 'screen' as const, label: 'Screen', tip: 'px at 96 dpi' },
  { value: 'print' as const, label: 'Print', tip: 'mm at 300 dpi' },
];
const PNGS = [
  { value: 'artboard' as const, label: 'Artboard' },
  { value: 'tile' as const, label: 'Tile' },
];

/** the exports, made once: the doc bar's Export menu and the inspector's rows share one runner and one progress */
export function usePatternExport(doc: Doc, d: PatternDoc, tile: Tile, v: PatternView) {
  const name = useShell((st) => st.docNames.pattern) ?? 'Pattern';
  const ex = useExport((last) => patchView({ last }));
  const unit = d.exportUnit;

  // a PNG's pixels: its size on paper at the DPI (1in = 96px of the design)
  const k = d.dpi / 96;
  const board = d.artboard;
  const boardProblem = artboardProblem(tile, board.w, board.h, 'px');
  const pngPx = v.png === 'tile' ? { w: Math.max(1, Math.round(tile.width * k)), h: Math.max(1, Math.round(tile.height * k)) } : { w: Math.max(1, Math.round(board.w * k)), h: Math.max(1, Math.round(board.h * k)) };
  const pngProblem = tooBig(pngPx.w, pngPx.h);

  const save = (what: string, ext: string, filterName: string, make: () => string | Promise<Blob>, suggestedName: string) =>
    ex.file(what, async () => {
      const out = await make();
      return saveFile({ tool: 'pattern', suggestedName, ext, filterName, data: typeof out === 'string' ? out : await out.arrayBuffer() });
    });
  const swatchSvg = () => tileSvg(d, tile, unit, v.expand);
  const artboardMarkup = () => artboardSvg(d, tile, board.w / PX_PER[unit], board.h / PX_PER[unit], unit, v.expand);
  return {
    ex,
    pngPx,
    boardProblem,
    pngProblem,
    swatch: () => save('swatch', 'svg', 'SVG for Illustrator', swatchSvg, `${name} swatch`),
    artboard: () => save('artboard', 'svg', 'SVG', artboardMarkup, name),
    png: () =>
      save('PNG', 'png', 'PNG image', () => (v.png === 'tile' ? tilePng(tileSvg(d, tile, 'px'), { w: tile.width, h: tile.height }, k, d.dpi) : boardPng(d, tile, board, k, d.dpi)), v.png === 'tile' ? `${name} tile` : name),
    copySwatch: () => ex.copySvg('swatch', async () => swatchSvg()),
    copyArtboard: () => ex.copySvg('artboard', async () => artboardMarkup()),
  };
}

export type PatternExport = ReturnType<typeof usePatternExport>;

export function ExportModule({ doc, d, tile, v, out }: { doc: Doc; d: PatternDoc; tile: Tile; v: PatternView; out: PatternExport }) {
  const { pngPx, boardProblem, pngProblem } = out;
  const unit = d.exportUnit;
  const [lo, hi] = sideRange(unit);
  // the artboard is px in the document; its fields are in the export unit
  const aw = useDocNumber(doc, { label: 'Change the artboard width', key: 'artW', get: (x) => x.artboard.w / PX_PER[x.exportUnit], set: (x, w) => ({ ...x, artboard: { ...x.artboard, w: w * PX_PER[x.exportUnit] } }) });
  const ah = useDocNumber(doc, { label: 'Change the artboard height', key: 'artH', get: (x) => x.artboard.h / PX_PER[x.exportUnit], set: (x, h) => ({ ...x, artboard: { ...x.artboard, h: h * PX_PER[x.exportUnit] } }) });
  const dpi = useDocNumber(doc, { label: 'Change the DPI', key: 'dpi', get: (x) => x.dpi, set: (x, n) => ({ ...x, dpi: n }) });

  return (
    <InspectorGroup id="pattern.export" title="Export" meta={`${lengthIn(tile.width, unit)} × ${lengthIn(tile.height, unit)} ${unit}`} actions={<UnitSwitch doc={doc} d={d} className={s.units} />}>
      <InspectorRow label="For" info={`Screen is px at ${PRESETS.screen.dpi} dpi; Print is mm at ${PRESETS.print.dpi} dpi, so a PNG opens at its size on paper. The unit applies to every length in the tool.`}>
        <Segmented fit options={PRINTS} value={presetOf(d) ?? ''} onChange={(p) => p && doc.transact(p === 'print' ? 'Set up for print' : 'Set up for screen', (x) => withPreset(x, p))} />
      </InspectorRow>
      <InspectorRow
        label="Swatch"
        info={`One tile with its offsets baked in. Open the file in Illustrator, select everything and drag it into the Swatches panel: the empty rectangle behind sets the tile, so it repeats exactly.${unit === 'px' ? ' Illustrator counts 72 px to the inch, this tool 96: a px file keeps its pixel size there, while mm and in keep their size on paper.' : ''}`}
      >
        <span className={cx('val', i.dim)}>
          {lengthIn(tile.width, unit)} × {lengthIn(tile.height, unit)} {unit}
        </span>
      </InspectorRow>
      <InspectorRow label="Artboard" info="The artboard SVG is real vector shapes, clipped at its edge, as the view shows it." pair>
        <NumberField label="Width" hideLabel min={lo} max={hi} step={UNIT_STEP[unit]} unit={unit} {...aw} />
        <NumberField label="Height" hideLabel min={lo} max={hi} step={UNIT_STEP[unit]} unit={unit} {...ah} />
      </InspectorRow>
      {boardProblem && <span className={cx('lbl', s.danger)}>Too many shapes for one artboard file</span>}
      <InspectorRow label="SVG" info="Off, each shape is written once as a symbol and placed again and again: a small file, and Illustrator lists the shapes in its Symbols panel. On, every place is a plain group you can select and edit, and the file is bigger.">
        <Toggle label="Expand repeats" checked={v.expand} onChange={(expand) => patchView({ expand })} />
      </InspectorRow>
      <InspectorRow label="PNG of" info="The PNG is written at the DPI, with the DPI in the file so it opens at its size.">
        <Segmented fit options={PNGS} value={v.png} onChange={(png) => patchView({ png })} />
      </InspectorRow>
      <InspectorRow label="Resolution" pair>
        <NumberField label="DPI" hideLabel min={LIMIT.dpi[0]} max={LIMIT.dpi[1]} unit="dpi" {...dpi} />
        <span className={cx('val', i.dim, pngProblem && s.danger)}>
          {fmtPx(pngPx.w, pngPx.h)}
          {pngProblem ? ' · too big' : ''}
        </span>
      </InspectorRow>
      <LastExport last={v.last} />
    </InspectorGroup>
  );
}
