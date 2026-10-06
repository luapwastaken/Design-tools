// The one Add colour button of the Ramps section: a click adds a colour, the caret opens the sources
// (the menu), and a source that stages several colours opens its popover under the button.
import { useState } from 'react';
import { Button, IconButton } from '../../ui/index.ts';
import { type Doc } from './actions.ts';
import type { IllustrationDoc } from './doc.ts';
import { sourcePop } from './proposals.ts';
import { SourcePopover } from './SourcePop.tsx';
import { addColour, addMenu } from './starts.ts';
import s from './AddColour.module.css';

export function AddColour({ doc, d }: { doc: Doc; d: IllustrationDoc }) {
  const pop = sourcePop.use();
  // the group is the menu's and the popover's anchor
  const [group, setGroup] = useState<HTMLElement | null>(null);
  const close = (refocus: boolean) => {
    sourcePop.set(null);
    if (refocus && group?.isConnected) group.querySelector('button')?.focus({ preventScroll: true });
  };
  return (
    <div className={s.row}>
      <span ref={setGroup} className={s.split}>
        <Button variant="primary" icon="add" shortcut="Shift+A" onClick={() => addColour(doc)}>
          Add colour
        </Button>
        <IconButton
          icon="keyboard_arrow_down"
          label="Add colours from: codes, an image, the screen, a Library palette, a subject or a limited set"
          size="sm"
          onClick={(e) => group && addMenu(doc, group.getBoundingClientRect(), e.currentTarget, e.detail === 0)}
        />
      </span>
      {pop && group && <SourcePopover doc={doc} d={d} pop={pop} anchor={group} onClose={close} />}
    </div>
  );
}
