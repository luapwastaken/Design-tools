import { useSyncExternalStore } from 'react';
import type { DocController } from '../../../shared/doc-api.ts';
import { layoutLockup } from '../../../shared/logo/layout.ts';
import { editedKind } from './actions.ts';
import { KIND_LABEL, lockupOf, VERSION_LABEL, type LogoDoc } from './doc.ts';
import { pngSize } from './geometry.ts';
import { useView } from './view-state.ts';

/** `Horizontal · Original · 786 × 512 px` (spec §5): the lockup selected, the version in view, what its PNG is */
export function StatusSlot({ doc }: { doc: DocController<LogoDoc> }) {
  const d = useSyncExternalStore(doc.subscribe, doc.get);
  const v = useView();
  if (!d.icon && !d.wordmark) return <span>No parts yet</span>;
  const kind = editedKind(d, v.lockup);
  if (!kind) return <span>Every lockup is off</span>;
  const size = pngSize(d, layoutLockup(d, lockupOf(d, kind)), v.version);
  return (
    <span>
      <b>{KIND_LABEL[kind]}</b> · {VERSION_LABEL[v.version]} · {size.w.toLocaleString('en')} × {size.h.toLocaleString('en')} px
    </span>
  );
}
