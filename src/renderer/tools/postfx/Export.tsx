// Export (spec §3): the PNG at full resolution with its transparency, and for a clip, a GIF or a
// loop, a GIF and a folder of numbered PNGs through the shared animated path. Every file is the
// stack run at full resolution on the frame it names, as the preview runs it.
import { useState, type ReactNode } from 'react';
import { MAX_FRAMES } from '../../lib/frames.ts';
import { saveFile } from '../../lib/export.ts';
import { useShell } from '../../shell/core/index.ts';
import { Button, IconButton, Module, Progress, toast, Tooltip } from '../../ui/index.ts';
import { cx } from '../../ui/cx.ts';
import { plural } from '../common/names.ts';
import { frameAt, type PostFxDoc, type Timeline } from './doc.ts';
import { framesTo, pngBlob, sizeLimit } from './exports.ts';
import { gifPlan } from './media-time.ts';
import { patchView, playhead, useView } from './view-state.ts';
import s from './Export.module.css';

function Row({ name, desc, action, main }: { name: string; desc: ReactNode; action: ReactNode; main?: boolean }) {
  return (
    <div className={cx(s.item, main && s.main)}>
      <div className={s.text}>
        <b className={s.name}>{name}</b>
        <p className={s.desc}>{desc}</p>
      </div>
      {action}
    </div>
  );
}

const clock = (at: number) => new Date(at).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });

type Busy = { what: string; done: number | null; detail?: string; stop?: AbortController };

/** `error`: why the preview can't be made, which every export waits on */
export function ExportModule({ d, t, error }: { d: PostFxDoc; t: Timeline; error: string | null }) {
  const name = useShell((st) => st.docNames.postfx) ?? d.source?.name ?? 'Post FX';
  const v = useView();
  const [busy, setBusy] = useState<Busy | null>(null);
  const src = d.source;
  const anim = t.count > 1;
  const none = !src ? 'Open an image first.' : error;
  const can = busy === null && !none;
  const big = src ? sizeLimit(src) : null;

  let gifWhy: string | null = null;
  try {
    if (anim) gifPlan(t, MAX_FRAMES);
  } catch (e) {
    gifWhy = e instanceof Error ? e.message : String(e);
  }

  const run = async (what: string, make: (b: Busy) => Promise<{ path: string; label: string } | null>, stoppable = false) => {
    const b: Busy = { what, done: null, stop: stoppable ? new AbortController() : undefined };
    setBusy(b);
    try {
      const got = await make(b);
      if (!got) return;
      patchView({ last: { name: got.label, path: got.path, at: Date.now() } });
      toast.show({ icon: 'download', message: `Exported ${got.label}.` });
    } catch (e) {
      toast.show({ kind: 'error', message: `Couldn't make the ${what}: ${e instanceof Error ? e.message : String(e)}` });
    } finally {
      setBusy(null);
    }
  };
  // the frame the view is paused on: the document's, so the file is what the preview showed
  const frame = () => (playhead.get().playing ? playhead.get().frame : frameAt(t, d.time));
  const png = () =>
    run('PNG', async () => {
      const at = frame();
      const blob = await pngBlob(d, at);
      const path = await saveFile({ tool: 'postfx', suggestedName: `${name} fx${anim ? ` ${at + 1}` : ''}`, ext: 'png', filterName: 'PNG image', data: await blob.arrayBuffer() });
      return path ? { path, label: path.split(/[\\/]/).pop()! } : null;
    });
  const frames = (to: 'gif' | 'folder') =>
    run(to === 'gif' ? 'GIF' : 'frames', (b) => framesTo(d, to, `${name} fx`, (done, detail) => setBusy({ ...b, done, detail }), b.stop!.signal), true);

  const pass = `${plural(t.count, 'frame')} looping every ${t.seconds.toFixed(2)} s`;
  const size = src ? `${src.w.toLocaleString('en')} × ${src.h.toLocaleString('en')} px` : '';

  return (
    <Module title="Export" readout={src ? size : undefined}>
      <div className={s.list}>
        {anim && (
          <Row
            main
            name="GIF"
            desc={gifWhy ?? big ?? `${pass}, timed so the loop is exact. 256 colours a frame; transparency is on or off.`}
            action={
              <Button variant="primary" size="lg" icon="download" disabled={!can || !!gifWhy || !!big} tooltip={gifWhy ?? big ?? none ?? undefined} onClick={() => void frames('gif')}>
                {busy?.what === 'GIF' ? 'Exporting…' : 'Export'}
              </Button>
            }
          />
        )}

        <Row
          main={!anim}
          name="PNG"
          desc={big ?? (src ? `${anim ? 'The frame on screen, at' : 'At'} full resolution, ${size}, with its transparency.` : 'Open an image, a GIF or a clip to export it.')}
          action={
            <Button variant={anim ? 'secondary' : 'primary'} size={anim ? 'md' : 'lg'} icon="download" disabled={!can || !!big} tooltip={big ?? none ?? undefined} onClick={() => void png()}>
              {busy?.what === 'PNG' ? 'Exporting…' : 'Export'}
            </Button>
          }
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
          />
        )}

        {busy && busy.done !== null && <Progress label={`Making the ${busy.what}`} value={busy.done} detail={busy.detail} onCancel={busy.stop ? () => busy.stop!.abort() : undefined} />}
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
