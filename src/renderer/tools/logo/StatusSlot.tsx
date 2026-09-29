import { useSyncExternalStore } from 'react';
import type { DocController } from '../../../shared/doc-api.ts';
import { shownLockups, type LogoDoc } from './doc.ts';

/** `4 LOCKUPS · 3 VERSIONS` (plan unit V): what the sheet and Export all hold */
export function StatusSlot({ doc }: { doc: DocController<LogoDoc> }) {
  const d = useSyncExternalStore(doc.subscribe, doc.get);
  if (!d.icon && !d.wordmark) return <span>No parts yet</span>;
  const n = shownLockups(d).length;
  const v = d.versions.length;
  return (
    <span>
      <b>{n}</b> {n === 1 ? 'lockup' : 'lockups'} · <b>{v}</b> {v === 1 ? 'version' : 'versions'}
    </span>
  );
}
