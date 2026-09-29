import { useCallback, useState } from 'react';

/**
 * An element's content width, kept current as it resizes (for layouts CSS can't express alone). A
 * callback ref, so an element that mounts later (the Value ruler once there are swatches) is
 * measured too.
 */
export function useWidth<T extends HTMLElement>() {
  const [width, setWidth] = useState(0);
  const ref = useCallback((el: T | null) => {
    if (!el) return;
    // it reports once on observe, then on every resize
    const ro = new ResizeObserver(() => setWidth(el.clientWidth));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return { ref, width };
}
