import { useLayoutEffect, useState, type RefObject } from 'react';

/** The element's size in CSS pixels, from the first layout and on every resize: what a canvas is drawn for. */
export function useSize(ref: RefObject<HTMLElement | null>) {
  const [size, setSize] = useState<{ w: number; h: number } | null>(null);
  useLayoutEffect(() => {
    const el = ref.current!;
    const take = () => {
      const w = el.clientWidth;
      const h = el.clientHeight;
      setSize((s) => (s && s.w === w && s.h === h ? s : { w, h }));
    };
    take(); // now, so the first paint already has pixels
    const ro = new ResizeObserver(take);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return size;
}
