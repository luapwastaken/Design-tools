import { useRef, useSyncExternalStore } from 'react';
import type { DocController } from '../../shared/doc-api.ts';
import type { NumberGesture } from './scrub.ts';

/**
 * Wire a NumberField or Slider to a document value. `label` names the history step ("change
 * frequency"); `key` identifies the control so repeated arrow presses coalesce into one step
 * (drags and typed entries never coalesce).
 */
export function useDocNumber<D>(
  doc: DocController<D>,
  o: { label: string; key: string; get(d: D): number; set(d: D, v: number): D },
): { value: number } & NumberGesture {
  const value = useSyncExternalStore(doc.subscribe, () => o.get(doc.get()));
  const began = useRef(false);
  return {
    value,
    onBegin() {
      began.current = true;
      doc.begin();
    },
    onChange(v) {
      // a drag whose gesture Ctrl+Z cancelled keeps moving: ignore it rather than start a new step
      if (!began.current) doc.transact(o.label, (d) => o.set(d, v), o.key);
      else if (doc.inGesture()) doc.set((d) => o.set(d, v));
    },
    onCommit(fromKey) {
      began.current = false;
      doc.commit(o.label, fromKey ? o.key : undefined);
    },
    onCancel() {
      began.current = false;
      doc.cancel();
    },
  };
}
