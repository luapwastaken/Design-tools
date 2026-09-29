// The pattern's document bar, the colour tools' DocBar made for a pattern: its name and place, New,
// undo, Surprise me and Send to.
import { useSyncExternalStore } from 'react';
import { useShell } from '../../shell/core/index.ts';
import { Button, IconButton, UndoRedo } from '../../ui/index.ts';
import { cx } from '../../ui/cx.ts';
import { SendTo } from '../common/DocBar.tsx';
import { plural } from '../common/names.ts';
import { newPattern, surprise, type Doc } from './actions.ts';
import type { PatternDoc } from './doc.ts';
import s from '../common/DocBar.module.css';

export function PatternBar({ doc, d }: { doc: Doc; d: PatternDoc }) {
  const name = useShell((st) => st.docNames.pattern) ?? 'Untitled';
  const collection = useSyncExternalStore(doc.subscribe, () => doc.source()?.collection ?? null);
  return (
    <div className={s.docbar}>
      <h1 className={s.title}>{name}</h1>
      {collection !== null && (
        <>
          <span className={cx('lbl', s.where)}>{collection || 'Library'}</span>
          <span className={cx('lbl', s.where)}>/</span>
        </>
      )}
      <span className={cx('lbl', s.count)}>{plural(d.slots.length, 'shape')}</span>
      <IconButton icon="note_add" label="New pattern" shortcut="Ctrl+N" size="sm" onClick={() => void newPattern()} />
      <span className={s.grow} />
      <UndoRedo doc={doc} />
      <span className={s.sep} />
      {/* the label hides in a narrow bar, so the tooltip names it */}
      <Button icon="wand_stars" onClick={() => surprise(doc)} tooltip="Surprise me: a new arrangement, spacing, size and turns. The shapes and colours stay.">
        <span className={s.addText}>Surprise me</span>
      </Button>
      <SendTo tool="pattern" doc={doc} noun="pattern" empty="Change something first: a pattern goes into the Library with its first edit" />
    </div>
  );
}
