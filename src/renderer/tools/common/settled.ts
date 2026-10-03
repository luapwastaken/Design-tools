import { useRef, useSyncExternalStore } from 'react';
import type { DocController } from '../../../shared/doc-api.ts';
import type { Swatch } from '../../../shared/types.ts';

/**
 * Above this many swatches the checks wait for a drag to end: redoing them on every frame of it
 * (the contrast fixes, CIEDE2000 over every pair under five simulations) drops a picker drag far
 * below 60fps (Design plan unit F).
 */
const LIVE_MAX = 16;

/**
 * The document the checks and the status read: live, except mid-gesture on a palette longer than
 * `liveMax`, where it holds the state from before the drag (0: always holds during a drag).
 */
export function useSettled<D extends { swatches: Swatch[] }>(doc: DocController<D>, liveMax = LIVE_MAX): D {
  const held = useRef(doc.get());
  return useSyncExternalStore(doc.subscribe, () => {
    const d = doc.get();
    if (!doc.inGesture() || d.swatches.length <= liveMax) held.current = d;
    return held.current;
  });
}
