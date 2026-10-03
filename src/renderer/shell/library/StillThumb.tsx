import { useEffect, useRef } from 'react';

/** the longest side of the drawn frame: twice the 44 px thumbnail */
const SIDE = 88;

/**
 * A thumbnail for a format that can animate (GIF, WebP, AVIF): an <img> would play it in the list
 * unasked, so its first frame is drawn on a canvas instead. Nothing animates until Luap presses play
 * in a tool. Fetched once the thumbnail scrolls near view.
 */
export function StillThumb({ url, className, onSize, onError }: { url: string; className: string; onSize(w: number, h: number): void; onError(): void }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const el = canvas.current!;
    let alive = true;
    const draw = async () => {
      const res = await fetch(url);
      if (!res.ok) throw new Error(`${res.status}`);
      const bmp = await createImageBitmap(await res.blob()); // the first frame of an animation
      try {
        if (!alive) return;
        const k = Math.min(1, SIDE / Math.max(bmp.width, bmp.height));
        el.width = Math.max(1, Math.round(bmp.width * k));
        el.height = Math.max(1, Math.round(bmp.height * k));
        el.getContext('2d')!.drawImage(bmp, 0, 0, el.width, el.height);
        onSize(bmp.width, bmp.height);
      } finally {
        bmp.close();
      }
    };
    const io = new IntersectionObserver(([e]) => {
      if (!e.isIntersecting) return;
      io.disconnect();
      draw().catch(() => alive && onError());
    }, { rootMargin: '200px 0px' });
    io.observe(el);
    return () => {
      alive = false;
      io.disconnect();
    };
  }, [url]);
  return <canvas ref={canvas} className={className} />;
}
