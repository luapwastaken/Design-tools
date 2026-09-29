// Export (spec §3): the PNG and the indexed PNG with each block exactly the pixel size (or a whole
// multiple of it, or 1 px), the SVG of pixel runs for small pieces, and for an animation its GIF and
// PNG frames, all from the index buffer the view shows, through the shared export paths.
import { useState, type ReactNode } from 'react';
import { saveFile } from '../../lib/export.ts';
import { useShell } from '../../shell/core/index.ts';
import { Button, IconButton, Module, NumberField, Progress, toast, Tooltip } from '../../ui/index.ts';
import { cx } from '../../ui/cx.ts';
import { plural } from '../common/names.ts';
import { gifLimit, isAnimated, loopMs, outSize, scaleOf, used, type DitherDoc } from './doc.ts';
import { framesTo, indexedBlob, indexedLimit, pngBlob, sizeLimit, svgFor, svgLimit } from './exports.ts';
import { patchView, TIMES_MAX, type DitherView } from './view-state.ts';
import s from './Export.module.css';
import i from './Inspector.module.css';

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
const depth = (n: number) => (n <= 2 ? 1 : n <= 4 ? 2 : n <= 16 ? 4 : 8);

type Busy = { what: string; done: number | null; detail?: string; stop?: AbortController };

/** `ready`: the frame on screen is dithered; `error`: why it can't be, which every export waits on */
export function ExportModule({ d, v, frame, ready, error }: { d: DitherDoc; v: DitherView; frame: number; ready: boolean; error: string | null }) {
  const name = useShell((st) => st.docNames.dither) ?? d.source?.name ?? 'Dither';
  const [busy, setBusy] = useState<Busy | null>(null);
  const scale = scaleOf(d, v);
  const out = outSize(d, scale);
  const anim = isAnimated(d);
  const colours = used(d).length;
  // why nothing can go yet; then, for each kind of file, why it can't be this one (its row says so)
  const none = !d.source ? 'Open an image first.' : error;
  const can = busy === null && ready && !none;
  const bigPng = sizeLimit(out.w, out.h);
  const bigIndexed = indexedLimit(out.w, out.h);
  const which = anim ? ` of frame ${frame + 1}` : '';

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
  const file = (what: string, ext: string, filterName: string, data: () => Promise<ArrayBuffer | string>, kind = '') =>
    run(what, async () => {
      const path = await saveFile({ tool: 'dither', suggestedName: `${name} dither${kind}${anim ? ` ${frame + 1}` : ''}`, ext, filterName, data: await data() });
      return path ? { path, label: path.split(/[\\/]/).pop()! } : null;
    });
  const frames = (to: 'gif' | 'folder') =>
    run(
      to === 'gif' ? 'GIF' : 'frames',
      (b) => framesTo(d, scale, to, `${name} dither`, (done, detail) => setBusy({ ...b, done, detail }), b.stop!.signal),
      true,
    );

  const svgWhy = svgLimit(d);
  const gifWhy = gifLimit(d) ?? bigIndexed;
  const loop = d.source && anim ? `${plural(d.source.frames, 'frame')} looping every ${(loopMs(d.source) / 1000).toFixed(2)} s` : '';

  return (
    <Module title="Export" readout={d.source ? `${out.w.toLocaleString('en')} × ${out.h.toLocaleString('en')} px` : undefined}>
      <div className={s.list}>
        <div className={cx(i.row, s.scale)}>
          <NumberField label="Scale" min={1} max={TIMES_MAX} unit="×" width={104} value={v.times || 1} disabled={v.times === 0} onChange={(times) => patchView({ times })} />
          <span className={cx(i.grow, i.note)}>{v.times === 0 ? 'One pixel a block' : `A block is ${scale} px`}</span>
          <Button size="xs" variant={v.times === 0 ? 'secondary' : 'ghost'} onClick={() => patchView({ times: v.times === 0 ? 1 : 0 })} tooltip={v.times === 0 ? 'Back to the pixel size times the scale' : 'One pixel a block: the working image itself, for sprites and textures'}>
            1 px a block
          </Button>
        </div>

        {anim && (
          <Row
            main
            name="GIF"
            desc={gifWhy ?? `${loop}, every frame in and timed so the loop is exact.`}
            action={
              <Button variant="primary" size="lg" icon="download" disabled={!can || !!gifWhy} tooltip={gifWhy ?? none ?? undefined} onClick={() => void frames('gif')}>
                {busy?.what === 'GIF' ? 'Exporting…' : 'Export'}
              </Button>
            }
          />
        )}

        <Row
          main={!anim}
          name="PNG"
          desc={bigPng ?? `RGB${which}, any app opens it; each block ${scale} px.`}
          action={
            <Button variant={anim ? 'secondary' : 'primary'} size={anim ? 'md' : 'lg'} icon="download" disabled={!can || !!bigPng} tooltip={bigPng ?? none ?? undefined} onClick={() => void file('PNG', 'png', 'PNG image', async () => (await pngBlob(d, frame, scale)).arrayBuffer())}>
              {busy?.what === 'PNG' ? 'Exporting…' : 'Export'}
            </Button>
          }
        />

        <Row
          name="Indexed PNG"
          desc={bigIndexed ?? `A true palette file${which}: ${plural(colours, 'colour')} at ${depth(colours)} bit, in the palette’s order.`}
          action={
            <Button icon="download" disabled={!can || !!bigIndexed} tooltip={bigIndexed ?? none ?? undefined} onClick={() => void file('indexed PNG', 'png', 'Indexed PNG', async () => (await indexedBlob(d, frame, scale)).arrayBuffer(), ' indexed')}>
              {busy?.what === 'indexed PNG' ? 'Exporting…' : 'Export'}
            </Button>
          }
        />

        <Row
          name="SVG"
          desc={svgWhy ?? `Runs of blocks${which}, one path per colour, a block ${scale} px.`}
          action={
            <Button icon="download" disabled={!can || !!svgWhy} tooltip={svgWhy ?? none ?? undefined} onClick={() => void file('SVG', 'svg', 'SVG', () => svgFor(d, frame, scale))}>
              {busy?.what === 'SVG' ? 'Exporting…' : 'Export'}
            </Button>
          }
        />

        {anim && (
          <Row
            name="PNG frames"
            desc={bigIndexed ?? `${plural(d.source!.frames, 'numbered PNG')} into one folder, indexed like the file above.`}
            action={
              <Button icon="folder_open" disabled={!can || !!bigIndexed} tooltip={bigIndexed ?? none ?? undefined} onClick={() => void frames('folder')}>
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
