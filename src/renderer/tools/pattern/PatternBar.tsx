// The pattern's document bar (the shared DocBar's slots): its name and place, New, Surprise me
// (the pattern builder moves it to the options bar), undo, Send to.
import { Button, IconButton } from '../../ui/index.ts';
import { DocBar } from '../common/DocBar.tsx';
import { plural } from '../common/names.ts';
import { newPattern, surprise, type Doc } from './actions.ts';
import type { PatternDoc } from './doc.ts';

export function PatternBar({ doc, d }: { doc: Doc; d: PatternDoc }) {
  return (
    <DocBar
      tool="pattern"
      doc={doc}
      meta={plural(d.slots.length, 'shape')}
      actions={
        <>
          <IconButton icon="note_add" label="New pattern" shortcut="Ctrl+N" size="sm" onClick={() => void newPattern()} />
          <Button icon="wand_stars" onClick={() => surprise(doc)} tooltip="Surprise me: a new arrangement, spacing, size and turns. The shapes and colours stay.">
            Surprise me
          </Button>
        </>
      }
      send={{ noun: 'pattern', empty: 'Change something first: a pattern goes into the Library with its first edit' }}
    />
  );
}
