import { useLayoutEffect, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import { cx } from '../../ui/cx.ts';
import { Icon, menu, Tooltip } from '../../ui/index.ts';
import { foldedTabs } from './tabFit.ts';
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
export function TabbedSection({ tabs, value, onChange, className, bodyClassName, actions, lead, leadClassName }: {
  tabs: SectionTab[];
  value: string;
  onChange(id: string): void;
  className?: string;
  bodyClassName?: string;
  /** right-aligned in the tab strip */
  actions?: ReactNode;
  /** before the first tab, in a box `leadClassName` sizes: keeps the tabs where a column beside the section would have put them */
  lead?: ReactNode;
  leadClassName?: string;
}) {
  const strip = useRef<HTMLDivElement>(null);
  const moreBtn = useRef<HTMLButtonElement>(null);
  const moreW = useRef(84);
  const open = tabs.filter((t) => !t.disabled);
  const current = tabs.find((t) => t.id === value && !t.disabled) ?? open[0];
  // tabs that do not fit the strip fold into a More menu; every tab stays rendered (hidden) so its width is known
  const [folded, setFolded] = useState<string[]>([]);
  const fit = () => {
    const el = strip.current;
    if (!el) return;
    const btns = tabs.map((t) => el.querySelector<HTMLElement>(`[data-tab="${t.id}"]`));
    if (btns.some((b) => !b)) return;
    if (moreBtn.current) moreW.current = moreBtn.current.offsetWidth;
    const gone = foldedTabs(btns.map((b) => b!.offsetWidth), tabs.findIndex((t) => t.id === current?.id), el.clientWidth, moreW.current, 4);
    const ids = tabs.filter((_, i) => gone[i]).map((t) => t.id);
    setFolded((was) => (was.join() === ids.join() ? was : ids));
  };
  const sig = tabs.map((t) => `${t.id}:${t.label}:${t.badge ?? 0}`).join();
  useLayoutEffect(() => {
    fit();
    const el = strip.current;
    if (!el) return;
    const ro = new ResizeObserver(fit);
    ro.observe(el);
    return () => ro.disconnect();
    // fit reads the latest props through the closure of this render
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sig, current?.id]);
  const hiddenTabs = tabs.filter((t) => folded.includes(t.id));
  const shown = open.filter((t) => !folded.includes(t.id));
  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const n = shown.length;
    const at = Math.max(0, shown.findIndex((t) => t.id === current?.id));
    const i = e.key === 'Home' ? 0 : e.key === 'End' ? n - 1 : e.key in STEP ? (at + STEP[e.key] + n) % n : -1;
    if (i < 0 || !n) return;
    e.preventDefault();
    onChange(shown[i].id);
    (strip.current?.querySelector(`[data-tab="${shown[i].id}"]`) as HTMLElement | null)?.focus();
  };
  const openMore = (e: { currentTarget: HTMLElement }) =>
    menu.open(
      e.currentTarget.getBoundingClientRect(),
      hiddenTabs.map((t) => ({
        label: t.badge ? `${t.label} (${t.badge})` : t.label,
        shortcut: t.shortcut,
        disabled: !!t.disabled,
        onSelect: () => onChange(t.id),
      })),
      { owner: e.currentTarget },
    );
  return (
    <section className={cx(s.section, className)}>
      <header className={cx(s.head, s.tabsHead)}>
        {lead != null && <div className={cx(s.lead, leadClassName)}>{lead}</div>}
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
                  aria-hidden={folded.includes(t.id) || undefined}
                  className={cx(s.tab, on && s.on, folded.includes(t.id) && s.folded)}
                  onClick={() => onChange(t.id)}
                >
                  {t.label}
                  {!!t.badge && <span className={s.badge}>{t.badge > 99 ? '99+' : t.badge}</span>}
                </button>
              </Tooltip>
            );
          })}
          {hiddenTabs.length > 0 && (
            <button ref={moreBtn} type="button" className={cx(s.tab, s.more)} aria-haspopup="menu" onClick={openMore}>
              More
              <Icon name="keyboard_arrow_down" size={16} />
            </button>
          )}
        </div>
        {actions && <span className={s.actions}>{actions}</span>}
      </header>
      <div role="tabpanel" id={current ? `tabpanel-${current.id}` : undefined} aria-labelledby={current ? `tab-${current.id}` : undefined} className={cx(s.body, bodyClassName)}>
        {current?.render()}
      </div>
    </section>
  );
}
