// The transport (plan unit V) for a clip, a GIF or a still's loop: play and pause (also a quick tap of
// Space, foundation spec §9), step, and scrub. Nothing plays until you press play (spec §5 q3), and
// a pause, a step or a scrub leaves the frame in the document, so it is what shows and exports.
import { useEffect, useRef, type RefObject } from 'react';
import { isTextField } from '../../shell/core/keys.ts';
import { IconButton, Slider } from '../../ui/index.ts';
import { cx } from '../../ui/cx.ts';
import type { Doc } from './actions.ts';
import { fix, frameAt, startOf, type PostFxDoc, type Timeline } from './doc.ts';
import { playhead } from './view-state.ts';
import s from './Transport.module.css';

/** a Space press shorter than this, with no drag in it, is a tap: longer, it pans the view */
const TAP_MS = 250;

/** the frame on screen into the document: one step, arrow repeats and scrubs of it coalescing */
export function holdFrame(doc: Doc, t: Timeline, frame: number): void {
  const at = Math.min(t.count - 1, Math.max(0, frame));
  playhead.set({ frame: at, playing: false });
  if (frameAt(t, doc.get().time) === at) return;
  doc.transact(`Move to frame ${at + 1}`, (d) => fix({ ...d, time: startOf(t, at) }), 'time');
}

export function togglePlay(doc: Doc, t: Timeline): void {
  const { frame, playing } = playhead.get();
  if (t.count < 2) return;
  if (playing) holdFrame(doc, t, frame);
  else playhead.set({ frame, playing: true });
}

export const stepFrame = (doc: Doc, t: Timeline, by: number): void => holdFrame(doc, t, (playhead.get().frame + by + t.count) % t.count);

/**
 * A tap of Space plays and pauses (spec §9: only a text field keeps Space), unless the tap was a pan.
 * The focused button isn't pressed by it; Enter still presses buttons, and an open menu keeps Space.
 */
function useSpaceTap(el: RefObject<HTMLElement | null>, active: boolean, toggle: () => void) {
  const run = useRef(toggle);
  run.current = toggle;
  useEffect(() => {
    if (!active) return;
    let down: number | null = null;
    const onDown = (e: KeyboardEvent) => {
      if (e.key !== ' ' || e.ctrlKey || e.altKey || e.metaKey) return;
      const f = document.activeElement as HTMLElement | null;
      if ((f && (isTextField(f) || f.closest('[role="menu"], [role="listbox"]'))) || !el.current || !el.current.getClientRects().length || el.current.closest('[inert]')) return;
      e.preventDefault();
      if (!e.repeat) down = performance.now();
    };
    const onUp = (e: KeyboardEvent) => {
      if (e.key !== ' ' || down === null) return;
      e.preventDefault();
      if (performance.now() - down < TAP_MS) run.current();
      down = null;
    };
    const cancel = () => (down = null);
    addEventListener('keydown', onDown);
    addEventListener('keyup', onUp);
    addEventListener('pointerdown', cancel, true);
    addEventListener('blur', cancel);
    return () => {
      removeEventListener('keydown', onDown);
      removeEventListener('keyup', onUp);
      removeEventListener('pointerdown', cancel, true);
      removeEventListener('blur', cancel);
    };
  }, [active]);
}

const clock = (sec: number) => `${Math.floor(sec / 60)}:${(sec % 60).toFixed(2).padStart(5, '0')}`;

export function Transport({ doc, d, t, active }: { doc: Doc; d: PostFxDoc; t: Timeline; active: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  const head = playhead.use();
  useSpaceTap(ref, active, () => togglePlay(doc, t));
  const frame = Math.min(head.frame, t.count - 1);
  const what = t.kind === 'loop' ? 'Loop' : t.kind === 'gif' ? 'GIF' : 'Clip';
  return (
    <div ref={ref} className={s.transport} role="group" aria-label="Playback" data-playing={head.playing ? '' : undefined}>
      <IconButton icon={head.playing ? 'pause' : 'play_arrow'} label={head.playing ? 'Pause' : 'Play'} shortcut="Space" latched={head.playing} onClick={() => togglePlay(doc, t)} />
      {/* the arrow keys step too; a kbd would print their DOM names, so the label says them */}
      <IconButton icon="skip_previous" label="Previous frame (Left arrow)" size="sm" onClick={() => stepFrame(doc, t, -1)} />
      <IconButton icon="skip_next" label="Next frame (Right arrow)" size="sm" onClick={() => stepFrame(doc, t, 1)} />
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
        onCommit={() => holdFrame(doc, t, playhead.get().frame)}
        onCancel={() => playhead.set({ frame: frameAt(t, d.time), playing: false })}
      />
      <span className={s.of}>of {t.count}</span>
      <span className={s.sep} />
      <span className={cx(s.readout, head.playing && s.live)}>
        <span className="lbl">{what}</span> <b>{clock(startOf(t, frame))}</b> / {clock(t.seconds)}
      </span>
    </div>
  );
}
