// The painting engine's lifetime on the canvas: made the first time Paint shows, attached to the
// canvas, sized to its device pixels, released with the canvas.
import { useEffect, useRef, useState, type RefObject } from 'react';
import { liveEngine, PaintEngine } from './paint/index.ts';

export type Started = { t: 'waiting' } | { t: 'starting'; slow: boolean } | { t: 'ready'; engine: PaintEngine } | { t: 'failed'; message: string };

/** a start slower than this shows a spinner */
const SLOW_MS = 300;

export function useEngine(show: boolean, canvas: RefObject<HTMLCanvasElement | null>): Started {
  const [started, setStarted] = useState<Started>({ t: 'waiting' });
  const own = useRef<{ mounted: boolean; engine: PaintEngine | null; pending: boolean }>({ mounted: true, engine: null, pending: false });

  useEffect(() => {
    const o = own.current;
    o.mounted = true;
    return () => {
      o.mounted = false;
      const e = o.engine;
      o.engine = null;
      if (liveEngine.get() === e) liveEngine.set(null);
      // after the painting's last save has taken its snapshot (that cleanup runs after this one)
      if (e) queueMicrotask(() => e.release());
    };
  }, []);

  useEffect(() => {
    const o = own.current;
    if (!show || o.engine || o.pending || started.t === 'failed') return;
    o.pending = true;
    setStarted({ t: 'starting', slow: false });
    const slow = setTimeout(() => setStarted((st) => (st.t === 'starting' ? { t: 'starting', slow: true } : st)), SLOW_MS);
    PaintEngine.create().then(
      (e) => {
        o.pending = false;
        clearTimeout(slow);
        if (!o.mounted) return e.release();
        o.engine = e;
        e.attach(canvas.current);
        if (window.api.smoke) liveEngine.set(e);
        setStarted({ t: 'ready', engine: e });
      },
      (err: unknown) => {
        o.pending = false;
        clearTimeout(slow);
        if (o.mounted) setStarted({ t: 'failed', message: err instanceof Error ? err.message : String(err) });
      },
    );
  }, [show]);

  // the canvas holds the painting at its device pixels, so it is sharp at any size
  useEffect(() => {
    const el = canvas.current!;
    const ro = new ResizeObserver(([entry]) => {
      const box = entry.devicePixelContentBoxSize?.[0];
      const w = Math.round(box?.inlineSize ?? entry.contentRect.width * devicePixelRatio);
      const h = Math.round(box?.blockSize ?? entry.contentRect.height * devicePixelRatio);
      if (!w || !h || (el.width === w && el.height === h)) return;
      el.width = w;
      el.height = h;
      own.current.engine?.resize();
    });
    ro.observe(el, { box: 'device-pixel-content-box' });
    return () => ro.disconnect();
  }, []);

  return started;
}
