import type { ReactNode } from 'react';
import s from './Kbd.module.css';

const NAMES: Record<string, string> = { Delete: 'Del', Escape: 'Esc' };

/** 'Ctrl+Shift+Z' to 'Ctrl Shift Z', the way keys are printed in the UI. */
export const formatKeys = (keys: string): string => keys.split('+').map((k) => NAMES[k] ?? k).join(' ');

/** 'Ctrl+Z' to 'Control+Z' for aria-keyshortcuts. */
export const ariaKeys = (keys: string): string => keys.replace(/\bCtrl\b/g, 'Control');

export function Kbd({ children }: { children: ReactNode }) {
  return <kbd className={s.kbd}>{children}</kbd>;
}
