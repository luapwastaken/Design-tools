import { Fragment, useEffect, useRef, useState } from 'react';
import type { ToolId } from '../../shared/types.ts';
import { Icon, IconButton, Kbd, Module, Segmented, TextInput } from '../ui/index.ts';
import type { IconName } from '../ui/Icon.tsx';
import { cx } from '../ui/cx.ts';
import { shell, useShell } from './core/index.ts';
import { guardSync } from './core/errors.ts';
import { appGroups, filterGroups, keyCaps, queryWords, toolGroups, type Group, type Row } from './core/shortcuts.ts';
import s from './ShortcutsSheet.module.css';

/**
 * The Keyboard shortcuts sheet (? or F1, the Keys tile, or Settings): a tab per tool with that tool's
 * keys from its own shortcuts() list, the keys that work everywhere beside it, and a search across all
 * of them. A layer over the work area, there at once and gone at once; Esc, a click outside or Close
 * puts it away, and focus goes back to where it was.
 */
export function ShortcutsSheet() {
  const active = useShell((st) => st.active);
  const tools = useShell((st) => st.tools);
  const search = useRef<HTMLInputElement>(null);
  const [back] = useState(() => document.activeElement as HTMLElement | null);
  const [tab, setTab] = useState<ToolId>(active);
  const [query, setQuery] = useState('');
  // the keys as they are when it opens: nothing behind it can change while it shows
  const [lists] = useState(() =>
    tools.map((def) => ({
      id: def.id,
      label: def.label,
      groups: toolGroups(def.shortcuts ? (guardSync(`${def.label}'s shortcuts failed`, () => def.shortcuts!(shell.doc(def.id))) ?? []) : []),
    })),
  );
  const top = useRef<HTMLDivElement>(null);
  // the search field is where focus starts, so Page Up/Down scroll the keys from there
  const pageKeys = (e: { key: string; preventDefault(): void }) => {
    const box = top.current?.parentElement;
    if (!box || (e.key !== 'PageDown' && e.key !== 'PageUp')) return;
    e.preventDefault();
    box.scrollBy({ top: (e.key === 'PageDown' ? 1 : -1) * box.clientHeight * 0.8 });
  };
  const words = queryWords(query);
  const every = appGroups(tools);
  const mine = lists.find((l) => l.id === tab);
  const left = words.length ? lists.flatMap((l) => filterGroups(l.groups, words, l.label)) : (mine?.groups ?? []);
  const right = words.length ? filterGroups(every, words) : every;

  useEffect(() => {
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
      <div className={s.card} role="dialog" aria-modal="true" aria-label="Keyboard shortcuts" onBlur={(e) => !e.currentTarget.contains(e.relatedTarget) && search.current?.focus()}>
        <Module
          title="Keyboard shortcuts"
          scroll
          className={s.mod}
          actions={<IconButton icon="close" label="Close" size="sm" shortcut="Escape" onClick={() => shell.openShortcuts(false)} />}
          footer={<Footer />}
        >
          <div ref={top} className={s.top} onKeyDown={pageKeys}>
            <TextInput ref={search} value={query} icon="search" placeholder="Search every tool, e.g. zoom, copy, Ctrl" autoFocus onChange={setQuery} onCommit={setQuery} />
            {/* no tab is lit while a search is looking through all of them */}
            <Segmented<string>
              fit
              tablist="Tool"
              options={lists.map((l) => ({ value: l.id, label: l.label }))}
              value={words.length ? '' : tab}
              onChange={(v) => {
                setTab(v as ToolId);
                setQuery('');
              }}
            />
          </div>
          <div className={s.body}>
            <Column title={words.length ? 'Every tool' : (mine?.label ?? '')} groups={left} empty={words.length ? 'No tool key matches.' : 'This tool has no keys of its own.'} />
            <Column title="Everywhere" groups={right} empty="No match." />
          </div>
        </Module>
      </div>
    </div>
  );
}

function Footer() {
  return (
    <div className={s.foot}>
      <span>
        <Kbd>?</Kbd> or <Kbd>F1</Kbd> opens this
      </span>
      <span>
        <Kbd>Esc</Kbd> closes it
      </span>
      <span>
        In a text box, single keys type; keys with <Kbd>Ctrl</Kbd> or <Kbd>Alt</Kbd> still work
      </span>
    </div>
  );
}

function Column({ title, groups, empty }: { title: string; groups: Group[]; empty: string }) {
  return (
    <section className={s.col} aria-label={title}>
      <h3 className={s.head}>{title}</h3>
      {groups.length === 0 && <p className={s.empty}>{empty}</p>}
      {groups.map((g) => (
        <div key={g.title + (g.rows[0]?.tool ?? '')} className={s.group}>
          <h4 className={s.sub}>{g.title}</h4>
          <dl className={s.rows}>
            {g.rows.map((r, i) => (
              <RowView key={`${r.keys}${r.tool ?? ''}${i}`} row={r} />
            ))}
          </dl>
        </div>
      ))}
    </section>
  );
}

function RowView({ row: r }: { row: Row }) {
  return (
    <div className={cx(s.row, r.off && s.off)}>
      <dt className={s.keys}>
        {[r.keys, ...(r.also ?? []), ...(r.shown ?? [])].map((k, i) => (
          <Fragment key={k}>
            {i > 0 && <span className={s.word}>or</span>}
            <Caps keys={k} />
            {i === 0 && r.to && (
              <>
                <span className={s.word}>to</span>
                <Caps keys={r.to} />
              </>
            )}
          </Fragment>
        ))}
      </dt>
      <dd className={s.label}>
        <span className={s.main}>
          {r.label}
          {r.when && <span className={s.tag}>{r.when}</span>}
          {r.tool && <span className={s.tag}>{r.tool}</span>}
        </span>
        {r.us && (
          <span className={s.us}>
            US keyboard:{' '}
            {r.us.map((k, i) => (
              <Fragment key={k}>
                {i > 0 && <span className={s.word}>or</span>}
                <Caps keys={k} />
              </Fragment>
            ))}
          </span>
        )}
      </dd>
    </div>
  );
}

/** arrow keys are drawn, not typed: the brief allows no arrow character in a UI string */
const ARROWS: Record<string, IconName> = { Left: 'arrow_back', Right: 'arrow_forward', Up: 'arrow_upward', Down: 'arrow_downward' };

function Caps({ keys }: { keys: string }) {
  return (
    <>
      {keyCaps(keys).map((k, i) => (
        <Kbd key={i}>{ARROWS[k] ? <span role="img" aria-label={k} className={s.arrow}><Icon name={ARROWS[k]} size={14} /></span> : k}</Kbd>
      ))}
    </>
  );
}
