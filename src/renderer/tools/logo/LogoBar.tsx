// The logo's document bar, the colour tools' DocBar made for a logo: its name and place, New, the
// Edit | Sheet switch, undo and Send to.
import { useSyncExternalStore } from 'react';
import { useShell } from '../../shell/core/index.ts';
import { IconButton, Segmented, UndoRedo } from '../../ui/index.ts';
import { cx } from '../../ui/cx.ts';
import { SendTo } from '../common/DocBar.tsx';
import { plural } from '../common/names.ts';
import { newLogo, type Doc } from './actions.ts';
import { shownLockups, type LogoDoc } from './doc.ts';
import { patchView, type LogoView } from './view-state.ts';
import s from '../common/DocBar.module.css';

const MODES: { value: LogoView['mode']; label: string; tip: string }[] = [
  { value: 'edit', label: 'Edit', tip: 'One lockup large, with its handles' },
  { value: 'sheet', label: 'Sheet', tip: 'Every lockup in every version' },
];

export function LogoBar({ doc, d, v }: { doc: Doc; d: LogoDoc; v: LogoView }) {
  const name = useShell((st) => st.docNames.logo) ?? 'Untitled';
  const collection = useSyncExternalStore(doc.subscribe, () => doc.source()?.collection ?? null);
  const empty = !d.icon && !d.wordmark;
  return (
    <div className={s.docbar}>
      <h1 className={s.title}>{name}</h1>
      {collection !== null && (
        <>
          <span className={cx('lbl', s.where)}>{collection || 'Library'}</span>
          <span className={cx('lbl', s.where)}>/</span>
        </>
      )}
      <span className={cx('lbl', s.count)}>{empty ? 'No parts yet' : plural(shownLockups(d).length, 'lockup')}</span>
      <IconButton icon="note_add" label="New logo" shortcut="Ctrl+N" size="sm" onClick={() => void newLogo()} />
      <span className={s.grow} />
      <Segmented options={MODES} value={v.mode} onChange={(mode) => patchView({ mode })} disabled={empty} fit className={s.lowerSwitch} />
      <span className={s.sep} />
      <UndoRedo doc={doc} />
      <span className={s.sep} />
      <SendTo tool="logo" doc={doc} noun="logo" empty="Add an icon or a wordmark first: a logo goes into the Library with its first part" />
    </div>
  );
}
