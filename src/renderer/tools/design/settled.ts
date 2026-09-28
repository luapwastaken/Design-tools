import { useRef, useSyncExternalStore } from 'react';
import type { DocController } from '../../../shared/doc-api.ts';
import type { DesignDoc } from './doc.ts';

/**
 * Above this many swatches the checks wait for a drag to end: redoing them on every frame of it
 * (the contrast fixes, CIEDE2000 over every pair under five simulations) drops a picker drag far
 * below 60fps (plan unit F).
 */
const LIVE_MAX = 16;

/** The document the checks and the status read: live, except mid-gesture on a long palette, where it holds the state from before the drag. */
export function useSettled(doc: DocController<DesignDoc>): DesignDoc {
  const held = useRef(doc.get());
  return useSyncExternalStore(doc.subscribe, () => {
    const d = doc.get();
    if (!doc.inGesture() || d.swatches.length <= LIVE_MAX) held.current = d;
    return held.current;
  });
}
