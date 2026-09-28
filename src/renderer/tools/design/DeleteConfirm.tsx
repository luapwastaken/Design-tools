import { useEffect, useRef } from 'react';
import { ConfirmInline } from '../../ui/index.ts';
import { deleteSelected, focusChip, type Doc } from './actions.ts';
import { displayName, listNames, type DesignDoc } from './doc.ts';
import { armed } from './view-state.ts';

/** The armed Delete (brief §6): on the anchor chip, saying what goes and that Undo brings it back. */
export function DeleteConfirm({ doc, d, sel }: { doc: Doc; d: DesignDoc; sel: string[] }) {
  const ref = useRef<HTMLDivElement>(null);
  // a block body: scrollIntoView may return a promise, and an effect may return only a cleanup
  useEffect(() => {
    ref.current?.scrollIntoView({ block: 'nearest' });
  }, []);
  const names = d.swatches.filter((w) => sel.includes(w.id)).map(displayName);
  const keep = () => {
    armed.set(false);
    focusChip(sel[0]);
  };
  return (
    <div ref={ref}>
      <ConfirmInline
        compact
        icon="delete"
        title={names.length === 1 ? `Delete swatch “${names[0]}”?` : `Delete ${names.length} swatches?`}
        detail={`${names.length > 1 ? `${listNames(names.slice(0, 4))}${names.length > 4 ? ` and ${names.length - 4} more` : ''}. ` : ''}Undo brings ${names.length === 1 ? 'it' : 'them'} back.`}
        confirmLabel="Delete"
        danger
        onConfirm={() => deleteSelected(doc)}
        onKeep={keep}
      />
    </div>
  );
}
