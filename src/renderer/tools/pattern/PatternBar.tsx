// The pattern's document bar, the colour tools' DocBar made for a pattern: its name and place, New,
// undo, Surprise me and Send to.
import { Button, IconButton, UndoRedo } from '../../ui/index.ts';
import { cx } from '../../ui/cx.ts';
import { DocHead, SendTo } from '../common/DocBar.tsx';
import { plural } from '../common/names.ts';
import { newPattern, surprise, type Doc } from './actions.ts';
import type { PatternDoc } from './doc.ts';
import s from '../common/DocBar.module.css';

export function PatternBar({ doc, d }: { doc: Doc; d: PatternDoc }) {
  return (
    <div className={s.docbar}>
      <DocHead tool="pattern" doc={doc} />
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
