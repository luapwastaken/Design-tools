// The logo's document bar (the shared DocBar's slots): its name and place, New, the Edit | Sheet
// switch, undo, Send to.
import { IconButton, Segmented } from '../../ui/index.ts';
import { DocBar } from '../common/DocBar.tsx';
import { plural } from '../common/names.ts';
import { newLogo, type Doc } from './actions.ts';
import { shownLockups, type LogoDoc } from './doc.ts';
import { patchView, type LogoView } from './view-state.ts';

const MODES: { value: LogoView['mode']; label: string; icon: 'crop_square' | 'layers'; tip: string }[] = [
  { value: 'edit', label: 'Edit', icon: 'crop_square', tip: 'One lockup large, with its handles' },
  { value: 'sheet', label: 'Sheet', icon: 'layers', tip: 'Every lockup in every version' },
];

export function LogoBar({ doc, d, v }: { doc: Doc; d: LogoDoc; v: LogoView }) {
  const empty = !d.icon && !d.wordmark;
  return (
    <DocBar
      tool="logo"
      doc={doc}
      meta={empty ? 'No parts yet' : plural(shownLockups(d).length, 'lockup')}
      actions={<IconButton icon="note_add" label="New logo" shortcut="Ctrl+N" size="sm" onClick={() => void newLogo()} />}
      modes={<Segmented options={MODES} value={v.mode} onChange={(mode) => patchView({ mode })} disabled={empty} fit />}
      send={{ noun: 'logo', empty: 'Add an icon or a wordmark first: a logo goes into the Library with its first part' }}
    />
  );
}
