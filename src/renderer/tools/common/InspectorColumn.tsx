import type { ReactNode } from 'react';
import s from './InspectorColumn.module.css';

/**
 * The right-hand column of every tool (brief §5): the modules stacked, scrolling together while each
 * module's header stays pinned. F6 lands here as a region of its own (brief §6).
 */
export const InspectorColumn = ({ children }: { children: ReactNode }) => (
  <aside className={s.insp} aria-label="Inspector" data-region="inspector">
    {children}
  </aside>
);
