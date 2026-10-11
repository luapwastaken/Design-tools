import { useEffect, useRef, useState } from 'react';
import { IconButton, Kbd, Module } from '../ui/index.ts';
import { shell, useShell } from './core/index.ts';
import { guardSync } from './core/errors.ts';
import { appRows, keyCaps, toolGroups, type Group, type Row } from './core/shortcuts.ts';
import s from './ShortcutsSheet.module.css';

/**
 * The Keyboard shortcuts sheet (? or F1, or Settings): the active tool's keys, from its own shortcuts()
 * list, then the keys that work everywhere. A layer over the work area, there at once and gone at once;
 * Esc, a click outside or Close puts it away, and focus goes back to where it was.
 */
export function ShortcutsSheet() {
  const active = useShell((st) => st.active);
  const settingsOpen = useShell((st) => st.settingsOpen);
  const tools = useShell((st) => st.tools);
  const close = useRef<HTMLButtonElement>(null);
  const [back] = useState(() => document.activeElement as HTMLElement | null);
  // the keys as they are when it opens: nothing behind it can change while it shows
  const [mine] = useState<Group[]>(() => {
    const def = shell.tool(active);
    const list = settingsOpen || !def.shortcuts ? [] : (guardSync(`${def.label}'s shortcuts failed`, () => def.shortcuts!(shell.doc(active))) ?? []);
    return toolGroups(list);
  });
  const name = shell.tool(active).label;

  useEffect(() => {
    close.current?.focus();
    // a capture listener, as a menu has: Esc is this layer's before the keymap or a tool sees it
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      e.preventDefault();
      e.stopPropagation();
      shell.openShortcuts(false);
    };
    addEventListener('keydown', onKey, true);
    return () => {
      removeEventListener('keydown', onKey, true);
      if (back?.isConnected && document.activeElement === document.body) back.focus({ preventScroll: true });
    };
  }, [back]);

  return (
    <div className={s.scrim} onMouseDown={(e) => e.target === e.currentTarget && shell.openShortcuts(false)}>
      <div className={s.card} role="dialog" aria-modal="true" aria-label="Keyboard shortcuts" onBlur={(e) => !e.currentTarget.contains(e.relatedTarget) && close.current?.focus()}>
        <Module
          title="Keyboard shortcuts"
          scroll
          className={s.mod}
          actions={<IconButton ref={close} icon="close" label="Close" size="sm" shortcut="Escape" onClick={() => shell.openShortcuts(false)} />}
        >
          <div className={s.body}>
            {mine.length > 0 && (
              <section className={s.col} aria-label={name}>
                <h3 className={s.head}>{name}</h3>
                {mine.map((g) => (
                  <GroupView key={g.title} group={g} />
                ))}
              </section>
            )}
            <section className={s.col} aria-label="Everywhere">
              <h3 className={s.head}>Everywhere</h3>
              <RowsView rows={appRows(tools)} />
            </section>
          </div>
        </Module>
      </div>
    </div>
  );
}

function GroupView({ group }: { group: Group }) {
  return (
    <div className={s.group}>
      <h4 className={s.sub}>{group.title}</h4>
      <RowsView rows={group.rows} />
    </div>
  );
}

function RowsView({ rows }: { rows: Row[] }) {
  return (
    <dl className={s.rows}>
      {rows.map((r, i) => (
        <div key={`${r.keys}${i}`} className={s.row}>
          <dt className={s.keys}>
            <Caps keys={r.keys} />
            {r.to && (
              <>
                <span className={s.to}>to</span>
                <Caps keys={r.to} />
              </>
            )}
          </dt>
          <dd className={s.label}>{r.label}</dd>
        </div>
      ))}
    </dl>
  );
}

function Caps({ keys }: { keys: string }) {
  return (
    <>
      {keyCaps(keys).map((k, i) => (
        <Kbd key={i}>{k}</Kbd>
      ))}
    </>
  );
}
