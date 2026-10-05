import { useId, type ReactNode } from 'react';
import { cx } from './cx.ts';
import { Icon } from './Icon.tsx';
import s from './Module.module.css';

export type ModuleProps = {
  title: string;
  sub?: string;
  /** right-aligned mono readout in the header */
  readout?: ReactNode;
  /** right-aligned controls in the header (small IconButtons, a compact NumberField) */
  actions?: ReactNode;
  children?: ReactNode;
  /** only the body scrolls; the header stays */
  scroll?: boolean;
  /** body without padding, for lists that run edge to edge */
  flush?: boolean;
  className?: string;
  footer?: ReactNode;
  /** a twirl on the title that folds the body away (an InspectorGroup, which holds the state) */
  collapse?: { open: boolean; onToggle(): void };
};

/** A docked module: header strip with the sentence-case title, then the body (brief §5). */
export function Module({ title, sub, readout, actions, children, scroll, flush, className, footer, collapse }: ModuleProps) {
  const id = useId();
  const open = collapse?.open ?? true;
  const name = (
    <>
      {collapse && <Icon name={open ? 'keyboard_arrow_down' : 'keyboard_arrow_right'} />}
      <span className={s.title}>{title}</span>
    </>
  );
  return (
    <section className={cx(s.mod, collapse && !open && s.folded, className)} aria-labelledby={id}>
      <header className={cx(s.head, collapse && s.twirl)}>
        <h2 id={id} className={s.name}>
          {collapse ? (
            <button type="button" className={s.toggle} aria-expanded={open} onClick={collapse.onToggle}>
              {name}
            </button>
          ) : (
            name
          )}
        </h2>
        {sub && <span className={s.sub}>{sub}</span>}
        <span className={s.grow} />
        {readout !== undefined && <span className={s.readout}>{readout}</span>}
        {actions}
      </header>
      <div className={cx(s.body, scroll && s.scroll, flush && s.flush)} hidden={!open}>
        {children}
      </div>
      {footer && open && <footer className={s.foot}>{footer}</footer>}
    </section>
  );
}
