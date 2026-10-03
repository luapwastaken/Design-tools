import { useSyncExternalStore } from 'react';
import type { DocController } from '../../shared/doc-api.ts';
import { Icon } from '../ui/index.ts';
import { shell, useShell } from './core/index.ts';
import { Boundary } from './ToolHost.tsx';
import s from './StatusBar.module.css';

/** Mono caps readouts (spec §4): the active tool's slot on the left, the shell's own on the right. */
export function StatusBar() {
  const active = useShell((st) => st.active);
  const shown = useShell((st) => st.mounted.includes(st.active) && !st.crashed[st.active]);
  const warning = useShell((st) => st.statusWarning);
  const busy = useShell((st) => st.busy);
  // Ctrl+Z does nothing while Settings or the crash panel covers the tool, so the readout goes too
  const covered = useShell((st) => st.settingsOpen || !!st.crashed[st.active]);
  const Slot = shell.tool(active).StatusSlot;
  const doc = shell.doc(active);

  return (
    <footer className={s.bar}>
      {!covered && <UndoDepth doc={doc} />}
      {Slot && shown && (
        <Boundary key={active} onError={(e) => shell.reportCrash(active, e)}>
          <Slot doc={doc} />
        </Boundary>
      )}
      <span className={s.grow} />
      {busy > 0 && <span className={s.live}>{busy === 1 ? '1 task running' : `${busy} tasks running`}</span>}
      {/* persistent until the problem clears (spec §11), never a toast */}
      {warning && (
        <span className={s.warn} role="alert">
          <Icon name="error" size={14} />
          {warning}
        </span>
      )}
    </footer>
  );
}

function UndoDepth({ doc }: { doc: DocController<unknown> }) {
  const n = useSyncExternalStore(doc.subscribe, () => doc.depth());
  return (
    <span>
      Undo <b>{n}</b> {n === 1 ? 'step' : 'steps'}
    </span>
  );
}
