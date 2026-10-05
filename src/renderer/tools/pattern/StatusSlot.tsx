import { useMemo, useSyncExternalStore } from 'react';
import type { DocController } from '../../../shared/doc-api.ts';
import { layoutTile } from '../../../shared/pattern/layout.ts';
import type { PatternDoc } from './doc.ts';

/** `4 × 4 · 16 items`: the tile's size is in the Arrangement group, not repeated here */
export function StatusSlot({ doc }: { doc: DocController<PatternDoc> }) {
  const d = useSyncExternalStore(doc.subscribe, doc.get);
  const tile = useMemo(() => layoutTile(d), [d]);
  const n = tile.items.length;
  return (
    <span>
      {d.arrangement === 'scatter' ? 'Scatter' : `${d.cols} × ${d.rows}`} · <b>{n}</b> {n === 1 ? 'item' : 'items'}
    </span>
  );
}
