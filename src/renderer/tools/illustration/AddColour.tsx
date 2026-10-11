// The Add colour row of the Ramps section: Add colour adds one at once from the picker's colour, Add by hex
// takes a typed code (Enter), From… opens the sources (the menu), and a source that stages several colours
// opens its popover under the row. The hex field is here for good, not only while the palette is empty.
import { useRef, useState } from 'react';
import { Button, TextInput } from '../../ui/index.ts';
import { type Doc } from './actions.ts';
import type { IllustrationDoc } from './doc.ts';
import { sourcePop } from './proposals.ts';
import { SourcePopover } from './SourcePop.tsx';
import { addColour, addMenu, addTyped, baseFromHex } from './starts.ts';
import s from './AddColour.module.css';

export function AddColour({ doc, d }: { doc: Doc; d: IllustrationDoc }) {
  const pop = sourcePop.use();
  // the group is the menu's and the popover's anchor
  const [group, setGroup] = useState<HTMLElement | null>(null);
  const close = (refocus: boolean) => {
    sourcePop.set(null);
    if (refocus && group?.isConnected) [...group.querySelectorAll('button')].at(-1)?.focus({ preventScroll: true });
  };
  // the hex as typed so far; Enter adds it (blur alone adds nothing). A new key empties the field after an add
  const typed = useRef('');
  const [fresh, setFresh] = useState(0);
  const addHex = () => {
    if (!typed.current.trim()) return;
    if (!addTyped(doc, typed.current)) return;
    typed.current = '';
    setFresh((n) => n + 1);
  };
  return (
    <div className={s.row}>
      <span ref={setGroup} className={s.split}>
        <Button variant="primary" icon="add" shortcut="Shift+A" onClick={() => addColour(doc)}>
          Add colour
        </Button>
        <Button
          iconEnd="keyboard_arrow_down"
          tooltip="Add several colours from codes, an image, the screen or a Library palette, or start from a subject or a limited set"
          onClick={(e) => group && addMenu(doc, group.getBoundingClientRect(), e.currentTarget, e.detail === 0)}
        >
          From…
        </Button>
      </span>
      <div className={s.hex} onKeyDown={(e) => e.key === 'Enter' && (e.target as Element).tagName === 'INPUT' && addHex()}>
        <TextInput
          key={fresh}
          label="Add by hex"
          mono
          value=""
          placeholder="C26B4C"
          onChange={(t) => (typed.current = t)}
          validate={(t) => (!t.trim() || baseFromHex(t) ? null : 'Type a hex colour: 3 or 6 digits, # optional.')}
          onCommit={() => {}}
        />
      </div>
      {pop && group && <SourcePopover doc={doc} d={d} pop={pop} anchor={group} onClose={close} />}
    </div>
  );
}
