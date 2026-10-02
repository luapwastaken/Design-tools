// The Post FX tool's screen (spec §2): the source in the Viewport with the Before | After divider, a
// transport for clips, GIFs and loops, and the inspector (Stack, the selected layer, Presets, Loop,
// Export) on the right. The preview and every export run the same stack on the same frame.
import { useEffect, useMemo, useRef, useState, useSyncExternalStore, type CSSProperties } from 'react';
import { ResizeHandle } from '../../shell/ResizeHandle.tsx';
import { Icon } from '../../ui/index.ts';
import { useHeld } from '../common/held.ts';
import type { Doc } from './actions.ts';
import { PostFxCanvas } from './Canvas.tsx';
import { frameAt, offered, timeline, type PostFxDoc } from './doc.ts';
import { ExportModule } from './Export.tsx';
import { LayerModule } from './Layer.tsx';
import { LoopModule } from './Loop.tsx';
import { PostFxBar } from './PostFxBar.tsx';
import { PresetsModule } from './Presets.tsx';
import { Preview, shown } from './preview.ts';
import { StackModule } from './Stack.tsx';
import { Start } from './Start.tsx';
import { holdFrame, Transport } from './Transport.tsx';
import { getView, patchView, playhead, status, useView } from './view-state.ts';
import s from './View.module.css';

const INSPECTOR = { min: 340, max: 460, reset: 380 };

/**
 * The preview while the tool shows. Paused, it shows the playhead's frame (the document's `time`,
 * or a scrub on its way there); playing, media.ts drives it. Only the canvas and the transport
 * redraw with each frame: this hook listens to the playhead outside React.
 */
function usePreview(doc: Doc, d: PostFxDoc, active: boolean) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const preview = useRef<Preview | null>(null);
  const t = useMemo(() => timeline(d), [d.source, d.stack, d.loop]);
  const live = useRef({ d, t });
  live.current = { d, t };

  useEffect(() => {
    if (!active) return;
    const p = new Preview();
    p.onError = setError;
    p.onBusy = setBusy;
    preview.current = p;
    const follow = () => {
      const { frame, playing } = playhead.get();
      const { d: now, t: tl } = live.current;
      if (!now.source) return;
      if (playing && tl.count > 1) {
        if (!p.playing) p.play(now, frame);
      } else {
        if (p.playing) p.pause();
        p.show(now, frame);
      }
    };
    const off = playhead.subscribe(follow);
    follow();
    return () => {
      off();
      // switching tools pauses, and the frame it stopped on stays in the document
      const { frame, playing } = playhead.get();
      if (playing) holdFrame(doc, live.current.t, frame);
      p.release();
      preview.current = null;
      setBusy(false);
    };
  }, [active]);

  // a change of settings: the frame on screen again, or the next one playing takes it
  useEffect(() => {
    const p = preview.current;
    if (!p || !d.source) return;
    if (p.playing && t.count < 2) playhead.set({ frame: 0, playing: false });
    else p.show(d, Math.min(playhead.get().frame, t.count - 1));
  }, [d]);

  // a loop of another length restarts the clock where it is
  useEffect(() => {
    const p = preview.current;
    if (!p?.playing) return;
    p.pause();
    p.play(live.current.d, Math.min(playhead.get().frame, t.count - 1));
  }, [t.count, t.fps]);

  // the paused frame follows the document (undo, a relaunch, another source)
  useEffect(() => {
    if (!playhead.get().playing) playhead.set({ frame: frameAt(t, d.time), playing: false });
  }, [d.time, t]);

  return { t, busy, error: d.source ? error : null };
}

export function View({ doc, active }: { doc: Doc; active: boolean }) {
  const d = useSyncExternalStore(doc.subscribe, doc.get);
  const v = useView();
  const { t, busy, error } = usePreview(doc, d, active);
  const slow = useHeld(busy);
  const last = shown.use();

  // a new source opens at Fit, and a selection that went with the old stack goes (the restored one keeps its view)
  const opened = useRef(d.source?.asset);
  useEffect(() => {
    if (opened.current === d.source?.asset) return;
    opened.current = d.source?.asset;
    if (getView().zoom !== 'fit') patchView({ zoom: 'fit' });
  }, [d.source?.asset]);
  useEffect(() => {
    const sel = getView().selected;
    if (d.stack.length && !d.stack.some((l) => l.id === sel)) patchView({ selected: d.stack[0].id });
  }, [d.stack]);

  const ms = last?.ms ?? 0;
  useEffect(() => {
    status.set(d.source ? { layers: d.stack.length, on: d.stack.filter((l) => l.on && offered(d, l.effect)).length, ms, busy: !error && (busy || !last), error: !!error } : null);
  }, [d, ms, busy, error, !last]);

  return (
    <div className={s.view} style={{ '--insp': `${v.inspector}px` } as CSSProperties}>
      <div className={s.work} data-animated={d.source && t.count > 1 ? '' : undefined}>
        <PostFxBar doc={doc} d={d} v={v} t={t} />
        {d.source ? (
          <div className={s.stage}>
            <PostFxCanvas d={d} v={v} busy={slow} />
            {error && (
              <p className={s.error} role="alert">
                <Icon name="error" size={16} />
                {error}
              </p>
            )}
          </div>
        ) : (
          <Start doc={doc} />
        )}
        {d.source && t.count > 1 && <Transport doc={doc} d={d} t={t} active={active} />}
        <ResizeHandle value={v.inspector} min={INSPECTOR.min} max={INSPECTOR.max} reset={INSPECTOR.reset} label="Inspector width" edge="left" onChange={(w) => patchView({ inspector: w })} />
      </div>
      <aside className={s.insp} aria-label="Inspector">
        <StackModule doc={doc} d={d} />
        <LayerModule doc={doc} d={d} />
        <PresetsModule doc={doc} d={d} />
        <LoopModule doc={doc} d={d} t={t} />
        <ExportModule d={d} t={t} error={error} />
      </aside>
    </div>
  );
}
