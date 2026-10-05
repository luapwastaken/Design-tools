import type { KeyboardEvent } from 'react';
import type { ToolId } from '../../shared/types.ts';
import { Icon, Tooltip } from '../ui/index.ts';
import { cx } from '../ui/cx.ts';
import { shell, useShell } from './core/index.ts';
import { GROUP_LABEL } from './TitleBar.tsx';
import type { IconName, ToolDefinition } from './tool.ts';
import s from './Rail.module.css';

const GROUPS: ToolDefinition['group'][] = ['colour', 'make', 'image'];
const NEXT: Record<string, number> = { ArrowDown: 1, ArrowUp: -1 };

/** Tools by group, then SHARED (Library, Settings). One Tab stop; arrow keys move inside (brief §6). */
export function Rail({ collapsed }: { collapsed: boolean }) {
  const tools = useShell((st) => st.tools);
  const active = useShell((st) => st.active);
  const libraryOpen = useShell((st) => st.libraryOpen);
  const settingsOpen = useShell((st) => st.settingsOpen);

  const open = (id: ToolId) => {
    if (settingsOpen) shell.openSettings(false);
    shell.setActive(id);
  };

  const onKeyDown = (e: KeyboardEvent<HTMLElement>) => {
    const items = [...e.currentTarget.querySelectorAll('button')];
    const at = items.indexOf(document.activeElement as HTMLButtonElement);
    if (at < 0) return;
    const to = e.key === 'Home' ? 0 : e.key === 'End' ? items.length - 1 : e.key in NEXT ? at + NEXT[e.key] : -1;
    if (to < 0 || to >= items.length) return;
    e.preventDefault();
    items[to].focus();
  };

  const item = (p: { key: string; icon: IconName; label: string; digit?: string; shortcut?: string; on: boolean; stop?: boolean; current?: boolean; onClick(): void }) => (
    <Tooltip key={p.key} content={p.label} shortcut={p.shortcut} disabled={!collapsed} side="right">
      <button
        type="button"
        className={cx(s.item, p.on && s.on)}
        tabIndex={p.stop ? 0 : -1}
        aria-label={collapsed ? p.label : undefined}
        aria-current={p.current ? 'page' : undefined}
        aria-pressed={p.current === undefined ? p.on : undefined}
        aria-keyshortcuts={p.shortcut?.replace('Ctrl', 'Control')}
        data-rail={p.key}
        onClick={p.onClick}
      >
        {p.on && <i className={s.led} />}
        <Icon name={p.icon} fill={p.on} />
        <span className={s.name}>{p.label}</span>
        {p.digit && <span className={s.key}>{p.digit}</span>}
      </button>
    </Tooltip>
  );

  const heading = (label: string) => (
    <div className={s.head} key={`h-${label}`}>
      <span className="caps">{label}</span>
    </div>
  );

  return (
    <nav className={cx(s.rail, collapsed && s.collapsed)} aria-label="Tools" data-region="rail" onKeyDown={onKeyDown}>
      {GROUPS.map((g) => {
        const list = tools.filter((t) => t.group === g);
        if (!list.length) return null;
        return [
          heading(GROUP_LABEL[g]),
          ...list.map((t) =>
            item({
              key: t.id,
              icon: t.icon,
              label: t.label,
              digit: t.shortcut ? String(t.shortcut) : undefined,
              shortcut: t.shortcut ? `Ctrl+${t.shortcut}` : undefined,
              on: t.id === active && !settingsOpen,
              current: t.id === active && !settingsOpen,
              stop: t.id === active,
              onClick: () => open(t.id),
            }),
          ),
        ];
      })}
      <div className={s.foot}>
        {heading('Shared')}
        {item({ key: 'library', icon: 'collections_bookmark', label: 'Library', digit: 'L', shortcut: 'Ctrl+L', on: libraryOpen, onClick: () => shell.toggleLibrary() })}
        {item({ key: 'settings', icon: 'settings', label: 'Settings', digit: ',', shortcut: 'Ctrl+,', on: settingsOpen, onClick: () => shell.openSettings(!settingsOpen) })}
      </div>
    </nav>
  );
}
