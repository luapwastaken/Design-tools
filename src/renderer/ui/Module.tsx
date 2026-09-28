import { useId, type ReactNode } from 'react';
import { cx } from './cx.ts';
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
};

/** A docked module: header strip with the mono title, then the body (brief §5). */
export function Module({ title, sub, readout, actions, children, scroll, flush, className, footer }: ModuleProps) {
  const id = useId();
  return (
    <section className={cx(s.mod, className)} aria-labelledby={id}>
      <header className={s.head}>
        <h2 id={id} className={s.title}>
          {title}
        </h2>
        {sub && <span className={s.sub}>{sub}</span>}
        <span className={s.grow} />
        {readout !== undefined && <span className={s.readout}>{readout}</span>}
        {actions}
      </header>
      <div className={cx(s.body, scroll && s.scroll, flush && s.flush)}>{children}</div>
      {footer && <footer className={s.foot}>{footer}</footer>}
    </section>
  );
}
