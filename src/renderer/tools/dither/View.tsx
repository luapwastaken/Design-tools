// The Dither tool's screen (spec §2): the result in the Viewport with an Original | Result switch
// and the index under the pointer, a transport for animated input, and the inspector (Look, Pixel
// size, Algorithm, Palette, Tone, Export) on the right. The worker dithers the document; the view,
// the playback and every export show that one index buffer.
import { useEffect, useRef, useState, useSyncExternalStore, type CSSProperties } from 'react';
import { ResizeHandle } from '../../shell/ResizeHandle.tsx';
import { Icon } from '../../ui/index.ts';
import { useHeld } from '../common/held.ts';
import type { Doc } from './actions.ts';
import { AlgorithmModule } from './Algorithm.tsx';
import { DitherCanvas } from './Canvas.tsx';
import { DitherBar } from './DitherBar.tsx';
import { frameMs, isAnimated, used, workSize, type DitherDoc } from './doc.ts';
import { ExportModule } from './Export.tsx';
import { LookModule } from './Look.tsx';
import { PaletteModule } from './Palette.tsx';
import { dithered, fillFrom, ready, releaseDither, Superseded, type Result } from './pipeline.ts';
import { PixelModule } from './Pixel.tsx';
import { Start } from './Start.tsx';
import { ToneModule } from './Tone.tsx';
import { Transport } from './Transport.tsx';
import { getView, patchView, playhead, status, useView } from './view-state.ts';
import s from './View.module.css';

const INSPECTOR = { min: 340, max: 460, reset: 380 };

/**
 * The dither of the frame on screen, made while the tool shows. The last one stays up while the
 * next is made, and goes when the settings can't be dithered (nothing stale is shown or exported).
 */
function useDither(d: DitherDoc, frame: number, active: boolean) {
  const [result, setResult] = useState<Result | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (!active || !d.source) {
      setBusy(false);
      setError(null);
      return;
    }
    if (isAnimated(d)) fillFrom(d, frame);
    const now = ready(d, frame);
    if (now) {
      setResult(now);
      setBusy(false);
      setError(null);
      return;
    }
    let live = true;
    setBusy(true);
    // a failure belongs to the request that made it: the next one starts clean
    setError(null);
    dithered(d, frame).then(
      (r) => {
        if (!live) return;
        setResult(r);
        setBusy(false);
        setError(null);
      },
      (e: unknown) => {
        if (e instanceof Superseded || !live) return;
        setBusy(false);
        setResult(null);
        setError(e instanceof Error ? e.message : String(e));
      },
    );
    return () => void (live = false);
  }, [d, frame, active]);
  // a hidden tool frees the worker, the results and every decoded frame (foundation spec §4)
  useEffect(() => {
    if (active) return;
    releaseDither();
    setResult(null);
  }, [active]);
  return { result: d.source ? result : null, busy, error };
}

/**
 * Playback shows every frame as it is (content, never a transition between states). Each frame
 * stays up for its own time once it is on screen, so one still being made holds the clock rather
 * than being skipped, and one that can't be made stops it with its error in view.
 */
function usePlayback(d: DitherDoc, active: boolean) {
  const { playing } = playhead.use();
  const src = d.source;
  useEffect(() => {
    if (!active || !playing || !src || src.frames < 2) return;
    let due: number | null = null;
    let raf = 0;
    const tick = (now: number) => {
      raf = requestAnimationFrame(tick);
      const at = playhead.get().frame;
      if (!ready(d, at)) return void (due = null);
      if (due === null) due = now + frameMs(src, at);
      if (now < due) return;
      const next = (at + 1) % src.frames;
      playhead.set({ frame: next, playing: true });
      // made already, it keeps the beat; otherwise its time starts when it arrives
      due = ready(d, next) ? (now - due > frameMs(src, next) ? now : due) + frameMs(src, next) : null;
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [active, playing, d]);
}

export function View({ doc, active }: { doc: Doc; active: boolean }) {
  const d = useSyncExternalStore(doc.subscribe, doc.get);
  const v = useView();
  const head = playhead.use();
  const frames = d.source?.frames ?? 1;
  const frame = Math.min(head.frame, frames - 1);
  const { result, busy, error } = useDither(d, frame, active);
  const slow = useHeld(busy);
  usePlayback(d, active);

  // a new source starts paused on its first frame, and at Fit: the last image's centre means nothing
  // on it (the restored one keeps its view)
  const opened = useRef(d.source?.assets);
  useEffect(() => {
    playhead.set({ frame: 0, playing: false });
    if (opened.current === d.source?.assets) return;
    opened.current = d.source?.assets;
    if (getView().zoom !== 'fit') patchView({ zoom: 'fit' });
  }, [d.source?.assets]);

  useEffect(() => {
    const { w, h } = workSize(d);
    status.set(d.source ? { w, h, colours: used(d).length, ms: result?.ms ?? 0, busy: !error && (busy || !result), error: !!error } : null);
  }, [d, result, busy, error]);

  return (
    <div className={s.view} style={{ '--insp': `${v.inspector}px` } as CSSProperties}>
      <div className={s.work} data-animated={isAnimated(d) ? '' : undefined}>
        <DitherBar doc={doc} d={d} v={v} />
        {d.source ? (
          <div className={s.stage}>
            <DitherCanvas d={d} v={v} frame={frame} result={result} busy={slow} />
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
        {isAnimated(d) && <Transport doc={doc} d={d} frame={frame} playing={head.playing} active={active} />}
        <ResizeHandle value={v.inspector} min={INSPECTOR.min} max={INSPECTOR.max} reset={INSPECTOR.reset} label="Inspector width" edge="left" onChange={(w) => patchView({ inspector: w })} />
      </div>
      <aside className={s.insp} aria-label="Inspector">
        <LookModule doc={doc} d={d} />
        <PixelModule doc={doc} d={d} />
        <AlgorithmModule doc={doc} d={d} />
        <PaletteModule doc={doc} d={d} frame={frame} />
        <ToneModule doc={doc} d={d} hist={result?.hist ?? null} />
        <ExportModule d={d} v={v} frame={frame} ready={!!result && !error} error={error} />
      </aside>
    </div>
  );
}
