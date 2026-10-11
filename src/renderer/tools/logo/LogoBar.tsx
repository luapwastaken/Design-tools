// The logo's document bar (the shared DocBar's slots): its name and place, New,
// undo, Send to and Export (the assets the inspector's Export group ticks).
import { IconButton } from '../../ui/index.ts';
import { DocBar, ExportButton } from '../common/DocBar.tsx';
import { plural } from '../common/names.ts';
import { newLogo, type Doc } from './actions.ts';
import { shownLockups, type LogoDoc } from './doc.ts';
import type { LogoExport } from './Export.tsx';
import type { LogoView } from './view-state.ts';

export function LogoBar({ doc, d, out }: { doc: Doc; d: LogoDoc; out: LogoExport }) {
  const empty = !d.icon && !d.wordmark;
  return (
    <DocBar
      tool="logo"
      doc={doc}
      meta={empty ? 'No parts yet' : plural(shownLockups(d).length, 'lockup')}
      actions={<IconButton icon="note_add" label="New logo" shortcut="Ctrl+N" size="sm" onClick={() => void newLogo()} />}
      send={{ noun: 'logo', empty: 'Add an icon or a wordmark first: a logo goes into the Library with its first part' }}
      exportButton={<ExportButton onClick={out.go} disabled={empty || !!out.why || out.ex.busy !== null} tooltip={empty ? 'Add an icon or a wordmark first' : (out.why ?? undefined)} />}
    />
  );
}
