// The transport for animated input (plan unit V): play and pause (also a quick tap of Space, spec
// §9), step, scrub to a frame, and the frame rate. Where the playhead is stays out of history.
import { useRef } from 'react';
import { decodeFrames } from '../../lib/frames.ts';
import { IconButton, NumberField, Slider, toast, useDocNumber } from '../../ui/index.ts';
import { cx } from '../../ui/cx.ts';
import { useSpaceTap } from '../common/spaceTap.ts';
import { fetchBlob } from '../common/take.ts';
import type { Doc } from './actions.ts';
import { fix, LIMIT, loopMs, type DitherDoc } from './doc.ts';
import { made, madeCount } from './pipeline.ts';
import { playhead } from './view-state.ts';
import s from './Transport.module.css';

export const stepFrame = (d: DitherDoc, by: number): void => {
  const n = d.source?.frames ?? 1;
  playhead.set({ frame: (playhead.get().frame + by + n) % n, playing: false });
};

export const togglePlay = (): void => playhead.set({ ...playhead.get(), playing: !playhead.get().playing });

export function Transport({ doc, d, frame, playing, active }: { doc: Doc; d: DitherDoc; frame: number; playing: boolean; active: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  useSpaceTap(ref, active, togglePlay);
  made.use();
  const src = d.source!;
  const fps = useDocNumber(doc, {
    label: 'Change the frame rate',
    key: 'fps',
    get: (x) => x.source?.fps ?? 1,
    // a rate of your own replaces a GIF's own timing
    set: (x, v) => (x.source ? fix({ ...x, source: { ...x.source, fps: v, delays: null } }) : x),
  });
  const ready = madeCount(d);
  const seek = (v: number) => playhead.set({ frame: Math.round(v) - 1, playing: false });
  // a GIF whose own timing a rate replaced: its file still has it
  const gif = src.assets.length === 1 && !src.delays;
  const ownTiming = async () => {
    try {
      const f = await decodeFrames(await fetchBlob(src.assets[0], src.name));
      f.close();
      if (!f.delays || f.delays.length !== src.frames) return;
      doc.transact('Use the GIF’s own timing', (x) => (x.source ? { ...x, source: { ...x.source, delays: f.delays } } : x));
    } catch (e) {
      toast.show({ kind: 'error', message: `Couldn't read the GIF’s timing: ${e instanceof Error ? e.message : String(e)}` });
    }
  };
  return (
    <div ref={ref} className={s.transport} role="group" aria-label="Playback">
      <IconButton icon={playing ? 'pause' : 'play_arrow'} label={playing ? 'Pause' : 'Play'} shortcut="Space" latched={playing} onClick={togglePlay} />
      {/* the arrow keys step too; a kbd would print their DOM names, so the label says them */}
      <IconButton icon="skip_previous" label="Previous frame (Left arrow)" size="sm" onClick={() => stepFrame(d, -1)} />
      <IconButton icon="skip_next" label="Next frame (Right arrow)" size="sm" onClick={() => stepFrame(d, 1)} />
      <Slider label="Frame" min={1} max={src.frames} step={1} value={frame + 1} fieldWidth={64} className={s.scrub} onChange={seek} />
      <span className={s.of}>of {src.frames}</span>
      <span className={s.sep} />
      <NumberField label="FPS" min={LIMIT.fps[0]} max={LIMIT.fps[1]} step={1} width={86} {...fps} />
      {src.delays ? <span className={s.own}>own timing</span> : gif && <IconButton icon="history" label="Use the GIF’s own timing again" size="sm" onClick={() => void ownTiming()} />}
      <span className={cx(s.readout, ready < src.frames && s.dim)}>
        {ready < src.frames ? (
          <>
            <b>{ready}</b> of {src.frames} made
          </>
        ) : (
          <>
            loop <b>{(loopMs(src) / 1000).toFixed(2)}</b> s
          </>
        )}
      </span>
    </div>
  );
}
