import { useRef, useSyncExternalStore } from 'react';
import type { Oklch } from '../../shared/color/index.ts';
import type { DocController } from '../../shared/doc-api.ts';
import type { ColourGesture } from './Picker.tsx';
import type { NumberGesture } from './scrub.ts';

type Binding<D, T> = { label: string; key: string; get(d: D): T; set(d: D, v: T): D };

/**
 * Wire a NumberField or Slider to a document value. `label` names the history step ("change
 * frequency"); `key` identifies the control so repeated arrow presses coalesce into one step
 * (drags and typed entries never coalesce).
 */
export function useDocNumber<D>(doc: DocController<D>, o: Binding<D, number>): { value: number } & NumberGesture {
  return useDocValue(doc, o, Object.is);
}

/** Wire a Picker or ColorField to a document colour, the same way (plan unit F). */
export function useDocColour<D>(doc: DocController<D>, o: Binding<D, Oklch>): { value: Oklch } & ColourGesture {
  return useDocValue(doc, o, (a, b) => a[0] === b[0] && a[1] === b[1] && a[2] === b[2]);
}

function useDocValue<D, T>(doc: DocController<D>, o: Binding<D, T>, same: (a: T, b: T) => boolean) {
  const snap = useRef<{ v: T } | null>(null);
  // a getter that builds its value (a fallback triple) must still hand React the same snapshot
  const value = useSyncExternalStore(doc.subscribe, () => {
    const v = o.get(doc.get());
    if (!snap.current || !same(snap.current.v, v)) snap.current = { v };
    return snap.current.v;
  });
  const began = useRef(false);
  return {
    value,
    onBegin() {
      began.current = true;
      doc.begin();
    },
    onChange(v: T) {
      // a drag whose gesture Ctrl+Z cancelled keeps moving: ignore it rather than start a new step
      if (!began.current) doc.transact(o.label, (d) => o.set(d, v), o.key);
      else if (doc.inGesture()) doc.set((d) => o.set(d, v));
    },
    onCommit(fromKey?: boolean) {
      began.current = false;
      doc.commit(o.label, fromKey ? o.key : undefined);
    },
    onCancel() {
      began.current = false;
      doc.cancel();
    },
  };
}
