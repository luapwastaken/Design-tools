import { Icon } from '../ui/index.ts';
import { shell, useShell } from './core/index.ts';
import { Boundary } from './ToolHost.tsx';
import s from './StatusBar.module.css';

/** Facts, tasks and warnings only (spec §4): the active tool's facts on the left, running tasks and warnings on the right. Undo's depth lives in the Undo tooltip. */
export function StatusBar() {
  const active = useShell((st) => st.active);
  const shown = useShell((st) => st.mounted.includes(st.active) && !st.crashed[st.active]);
  const warning = useShell((st) => st.statusWarning);
  const busy = useShell((st) => st.busy);
  const Slot = shell.tool(active).StatusSlot;
  const doc = shell.doc(active);

  return (
    <footer className={s.bar}>
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
