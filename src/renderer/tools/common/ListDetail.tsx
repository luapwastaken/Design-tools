// A list with the chosen item's detail beside it (UX pass): Build's methods, the colour checks.
import { useId, useRef, type KeyboardEvent, type ReactNode } from 'react';
import type { IconName } from '../../shell/tool.ts';
import { cx } from '../../ui/cx.ts';
import { Icon } from '../../ui/index.ts';
import s from './ListDetail.module.css';

/** `ok` set: a check's verdict, drawn as error or check_circle; unset: `icon` */
export type ListItem = { id: string; label: string; verdict: string; detail: ReactNode; ok?: boolean; icon?: IconName };

const STEP: Record<string, number> = { ArrowUp: -1, ArrowLeft: -1, ArrowDown: 1, ArrowRight: 1 };

/**
 * Problems (`ok === false`) first, in their given order, then the rest (spec: "problems first");
 * `value` null opens the first problem, else the first item. One Tab stop, arrows move (brief §6).
 */
export function ListDetail({ items: given, value, onChange }: { items: ListItem[]; value: string | null; onChange(id: string): void }) {
  const items = given.filter((i) => i.ok === false).concat(given.filter((i) => i.ok !== false));
  // with no choice made, the problem it opened on stays open once fixed rather than jump to the next
  // one; remount it (a key) to open on the first problem again
  const opened = useRef<string | null>(null);
  const uid = useId();
  if (value !== null) opened.current = null;
  const current = items.find((i) => i.id === (value ?? opened.current)) ?? items.find((i) => i.ok === false) ?? items[0];
  if (value === null && current?.ok === false) opened.current = current.id;

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const n = items.length;
    const at = items.indexOf(current);
    const i = e.key === 'Home' ? 0 : e.key === 'End' ? n - 1 : e.key in STEP ? (at + STEP[e.key] + n) % n : -1;
    if (i < 0 || !n) return;
    e.preventDefault();
    onChange(items[i].id);
    (e.currentTarget.children[i] as HTMLElement | undefined)?.focus();
  };

  return (
    <div className={s.ld}>
      <div role="tablist" aria-orientation="vertical" className={s.list} onKeyDown={onKeyDown}>
        {items.map((it) => {
          const on = it === current;
          const icon = it.ok === undefined ? it.icon : it.ok ? 'check_circle' : 'error';
          return (
            <button
              key={it.id}
              type="button"
              role="tab"
              id={`${uid}${it.id}`}
              aria-selected={on}
              tabIndex={on ? 0 : -1}
              className={cx(s.row, on && s.on)}
              onClick={() => onChange(it.id)}
            >
              {icon ? <Icon name={icon} fill={it.ok === false} className={cx(s.icon, it.ok === false && s.bad)} /> : <span />}
              <span className={s.label}>{it.label}</span>
              {it.ok !== undefined ? <Icon name="chevron_right" size={16} className={s.chev} /> : <span />}
              <span className={s.verdict}>{it.verdict}</span>
            </button>
          );
        })}
      </div>
      <div role="tabpanel" aria-labelledby={current && `${uid}${current.id}`} className={s.detail}>
        {current?.detail}
      </div>
    </div>
  );
}
