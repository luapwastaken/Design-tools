// The logo's document bar (the shared DocBar's slots): its name and place, New, the Version switch,
// undo, Send to and Export (the same list the inspector's Export group makes).
import { IconButton, Segmented } from '../../ui/index.ts';
import { DocBar, ExportButton } from '../common/DocBar.tsx';
import { plural } from '../common/names.ts';
import { newLogo, type Doc } from './actions.ts';
import { shownLockups, VERSION_LABEL, VERSIONS, type LogoDoc } from './doc.ts';
import type { LogoExport } from './Export.tsx';
import { patchView, type LogoView } from './view-state.ts';
import s from './LogoBar.module.css';

export function LogoBar({ doc, d, v, out }: { doc: Doc; d: LogoDoc; v: LogoView; out: LogoExport }) {
  const empty = !d.icon && !d.wordmark;
  const sheet = v.mode === 'sheet';
  return (
    <DocBar
      tool="logo"
      doc={doc}
      meta={empty ? 'No parts yet' : plural(shownLockups(d).length, 'lockup')}
      actions={<IconButton icon="note_add" label="New logo" shortcut="Ctrl+N" size="sm" onClick={() => void newLogo()} />}
      modes={
        <span className={s.version}>
          <span className={s.label}>Version</span>
          <Segmented
            options={VERSIONS.map((value) => ({ value, label: VERSION_LABEL[value], tip: d.versions.includes(value) ? undefined : 'Not in the export: press it in Versions to add it' }))}
            value={v.version}
            onChange={(version) => patchView({ version })}
            disabled={empty || sheet}
            fit
          />
        </span>
      }
      send={{ noun: 'logo', empty: 'Add an icon or a wordmark first: a logo goes into the Library with its first part' }}
      exportButton={<ExportButton onClick={out.go} disabled={empty || !!out.why || out.ex.busy !== null} tooltip={empty ? 'Add an icon or a wordmark first' : (out.why ?? undefined)} />}
    />
  );
}
