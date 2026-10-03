// What a palette file said about itself when it was imported (the readers' warnings: "Lab colours
// were converted"), kept in the palette's notes. Shown while there are any, so the one toast that
// carried them isn't the only place they live; clearing them is one history step.
import { useSyncExternalStore } from 'react';
import type { DocController } from '../../../shared/doc-api.ts';
import { IconButton, Module } from '../../ui/index.ts';
import s from './Notes.module.css';

export function NotesModule<D extends { notes: string }>({ doc }: { doc: DocController<D> }) {
  const notes = useSyncExternalStore(doc.subscribe, () => doc.get().notes);
  if (!notes) return null;
  return (
    <Module title="Notes" sub="From the file" actions={<IconButton icon="close" label="Clear the notes" size="sm" onClick={() => doc.transact('Clear the notes', (d) => ({ ...d, notes: '' }))} />}>
      <div className={s.lines}>
        {notes.split('\n').map((line, i) => (
          <p key={i}>{line}</p>
        ))}
      </div>
    </Module>
  );
}
