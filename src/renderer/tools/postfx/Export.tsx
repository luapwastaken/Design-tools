// Export (spec §3): the PNG at full resolution with its transparency, and for a clip, a GIF or a
// loop, a GIF and a folder of numbered PNGs through the shared animated path. Every file is the
// stack run at full resolution on the frame it names, as the preview runs it. While one is made its
// progress sits under its own row, in view, with its Cancel.
import { MAX_FRAMES } from '../../lib/frames.ts';
import { saveFile } from '../../lib/export.ts';
import { useShell } from '../../shell/core/index.ts';
import { Module } from '../../ui/index.ts';
import { CopyButton, ExportButton, ExportList, ExportRow, LastExport, useExport } from '../common/Export.tsx';
import { fmtPx, plural } from '../common/names.ts';
import { isStateful, RUN_IN, type PostFxDoc, type Timeline } from './doc.ts';
import { framesTo, pngBlob, sizeLimit } from './exports.ts';
import { gifPlan, type GifPlan } from './media-time.ts';
import { patchView, pausedFrame, playhead, useView } from './view-state.ts';

/** a GIF frame is at most about this many bytes a pixel (grain, the worst case, measured at 0.29), so a GIF's size is up to this */
const GIF_BYTES_PX = 0.3;
/** a GIF past this can't be built in memory here (the failures were near 2 GB) */
const GIF_LIMIT = 1.5e9;
const size = (bytes: number) => (bytes >= 1e9 ? `${(bytes / 1e9).toFixed(1)} GB` : `${Math.max(1, Math.round(bytes / 1e6))} MB`);

/** `error`: why the preview can't be made, which every export waits on */
export function ExportModule({ d, t, error }: { d: PostFxDoc; t: Timeline; error: string | null }) {
  const name = useShell((st) => st.docNames.postfx) ?? d.source?.name ?? 'Post FX';
  const v = useView();
  const ex = useExport((last) => patchView({ last }));
  const src = d.source;
  const anim = t.count > 1;
  const none = !src ? 'Open an image first.' : error;
  const big = src ? sizeLimit(src) : null;

  let gifWhy: string | null = null;
  let plan: GifPlan | null = null;
  try {
    if (anim) plan = gifPlan(t, MAX_FRAMES);
  } catch (e) {
    gifWhy = e instanceof Error ? e.message : String(e);
  }
  const gifBytes = plan && src ? plan.frames.length * src.w * src.h * GIF_BYTES_PX : 0;

  // the frame the view is paused on, so the file is what the preview showed
  const frame = () => (playhead.get().playing ? playhead.get().frame : pausedFrame(t));
  const png = () =>
    ex.file('PNG', async (report) => {
      const at = frame();
      const blob = await pngBlob(d, at, report);
      return saveFile({ tool: 'postfx', suggestedName: `${name} fx${anim ? ` ${at + 1}` : ''}`, ext: 'png', filterName: 'PNG image', data: await blob.arrayBuffer() });
    });
  const frames = (to: 'gif' | 'folder') =>
    ex.run(to === 'gif' ? 'GIF' : 'frames', (report, b) => framesTo(d, to, `${name} fx`, report, b.stop!.signal), true);

  const pass = `${plural(t.count, 'frame')} looping every ${t.seconds.toFixed(2)} s`;
  const dim = src ? fmtPx(src.w, src.h) : '';

  return (
    <Module title="Export" readout={src ? dim : undefined}>
      <ExportList>
        {anim && (
          <ExportRow
            main
            name="GIF"
            desc={
              gifWhy ??
              big ??
              `${pass}, timed so the loop is exact. 256 colours a frame; transparency is on or off. Up to about ${size(gifBytes)}${gifBytes > GIF_LIMIT ? `, which is more than a GIF can hold here: export a PNG sequence` : ''}.`
            }
            action={<ExportButton ex={ex} what="GIF" lead why={gifWhy ?? big ?? none} onClick={() => void frames('gif')} />}
            {...ex.live('GIF')}
          />
        )}

        <ExportRow
          main={!anim}
          name="PNG"
          desc={big ?? (src ? `${anim ? 'The frame on screen, at' : 'At'} full resolution, ${dim}, with its transparency${isStateful(d) ? `, drawn after the ${RUN_IN} frames before it` : ''}.` : 'Open an image, a GIF or a clip to export it.')}
          action={<ExportButton ex={ex} what="PNG" lead={!anim} why={big ?? none} onClick={() => void png()} />}
          copy={<CopyButton ex={ex} what="PNG" lead={!anim} why={big ?? none} onClick={() => void ex.copyPng('PNG', async (report) => (await pngBlob(d, frame(), report)).arrayBuffer())} />}
          {...ex.live('PNG')}
        />

        {anim && (
          <ExportRow
            name="PNG sequence"
            desc={big ?? `${plural(t.count, 'numbered PNG')} into one folder, full resolution with transparency, for After Effects.`}
            action={<ExportButton ex={ex} what="frames" folder why={big ?? none} onClick={() => void frames('folder')} />}
            {...ex.live('frames')}
          />
        )}
      </ExportList>
      <LastExport last={v.last} />
    </Module>
  );
}
