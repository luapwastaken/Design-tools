// Export (spec §3): the PNG and the indexed PNG with each block exactly the pixel size (or a whole
// multiple of it, or 1 px), the SVG of pixel runs for small pieces, and for an animation its GIF and
// PNG frames, all from the index buffer the view shows, through the shared export paths. The doc
// bar's Export menu runs them; the inspector's group holds the scale they share.
import { saveFile } from '../../lib/export.ts';
import { useShell } from '../../shell/core/index.ts';
import { InspectorGroup, InspectorRow, NumberField, Toggle } from '../../ui/index.ts';
import { cx } from '../../ui/cx.ts';
import { LastExport, useExport } from '../common/Export.tsx';
import { fmtPx, plural } from '../common/names.ts';
import { gifLimit, isAnimated, loopMs, outSize, scaleOf, used, type DitherDoc } from './doc.ts';
import { framesTo, indexedBlob, indexedLimit, pngBlob, sizeLimit, svgFor, svgLimit } from './exports.ts';
import { patchView, TIMES_MAX, type DitherView } from './view-state.ts';
import s from './Export.module.css';
import i from './Inspector.module.css';

const depth = (n: number) => (n <= 2 ? 1 : n <= 4 ? 2 : n <= 16 ? 4 : 8);

/**
 * The exports, made once: the doc bar's Export menu runs them, the inspector group holds the scale they
 * share and says what each makes. `ready`: the frame on screen is dithered; `error`: why it can't be,
 * which every export waits on.
 */
export function useDitherExport(d: DitherDoc, v: DitherView, frame: number, ready: boolean, error: string | null) {
  const name = useShell((st) => st.docNames.dither) ?? d.source?.name ?? 'Dither';
  const ex = useExport((last) => patchView({ last }));
  const scale = scaleOf(d, v);
  const size = outSize(d, scale);
  const anim = isAnimated(d);
  // why nothing can go yet; then, for each kind of file, why it can't be this one
  const none = !d.source ? 'Open an image first.' : !ready ? (error ?? 'Still dithering.') : null;
  const bigPng = sizeLimit(size.w, size.h);
  const bigIndexed = indexedLimit(size.w, size.h);
  const svgWhy = svgLimit(d);
  const gifWhy = gifLimit(d) ?? bigIndexed;

  const file = (what: string, ext: string, filterName: string, data: () => Promise<ArrayBuffer | string>, kind = '') =>
    ex.file(what, async () => saveFile({ tool: 'dither', suggestedName: `${name} dither${kind}${anim ? ` ${frame + 1}` : ''}`, ext, filterName, data: await data() }));
  const png = async () => (await pngBlob(d, frame, scale)).arrayBuffer();
  const frames = (to: 'gif' | 'folder') => ex.run(to === 'gif' ? 'GIF' : 'frames', (report, b) => framesTo(d, scale, to, `${name} dither`, report, b.stop!.signal), true);
  return {
    ex,
    scale,
    size,
    anim,
    none,
    bigPng,
    bigIndexed,
    svgWhy,
    gifWhy,
    /** the doc bar's Export button: why it is off, or null */
    why: none ?? (ex.busy ? 'An export is running' : null),
    png: () => file('PNG', 'png', 'PNG image', png),
    indexed: () => file('indexed PNG', 'png', 'Indexed PNG', async () => (await indexedBlob(d, frame, scale)).arrayBuffer(), ' indexed'),
    svg: () => file('SVG', 'svg', 'SVG', () => svgFor(d, frame, scale)),
    gif: () => frames('gif'),
    folder: () => frames('folder'),
    copyPng: () => ex.copyPng('PNG', png),
  };
}

export type DitherExport = ReturnType<typeof useDitherExport>;

export function ExportModule({ d, v, frame, out }: { d: DitherDoc; v: DitherView; frame: number; out: DitherExport }) {
  const { scale, size, anim, bigPng, bigIndexed, svgWhy, gifWhy } = out;
  const colours = used(d).length;
  const which = anim ? ` of frame ${frame + 1}` : '';
  const loop = d.source && anim ? `${plural(d.source.frames, 'frame')} looping every ${(loopMs(d.source) / 1000).toFixed(2)} s` : '';
  const problem = bigPng ?? bigIndexed ?? svgWhy ?? gifWhy;

  return (
    <InspectorGroup id="dither.export" title="Export" meta={d.source ? fmtPx(size.w, size.h) : undefined}>
      <InspectorRow label="Scale" info="Every file draws each block this many pixels square: the pixel size times the scale.">
        <NumberField label="Scale" hideLabel min={1} max={TIMES_MAX} unit="×" width={96} value={v.times || 1} disabled={v.times === 0} onChange={(times) => patchView({ times })} />
        <span className={cx(i.grow, i.note)}>{v.times === 0 ? 'One pixel a block' : `A block is ${scale} px`}</span>
      </InspectorRow>
      <InspectorRow label="1 px a block" info="The working image itself, one pixel a block: for sprites and textures.">
        <Toggle label="1 px a block" checked={v.times === 0} onChange={(on) => patchView({ times: on ? 0 : 1 })} />
      </InspectorRow>
      {d.source && (
        <>
          <InspectorRow label="PNG" info={`RGB${which}, any app opens it; each block ${scale} px.`}>
            <span className={cx('val', s.val)}>{fmtPx(size.w, size.h)}</span>
          </InspectorRow>
          <InspectorRow label="Indexed PNG" info={`A true palette file${which}: ${plural(colours, 'colour')} at ${depth(colours)} bit, in the palette’s order.`}>
            <span className={cx('val', s.val)}>{plural(colours, 'colour')}</span>
          </InspectorRow>
          <InspectorRow label="SVG" info={`Runs of blocks${which}, one path per colour, a block ${scale} px.`}>
            <span className={cx('val', s.val)}>{svgWhy ? 'Too large' : 'Vector runs'}</span>
          </InspectorRow>
          {anim && (
            <InspectorRow label="GIF" info={`${loop}. Every frame in, timed so the loop is exact. PNG frames are numbered PNGs into one folder, indexed like the Indexed PNG.`}>
              <span className={cx('val', s.val)}>{plural(d.source.frames, 'frame')}</span>
            </InspectorRow>
          )}
        </>
      )}
      {problem && <span className={cx('lbl', s.danger)}>{problem}</span>}
      <LastExport last={v.last} />
    </InspectorGroup>
  );
}
