// The logo's document bar (the shared DocBar's slots): its name and place, New, the version switch
// (icons, like the other tools), undo, Send to and Export (the assets the inspector's Export group ticks).
import type { IconName } from '../../shell/tool.ts';
import { IconButton, Segmented } from '../../ui/index.ts';
import { DocBar, ExportButton } from '../common/DocBar.tsx';
import { plural } from '../common/names.ts';
import { newLogo, type Doc } from './actions.ts';
import { shownLockups, VERSION_LABEL, VERSIONS, type LogoDoc, type Version } from './doc.ts';
import type { LogoExport } from './Export.tsx';
import { patchView, type LogoView } from './view-state.ts';

const VERSION_ICON: Record<Version, IconName> = { original: 'palette', black: 'contrast', white: 'light_mode', colour: 'format_color_fill', knockout: 'mask' };

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
        <Segmented
          options={VERSIONS.map((value) => ({ value, label: VERSION_LABEL[value], icon: VERSION_ICON[value], tip: d.versions.includes(value) ? undefined : 'Not in the export: press it in Versions to add it' }))}
          value={v.version}
          onChange={(version) => patchView({ version })}
          disabled={empty || sheet}
          fit
        />
      }
      send={{ noun: 'logo', empty: 'Add an icon or a wordmark first: a logo goes into the Library with its first part' }}
      exportButton={<ExportButton onClick={out.go} disabled={empty || !!out.why || out.ex.busy !== null} tooltip={empty ? 'Add an icon or a wordmark first' : (out.why ?? undefined)} />}
    />
  );
}
