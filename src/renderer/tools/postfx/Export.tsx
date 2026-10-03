// Export (spec §3): the PNG at full resolution with its transparency, and for a clip, a GIF or a
// loop, a GIF and a folder of numbered PNGs through the shared animated path. Every file is the
// stack run at full resolution on the frame it names, as the preview runs it. While one is made its
// progress sits under its own row, in view, with its Cancel.
import { useEffect, useRef, useState, type ReactNode, type RefObject } from 'react';
import { MAX_FRAMES } from '../../lib/frames.ts';
import { keepAwake, saveFile } from '../../lib/export.ts';
import { useShell } from '../../shell/core/index.ts';
import { Button, IconButton, Module, Progress, toast, Tooltip } from '../../ui/index.ts';
import { cx } from '../../ui/cx.ts';
import { plural } from '../common/names.ts';
import { isStateful, RUN_IN, type PostFxDoc, type Timeline } from './doc.ts';
import { framesTo, pngBlob, sizeLimit } from './exports.ts';
import { gifPlan, type GifPlan } from './media-time.ts';
import { patchView, pausedFrame, playhead, useView } from './view-state.ts';
import s from './Export.module.css';

type RowProps = { name: string; desc: ReactNode; action: ReactNode; main?: boolean; /** its progress, while it runs */ live?: ReactNode; liveRef?: RefObject<HTMLDivElement | null> };

function Row({ name, desc, action, main, live, liveRef }: RowProps) {
  return (
    <div className={cx(s.item, main && s.main)}>
      <div className={s.text}>
        <b className={s.name}>{name}</b>
        <p className={s.desc}>{desc}</p>
      </div>
      {action}
      {live && (
        <div ref={liveRef} className={s.live}>
          {live}
        </div>
      )}
    </div>
  );
}

const clock = (at: number) => new Date(at).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });

type Busy = { what: string; done: number | null; detail?: string; stop?: AbortController };

/** how long the rest should take, from how long the part done took (said once it is a fair guess) */
function left(began: number, done: number): string {
  const spent = (Date.now() - began) / 1000;
  if (spent < 3 || done < 0.02 || done >= 1) return '';
  const sec = Math.round((spent * (1 - done)) / done);
  return ` · about ${sec < 90 ? `${Math.max(5, Math.round(sec / 5) * 5)} s` : `${Math.round(sec / 60)} min`} left`;
}

/** a GIF frame is at most about this many bytes a pixel (grain, the worst case, measured at 0.29), so a GIF's size is up to this */
const GIF_BYTES_PX = 0.3;
/** a GIF past this can't be built in memory here (the failures were near 2 GB) */
const GIF_LIMIT = 1.5e9;
const size = (bytes: number) => (bytes >= 1e9 ? `${(bytes / 1e9).toFixed(1)} GB` : `${Math.max(1, Math.round(bytes / 1e6))} MB`);

/** `error`: why the preview can't be made, which every export waits on */
export function ExportModule({ d, t, error }: { d: PostFxDoc; t: Timeline; error: string | null }) {
  const name = useShell((st) => st.docNames.postfx) ?? d.source?.name ?? 'Post FX';
  const v = useView();
  const [busy, setBusy] = useState<Busy | null>(null);
  const live = useRef<HTMLDivElement>(null);
  const src = d.source;
  const anim = t.count > 1;
  const none = !src ? 'Open an image first.' : error;
  const can = busy === null && !none;
  const big = src ? sizeLimit(src) : null;

  let gifWhy: string | null = null;
  let plan: GifPlan | null = null;
  try {
    if (anim) plan = gifPlan(t, MAX_FRAMES);
  } catch (e) {
    gifWhy = e instanceof Error ? e.message : String(e);
  }
  const gifBytes = plan && src ? plan.frames.length * src.w * src.h * GIF_BYTES_PX : 0;

  // its progress comes into view when it first shows: it sits under the row that was pressed
  const showing = busy !== null && busy.done !== null;
  useEffect(() => {
    if (showing) live.current?.scrollIntoView({ block: 'nearest' });
  }, [showing, busy?.what]);

  const run = async (what: string, make: (progress: (done: number, detail?: string) => void, b: Busy) => Promise<{ path: string; label: string } | null>, stoppable = false) => {
    const b: Busy = { what, done: null, stop: stoppable ? new AbortController() : undefined };
    const began = Date.now();
    setBusy(b);
    try {
      // a window hidden or minimised meanwhile keeps its speed
      const got = await keepAwake(() => make((done, detail) => setBusy({ ...b, done, detail: detail && `${detail}${left(began, done)}` }), b));
      if (!got) return;
      patchView({ last: { name: got.label, path: got.path, at: Date.now() } });
      toast.show({ icon: 'download', message: `Exported ${got.label}.` });
    } catch (e) {
      toast.show({ kind: 'error', message: `Couldn't make the ${what}: ${e instanceof Error ? e.message : String(e)}` });
    } finally {
      setBusy(null);
    }
  };
  // the frame the view is paused on, so the file is what the preview showed
  const frame = () => (playhead.get().playing ? playhead.get().frame : pausedFrame(t));
  const png = () =>
    run('PNG', async (progress) => {
      const at = frame();
      const blob = await pngBlob(d, at, progress);
      const path = await saveFile({ tool: 'postfx', suggestedName: `${name} fx${anim ? ` ${at + 1}` : ''}`, ext: 'png', filterName: 'PNG image', data: await blob.arrayBuffer() });
      return path ? { path, label: path.split(/[\\/]/).pop()! } : null;
    });
  const frames = (to: 'gif' | 'folder') =>
    run(to === 'gif' ? 'GIF' : 'frames', (progress, b) => framesTo(d, to, `${name} fx`, progress, b.stop!.signal), true);

  const pass = `${plural(t.count, 'frame')} looping every ${t.seconds.toFixed(2)} s`;
  const dim = src ? `${src.w.toLocaleString('en')} × ${src.h.toLocaleString('en')} px` : '';
  const meter = (what: string) =>
    busy?.what === what && busy.done !== null ? <Progress label={`Making the ${what}`} value={busy.done} detail={busy.detail} onCancel={busy.stop ? () => busy.stop!.abort() : undefined} /> : undefined;
  const ref = (what: string) => (busy?.what === what ? live : undefined);

  return (
    <Module title="Export" readout={src ? dim : undefined}>
      <div className={s.list}>
        {anim && (
          <Row
            main
            name="GIF"
            desc={
              gifWhy ??
              big ??
              `${pass}, timed so the loop is exact. 256 colours a frame; transparency is on or off. Up to about ${size(gifBytes)}${gifBytes > GIF_LIMIT ? `, which is more than a GIF can hold here: export a PNG sequence` : ''}.`
            }
            action={
              <Button variant="primary" size="lg" icon="download" disabled={!can || !!gifWhy || !!big} tooltip={gifWhy ?? big ?? none ?? undefined} onClick={() => void frames('gif')}>
                {busy?.what === 'GIF' ? 'Exporting…' : 'Export'}
              </Button>
            }
            live={meter('GIF')}
            liveRef={ref('GIF')}
          />
        )}

        <Row
          main={!anim}
          name="PNG"
          desc={big ?? (src ? `${anim ? 'The frame on screen, at' : 'At'} full resolution, ${dim}, with its transparency${isStateful(d) ? `, drawn after the ${RUN_IN} frames before it` : ''}.` : 'Open an image, a GIF or a clip to export it.')}
          action={
            <Button variant={anim ? 'secondary' : 'primary'} size={anim ? 'md' : 'lg'} icon="download" disabled={!can || !!big} tooltip={big ?? none ?? undefined} onClick={() => void png()}>
              {busy?.what === 'PNG' ? 'Exporting…' : 'Export'}
            </Button>
          }
          live={meter('PNG')}
          liveRef={ref('PNG')}
        />

        {anim && (
          <Row
            name="PNG sequence"
            desc={big ?? `${plural(t.count, 'numbered PNG')} into one folder, full resolution with transparency, for After Effects.`}
            action={
              <Button icon="folder_open" disabled={!can || !!big} tooltip={big ?? none ?? undefined} onClick={() => void frames('folder')}>
                {busy?.what === 'frames' ? 'Exporting…' : 'Export…'}
              </Button>
            }
            live={meter('frames')}
            liveRef={ref('frames')}
          />
        )}
      </div>
      {v.last && (
        <div className={s.last}>
          <span className="lbl">Last export</span>
          <Tooltip overflowOnly>
            <span className={s.lastName}>{v.last.name}</span>
          </Tooltip>
          <span className={s.lastAt}>{clock(v.last.at)}</span>
          <IconButton icon="folder_open" label="Show in Explorer" size="xs" onClick={() => void window.api.invoke('shell.reveal', v.last!.path).catch(() => toast.show({ kind: 'error', message: `${v.last!.name} isn't there any more.` }))} />
        </div>
      )}
    </Module>
  );
}
