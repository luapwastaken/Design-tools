// The transport (plan unit V), a cluster in the view strip, for a clip, a GIF or a still's loop: play and pause (also a quick tap of
// Space, foundation spec §9), step, and scrub. Nothing plays until you press play (spec §5 q3), and
// a pause, a step or a scrub leaves the frame in the view, so it is what shows and exports.
import { useRef } from 'react';
import { IconButton, Slider } from '../../ui/index.ts';
import { cx } from '../../ui/cx.ts';
import { useSpaceTap } from '../common/spaceTap.ts';
import { startOf, type Timeline } from './doc.ts';
import { pausedFrame, patchView, playhead } from './view-state.ts';
import s from './Transport.module.css';

/** the frame on screen kept as the paused one (the view's time, never a step of history: Undo stays with the edits) */
export function holdFrame(t: Timeline, frame: number): void {
  const at = Math.min(t.count - 1, Math.max(0, frame));
  playhead.set({ frame: at, playing: false });
  if (pausedFrame(t) !== at) patchView({ time: startOf(t, at) });
}

export function togglePlay(t: Timeline): void {
  const { frame, playing } = playhead.get();
  if (t.count < 2) return;
  if (playing) holdFrame(t, frame);
  else playhead.set({ frame, playing: true });
}

export const stepFrame = (t: Timeline, by: number): void => holdFrame(t, (playhead.get().frame + by + t.count) % t.count);


const clock = (sec: number) => `${Math.floor(sec / 60)}:${(sec % 60).toFixed(2).padStart(5, '0')}`;

export function Transport({ t, active }: { t: Timeline; active: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  const head = playhead.use();
  useSpaceTap(ref, active, () => togglePlay(t));
  const frame = Math.min(head.frame, t.count - 1);
  const what = t.kind === 'loop' ? 'Loop' : t.kind === 'gif' ? 'GIF' : 'Clip';
  return (
    <div ref={ref} className={s.transport} role="group" aria-label="Playback" data-playing={head.playing ? '' : undefined}>
      <IconButton icon={head.playing ? 'pause' : 'play_arrow'} label={head.playing ? 'Pause' : 'Play'} shortcut="Space" latched={head.playing} onClick={() => togglePlay(t)} />
      {/* the arrow keys step too; a kbd would print their DOM names, so the label says them */}
      <IconButton icon="skip_previous" label="Previous frame (Left arrow)" size="sm" onClick={() => stepFrame(t, -1)} />
      <IconButton icon="skip_next" label="Next frame (Right arrow)" size="sm" onClick={() => stepFrame(t, 1)} />
      <Slider
        label="Frame"
        min={1}
        max={t.count}
        step={1}
        value={frame + 1}
        fieldWidth={64}
        className={s.scrub}
        onBegin={() => playhead.set({ frame, playing: false })}
        onChange={(v) => playhead.set({ frame: Math.round(v) - 1, playing: false })}
        onCommit={() => holdFrame(t, playhead.get().frame)}
        onCancel={() => playhead.set({ frame: pausedFrame(t), playing: false })}
      />
      <span className={s.of}>of {t.count}</span>
      <span className={s.sep} />
      <span className={cx(s.readout, head.playing && s.live)}>
        <span className="lbl">{what}</span> <b>{clock(startOf(t, frame))}</b> / {clock(t.seconds)}
      </span>
    </div>
  );
}
