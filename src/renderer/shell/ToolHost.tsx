import { Component, type ReactNode } from 'react';
import type { ToolId } from '../../shared/types.ts';
import { Button, Icon, Module, toast } from '../ui/index.ts';
import { shell, useShell } from './core/index.ts';
import s from './ToolHost.module.css';

/** Catches a render error, reports it and draws nothing; the host shows the shell's crash panel instead. */
export class Boundary extends Component<{ onError(error: unknown): void; children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  componentDidCatch(error: unknown) {
    this.props.onError(error);
  }
  render() {
    return this.state.failed ? null : this.props.children;
  }
}

/**
 * One tool's view (spec §4): mounted on first activation and never unmounted. Hidden tools get
 * display:none, inert and `active: false`.
 */
export function ToolHost({ id, active }: { id: ToolId; active: boolean }) {
  const crash = useShell((st) => st.crashed[id]);
  const tool = shell.tool(id);
  const View = tool.View;
  return (
    <div className={active ? s.host : s.hidden} inert={!active} data-tool={id}>
      {/* a cleared crash mounts a fresh boundary, so Reload and Start empty render from scratch */}
      {crash ? (
        <CrashPanel id={id} label={tool.label} message={crash.message} details={crash.details} automatic={crash.automatic} />
      ) : (
        <Boundary onError={(e) => shell.reportCrash(id, e)}>
          <View doc={shell.doc(id)} active={active} />
        </Boundary>
      )}
    </div>
  );
}

function CrashPanel({ id, label, message, details, automatic }: { id: ToolId; label: string; message: string; details: string; automatic: boolean }) {
  const copy = () =>
    navigator.clipboard.writeText(details).then(
      () => toast.show({ icon: 'content_copy', message: 'Copied the error details' }),
      () => toast.show({ kind: 'error', message: "Couldn't copy the error details." }),
    );
  return (
    <div className={s.crashWrap}>
      <Module title={`${label} stopped`} sub="Error" className={s.crash}>
        <div className={s.body}>
          <p className={s.lead}>
            <Icon name="error" className={s.icon} />
            <span>
              {automatic ? `${label} failed again, so it started empty.` : `${label} hit an error and stopped.`} Other tools keep working.
            </span>
          </p>
          <p className={s.message}>{message}</p>
          {automatic && <p className={s.note}>The broken document is kept in the workspace's crashed folder.</p>}
          <div className={s.actions}>
            <Button variant="primary" icon="refresh" onClick={() => shell.reloadTool(id)}>
              Reload tool
            </Button>
            {!automatic && (
              <Button icon="restart_alt" onClick={() => void shell.startEmpty(id)}>
                Start empty
              </Button>
            )}
            <Button variant="ghost" icon="content_copy" onClick={copy}>
              Copy details
            </Button>
          </div>
          {!automatic && <p className={s.note}>Start empty keeps the broken document in the workspace's crashed folder.</p>}
        </div>
      </Module>
    </div>
  );
}
