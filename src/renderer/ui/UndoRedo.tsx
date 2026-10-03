import { useSyncExternalStore } from 'react';
import type { DocController } from '../../shared/doc-api.ts';
import { IconButton } from './IconButton.tsx';

/** A tool's undo and redo buttons; the tooltips name the step (spec §8: "Undo: change frequency"). */
export function UndoRedo<D>({ doc }: { doc: DocController<D> }) {
  const undo = useSyncExternalStore(doc.subscribe, doc.undoLabel);
  const redo = useSyncExternalStore(doc.subscribe, doc.redoLabel);
  return (
    <>
      <IconButton icon="undo" label={undo ? `Undo: ${undo}` : 'Undo'} shortcut="Ctrl+Z" size="sm" disabled={!undo} onClick={() => doc.undo()} />
      <IconButton icon="redo" label={redo ? `Redo: ${redo}` : 'Redo'} shortcut="Ctrl+Y" size="sm" disabled={!redo} onClick={() => doc.redo()} />
    </>
  );
}
