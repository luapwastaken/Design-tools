import { Button, Icon, Tooltip } from '../ui/index.ts';
import { shell, useShell } from './core/index.ts';
import type { ToolDefinition } from './tool.ts';
import s from './TitleBar.module.css';

export const GROUP_LABEL: Record<ToolDefinition['group'], string> = { colour: 'Colour', make: 'Make', image: 'Image', dev: 'Dev' };

/**
 * App mark, breadcrumb and the document-state readout (spec §4, §7.5). The bar is a window drag
 * region sized to env(titlebar-area-width), so nothing lands under the Windows caption buttons.
 */
export function TitleBar() {
  const active = useShell((st) => st.active);
  const settingsOpen = useShell((st) => st.settingsOpen);
  const docName = useShell((st) => st.docNames[st.active]);
  // the readout is derived from these; selecting them re-renders when it changes
  useShell((st) => st.docStates[st.active]);
  useShell((st) => st.owners);
  const tool = shell.tool(active);
  const readout = settingsOpen ? null : shell.readout(active);

  return (
    <header className={s.bar}>
      <div className={s.app}>
        <Icon name="my_location" />
        <span className={s.appName}>Design Tools</span>
      </div>
      <nav className={s.crumbs} aria-label="Location">
        {settingsOpen ? (
          <b className={s.here}>Settings</b>
        ) : (
          <>
            <span>{GROUP_LABEL[tool.group]}</span>
            <Icon name="chevron_right" size={14} />
            {docName ? <span className={s.tool}>{tool.label}</span> : <b className={s.here}>{tool.label}</b>}
            {docName && (
              <>
                <Icon name="chevron_right" size={14} />
                <Tooltip overflowOnly>
                  <b className={s.here}>{docName}</b>
                </Tooltip>
              </>
            )}
          </>
        )}
      </nav>
      {readout && (
        <div className={s.readout} data-tone={readout.tone} data-region={readout.actions.length ? 'titlebar' : undefined} role="status">
          <span className={s.text}>{readout.text}</span>
          {readout.actions.map((a) => (
            <Button key={a.label} size="xs" onClick={a.run}>
              {a.label}
            </Button>
          ))}
        </div>
      )}
    </header>
  );
}
