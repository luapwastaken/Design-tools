import { useEffect, useRef, type KeyboardEvent, type ReactNode } from 'react';
import { cx } from '../../ui/cx.ts';
import { Tooltip } from '../../ui/index.ts';
import s from './Section.module.css';

/**
 * A colour tool's panel: a 46px header (title, a dim sub-label, actions on the right) over a body.
 * The colour tools are built from these instead of the canvas + inspector the other tools share.
 */
export function Section({ title, sub, actions, className, bodyClassName, children }: {
  title: ReactNode;
  sub?: ReactNode;
  actions?: ReactNode;
  className?: string;
  bodyClassName?: string;
  children?: ReactNode;
}) {
  return (
    <section className={cx(s.section, className)}>
      <header className={s.head}>
        <h2 className={s.title}>{title}</h2>
        {sub != null && <span className={s.sub}>{sub}</span>}
        {actions && <span className={s.actions}>{actions}</span>}
      </header>
      <div className={cx(s.body, bodyClassName)}>{children}</div>
    </section>
  );
}

/** One tab of a TabbedSection. A new feature is one more entry in the array. */
export type SectionTab = {
  id: string;
  label: string;
  /** a problem count shown on the tab (danger tone); 0 or absent shows nothing */
  badge?: number;
  /** the key that opens it (Alt+2): its tooltip says so, since a tab strip shows no key caps */
  shortcut?: string;
  /** why it can't open yet (its tooltip-free reason is announced to screen readers) */
  disabled?: string;
  render(): ReactNode;
};

const STEP: Record<string, number> = { ArrowLeft: -1, ArrowRight: 1 };

/** A Section whose header is a tab strip. One Tab stop; the arrows move and choose. */
export function TabbedSection({ tabs, value, onChange, className, bodyClassName, actions }: {
  tabs: SectionTab[];
  value: string;
  onChange(id: string): void;
  className?: string;
  bodyClassName?: string;
  /** right-aligned in the tab strip */
  actions?: ReactNode;
}) {
  const strip = useRef<HTMLDivElement>(null);
  const open = tabs.filter((t) => !t.disabled);
  const current = tabs.find((t) => t.id === value && !t.disabled) ?? open[0];
  // a strip wider than its pane scrolls (without a bar): the tab you are on is always one you can see
  useEffect(() => {
    (strip.current?.querySelector('[aria-selected="true"]') as HTMLElement | null)?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }, [current?.id]);
  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const n = open.length;
    const at = Math.max(0, open.findIndex((t) => t.id === current?.id));
    const i = e.key === 'Home' ? 0 : e.key === 'End' ? n - 1 : e.key in STEP ? (at + STEP[e.key] + n) % n : -1;
    if (i < 0 || !n) return;
    e.preventDefault();
    onChange(open[i].id);
    (strip.current?.querySelector(`[data-tab="${open[i].id}"]`) as HTMLElement | null)?.focus();
  };
  return (
    <section className={cx(s.section, className)}>
      <header className={cx(s.head, s.tabsHead)}>
        <div ref={strip} role="tablist" className={s.tabs} onKeyDown={onKeyDown}>
          {tabs.map((t) => {
            const on = t.id === current?.id;
            return (
              <Tooltip key={t.id} content={t.label} shortcut={t.shortcut} disabled={!t.shortcut}>
                <button
                  type="button"
                  role="tab"
                  data-tab={t.id}
                  id={`tab-${t.id}`}
                  aria-keyshortcuts={t.shortcut}
                  aria-selected={on}
                  aria-controls={`tabpanel-${t.id}`}
                  aria-label={t.badge ? `${t.label}, ${t.badge} to look at` : undefined}
                  aria-description={t.disabled}
                  tabIndex={on ? 0 : -1}
                  disabled={!!t.disabled}
                  className={cx(s.tab, on && s.on)}
                  onClick={() => onChange(t.id)}
                >
                  {t.label}
                  {!!t.badge && <span className={s.badge}>{t.badge > 99 ? '99+' : t.badge}</span>}
                </button>
              </Tooltip>
            );
          })}
        </div>
        {actions && <span className={s.actions}>{actions}</span>}
      </header>
      <div role="tabpanel" id={current ? `tabpanel-${current.id}` : undefined} aria-labelledby={current ? `tab-${current.id}` : undefined} className={cx(s.body, bodyClassName)}>
        {current?.render()}
      </div>
    </section>
  );
}
