import { useSyncExternalStore } from 'react';
import type { DocController } from '../../../shared/doc-api.ts';
import type { IllustrationDoc } from './doc.ts';

/** `4 RAMPS · 20 SWATCHES` (plan unit V) */
export function StatusSlot({ doc }: { doc: DocController<IllustrationDoc> }) {
  const d = useSyncExternalStore(doc.subscribe, doc.get);
  const r = d.ramps.length;
  const n = d.swatches.length;
  return (
    <span>
      <b>{r}</b> {r === 1 ? 'ramp' : 'ramps'} · <b>{n}</b> {n === 1 ? 'swatch' : 'swatches'}
    </span>
  );
}
