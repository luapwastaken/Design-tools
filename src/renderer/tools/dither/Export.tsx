// Export (spec §3): the PNG and the indexed PNG with each block exactly the pixel size (or a whole
// multiple of it, or 1 px), the SVG of pixel runs for small pieces, and for an animation its GIF and
// PNG frames, all from the index buffer the view shows, through the shared export paths.
import { saveFile } from '../../lib/export.ts';
import { useShell } from '../../shell/core/index.ts';
import { Button, Module, NumberField } from '../../ui/index.ts';
import { cx } from '../../ui/cx.ts';
import { CopyButton, ExportButton, ExportList, ExportRow, LastExport, useExport } from '../common/Export.tsx';
import { fmtPx, plural } from '../common/names.ts';
import { gifLimit, isAnimated, loopMs, outSize, scaleOf, used, type DitherDoc } from './doc.ts';
import { framesTo, indexedBlob, indexedLimit, pngBlob, sizeLimit, svgFor, svgLimit } from './exports.ts';
import { patchView, TIMES_MAX, type DitherView } from './view-state.ts';
import s from './Export.module.css';
import i from './Inspector.module.css';

const depth = (n: number) => (n <= 2 ? 1 : n <= 4 ? 2 : n <= 16 ? 4 : 8);

/** `ready`: the frame on screen is dithered; `error`: why it can't be, which every export waits on */
export function ExportModule({ d, v, frame, ready, error }: { d: DitherDoc; v: DitherView; frame: number; ready: boolean; error: string | null }) {
  const name = useShell((st) => st.docNames.dither) ?? d.source?.name ?? 'Dither';
  const ex = useExport((last) => patchView({ last }));
  const scale = scaleOf(d, v);
  const out = outSize(d, scale);
  const anim = isAnimated(d);
  const colours = used(d).length;
  // why nothing can go yet; then, for each kind of file, why it can't be this one (its row says so)
  const none = !d.source ? 'Open an image first.' : error;
  const bigPng = sizeLimit(out.w, out.h);
  const bigIndexed = indexedLimit(out.w, out.h);
  const which = anim ? ` of frame ${frame + 1}` : '';

  const file = (what: string, ext: string, filterName: string, data: () => Promise<ArrayBuffer | string>, kind = '') =>
    ex.file(what, async () => saveFile({ tool: 'dither', suggestedName: `${name} dither${kind}${anim ? ` ${frame + 1}` : ''}`, ext, filterName, data: await data() }));
  const png = async () => (await pngBlob(d, frame, scale)).arrayBuffer();
  const frames = (to: 'gif' | 'folder') =>
    ex.run(to === 'gif' ? 'GIF' : 'frames', (report, b) => framesTo(d, scale, to, `${name} dither`, report, b.stop!.signal), true);

  const svgWhy = svgLimit(d);
  const gifWhy = gifLimit(d) ?? bigIndexed;
  const loop = d.source && anim ? `${plural(d.source.frames, 'frame')} looping every ${(loopMs(d.source) / 1000).toFixed(2)} s` : '';

  return (
    <Module title="Export" readout={d.source ? fmtPx(out.w, out.h) : undefined}>
      <ExportList>
        <div className={cx(i.row, s.scale)}>
          <NumberField label="Scale" min={1} max={TIMES_MAX} unit="×" width={104} value={v.times || 1} disabled={v.times === 0} onChange={(times) => patchView({ times })} />
          <span className={cx(i.grow, i.note)}>{v.times === 0 ? 'One pixel a block' : `A block is ${scale} px`}</span>
          <Button size="xs" variant={v.times === 0 ? 'secondary' : 'ghost'} onClick={() => patchView({ times: v.times === 0 ? 1 : 0 })} tooltip={v.times === 0 ? 'Back to the pixel size times the scale' : 'One pixel a block: the working image itself, for sprites and textures'}>
            1 px a block
          </Button>
        </div>

        {anim && (
          <ExportRow
            main
            name="GIF"
            desc={gifWhy ?? `${loop}, every frame in and timed so the loop is exact.`}
            action={<ExportButton ex={ex} what="GIF" lead disabled={!ready} why={gifWhy ?? none} onClick={() => void frames('gif')} />}
            {...ex.live('GIF')}
          />
        )}

        <ExportRow
          main={!anim}
          name="PNG"
          desc={bigPng ?? `RGB${which}, any app opens it; each block ${scale} px.`}
          action={
            <ExportButton ex={ex} what="PNG" lead={!anim} disabled={!ready} why={bigPng ?? none} onClick={() => void file('PNG', 'png', 'PNG image', png)} />
          }
          copy={<CopyButton ex={ex} what="PNG" lead={!anim} disabled={!ready} why={bigPng ?? none} onClick={() => void ex.copyPng('PNG', png)} />}
        />

        <ExportRow
          name="Indexed PNG"
          desc={bigIndexed ?? `A true palette file${which}: ${plural(colours, 'colour')} at ${depth(colours)} bit, in the palette’s order.`}
          action={
            <ExportButton ex={ex} what="indexed PNG" disabled={!ready} why={bigIndexed ?? none} onClick={() => void file('indexed PNG', 'png', 'Indexed PNG', async () => (await indexedBlob(d, frame, scale)).arrayBuffer(), ' indexed')} />
          }
        />

        <ExportRow
          name="SVG"
          desc={svgWhy ?? `Runs of blocks${which}, one path per colour, a block ${scale} px.`}
          action={<ExportButton ex={ex} what="SVG" disabled={!ready} why={svgWhy ?? none} onClick={() => void file('SVG', 'svg', 'SVG', () => svgFor(d, frame, scale))} />}
        />

        {anim && (
          <ExportRow
            name="PNG frames"
            desc={bigIndexed ?? `${plural(d.source!.frames, 'numbered PNG')} into one folder, indexed like the file above.`}
            action={<ExportButton ex={ex} what="frames" folder disabled={!ready} why={bigIndexed ?? none} onClick={() => void frames('folder')} />}
            {...ex.live('frames')}
          />
        )}
      </ExportList>
      <LastExport last={v.last} />
    </Module>
  );
}
