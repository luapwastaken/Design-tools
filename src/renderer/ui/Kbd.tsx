import type { ReactNode } from 'react';
import { formatKeys } from './keynames.ts';
import s from './Kbd.module.css';

export { formatKeys };

/** 'Ctrl+Z' to 'Control+Z' for aria-keyshortcuts. */
export const ariaKeys = (keys: string): string => keys.replace(/\bCtrl\b/g, 'Control');

export function Kbd({ children }: { children: ReactNode }) {
  return <kbd className={s.kbd}>{children}</kbd>;
}
