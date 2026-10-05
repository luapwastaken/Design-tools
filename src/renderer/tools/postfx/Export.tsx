// Export (spec §3): the PNG at full resolution with its transparency, and for a clip, a GIF or a
// loop, a GIF and a folder of numbered PNGs through the shared animated path. Every file is the
// stack run at full resolution on the frame it names, as the preview runs it. The doc bar's Export opens
// a menu of them; the inspector's Export group says what each makes, and the running one's progress
// and Cancel are pinned over the inspector (ExportProgress).
import { MAX_FRAMES } from '../../lib/frames.ts';
import { saveFile } from '../../lib/export.ts';
import { useShell } from '../../shell/core/index.ts';
import { cx } from '../../ui/cx.ts';
import { InspectorGroup, InspectorRow } from '../../ui/index.ts';
import s from './Export.module.css';
import { LastExport, useExport } from '../common/Export.tsx';
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

/**
 * The exports, made once: the doc bar's menu runs them, the inspector shows their progress.
 * `error`: why the preview can't be made, which every export waits on.
 */
export function usePostFxExport(d: PostFxDoc, t: Timeline, error: string | null) {
  const name = useShell((st) => st.docNames.postfx) ?? d.source?.name ?? 'Post FX';
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
  return {
    ex,
    anim,
    none,
    big,
    gifWhy,
    gifBytes,
    frame,
    png: () =>
      ex.file('PNG', async (report) => {
        const at = frame();
        const blob = await pngBlob(d, at, report);
        return saveFile({ tool: 'postfx', suggestedName: `${name} fx${anim ? ` ${at + 1}` : ''}`, ext: 'png', filterName: 'PNG image', data: await blob.arrayBuffer() });
      }),
    frames: (to: 'gif' | 'folder') => ex.run(to === 'gif' ? 'GIF' : 'frames', (report, b) => framesTo(d, to, `${name} fx`, report, b.stop!.signal), true),
    copyPng: () => ex.copyPng('PNG', async (report) => (await pngBlob(d, frame(), report)).arrayBuffer()),
  };
}

export type PostFxExport = ReturnType<typeof usePostFxExport>;

/** the doc bar's Export button: why it is off, or null */
export const exportWhy = (out: PostFxExport): string | null => out.big ?? out.none;

export function ExportModule({ d, t, out }: { d: PostFxDoc; t: Timeline; out: PostFxExport }) {
  const v = useView();
  const { anim, big, gifWhy, gifBytes } = out;
  const src = d.source;
  const dim = src ? fmtPx(src.w, src.h) : '';
  const problem = big ?? gifWhy;

  return (
    <InspectorGroup id="postfx.export" title="Export" meta={src ? dim : undefined}>
      {!src ? (
        <span className="lbl">Open an image, a GIF or a clip to export it.</span>
      ) : (
        <>
          <InspectorRow label="PNG" info={`${anim ? 'The frame on screen, at' : 'At'} full resolution with its transparency${isStateful(d) ? `, drawn after the ${RUN_IN} frames before it` : ''}.`}>
            <span className={cx('val', s.val)}>{dim}</span>
          </InspectorRow>
          {anim && (
            <>
              <InspectorRow
                label="GIF"
                info={`The loop timed so it is exact: 256 colours a frame, transparency on or off. Up to about ${size(gifBytes)}${gifBytes > GIF_LIMIT ? ', which is more than a GIF can hold here: export a PNG sequence' : ''}.`}
              >
                <span className={cx('val', s.val)}>
                  {plural(t.count, 'frame')} · {t.seconds.toFixed(2)} s loop
                </span>
              </InspectorRow>
              <InspectorRow label="PNG sequence" info="Numbered PNGs into one folder, full resolution with transparency, for After Effects.">
                <span className={cx('val', s.val)}>{plural(t.count, 'file')}</span>
              </InspectorRow>
            </>
          )}
          {problem && <span className={cx('lbl', s.danger)}>{problem}</span>}
        </>
      )}
      <LastExport last={v.last} />
    </InspectorGroup>
  );
}
