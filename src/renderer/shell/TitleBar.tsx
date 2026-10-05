import { Icon, Tooltip } from '../ui/index.ts';
import { shell, useShell } from './core/index.ts';
import type { ToolDefinition } from './tool.ts';
import s from './TitleBar.module.css';

export const GROUP_LABEL: Record<ToolDefinition['group'], string> = { colour: 'Colour', make: 'Make', image: 'Image' };

/**
 * App mark and breadcrumb (the document state lives in the doc bar). The bar is a window drag
 * region sized to env(titlebar-area-width), so nothing lands under the Windows caption buttons.
 */
export function TitleBar() {
  const active = useShell((st) => st.active);
  const settingsOpen = useShell((st) => st.settingsOpen);
  const docName = useShell((st) => st.docNames[st.active]);
  const tool = shell.tool(active);

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
    </header>
  );
}
