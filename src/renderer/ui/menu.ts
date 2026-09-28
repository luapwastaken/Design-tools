import type { IconName } from '../shell/tool.ts';

// The one open menu (context menus, submenus, Select lists). Imperative so any handler can open
// one; <MenuHost /> draws it.

export type MenuAction = {
  label: string;
  icon?: IconName;
  shortcut?: string;
  /** mono caps on the right: a Send to target's use label (PALETTE, INKS) */
  hint?: string;
  danger?: boolean;
  disabled?: boolean;
  onSelect?(): void;
  submenu?: MenuItem[];
  /** a content colour leading the row (Select options) */
  swatch?: string;
  /** the current option (Select) */
  checked?: boolean;
};
export type MenuItem = MenuAction | 'separator' | { header: string };

/** a point for a context menu; a rect (the button it drops from) otherwise */
export type MenuAnchor = { x: number; y: number } | DOMRect;

export type MenuOptions = {
  /** fixed width, e.g. the Select it drops from */
  width?: number;
  /** the row that starts current: a Select's value, or 0 (the first usable row) when opened from the keyboard */
  initial?: number;
  /** the control that opened it: pressing it again isn't an outside click */
  owner?: Element | null;
  onClose?(): void;
  role?: 'menu' | 'listbox';
};

export type OpenMenu = {
  key: number;
  anchor: DOMRect;
  atPoint: boolean;
  items: MenuItem[];
  opts: MenuOptions;
  returnFocus: HTMLElement | null;
};

export const isAction = (i: MenuItem): i is MenuAction => typeof i === 'object' && 'label' in i;

let current: OpenMenu | null = null;
let seq = 0;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((f) => f());

export const menu = {
  /** at a point (context menu) or below a rect (a button) */
  open(anchor: MenuAnchor, items: MenuItem[], opts: MenuOptions = {}) {
    menu.close();
    const atPoint = !('width' in anchor);
    current = {
      key: ++seq,
      anchor: atPoint ? new DOMRect(anchor.x, anchor.y, 0, 0) : anchor,
      atPoint,
      items,
      opts,
      returnFocus: document.activeElement instanceof HTMLElement ? document.activeElement : null,
    };
    emit();
  },
  /** focus goes back to where it was before the menu opened */
  close() {
    const m = current;
    if (!m) return;
    current = null;
    emit();
    m.opts.onClose?.();
    if (m.returnFocus?.isConnected) m.returnFocus.focus({ preventScroll: true });
  },
  isOpen: () => current !== null,
};

export const menuStore = {
  subscribe(fn: () => void) {
    listeners.add(fn);
    return () => void listeners.delete(fn);
  },
  get: () => current,
};
