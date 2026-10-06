import { useEffect, useId, useLayoutEffect, useRef, useState, useSyncExternalStore, type HTMLAttributes, type Ref } from 'react';
import { createPortal } from 'react-dom';
import { cx } from './cx.ts';
import { Icon } from './Icon.tsx';
import { formatKeys } from './Kbd.tsx';
import { SwatchStrip } from './SwatchStrip.tsx';
import { isAction, menu, menuStore, type MenuItem, type OpenMenu } from './menu.ts';
import { placeAtPoint, placeBelow, placeBeside } from './popover.ts';
import { Tooltip } from './Tooltip.tsx';
import s from './Menu.module.css';

type ListProps = {
  items: MenuItem[];
  hot?: number;
  idBase?: string;
  onHover?(i: number, row: HTMLElement): void;
  onActivate?(i: number, row: HTMLElement): void;
  /** rows are listbox options (a Select) rather than menu items */
  options?: boolean;
  ref?: Ref<HTMLDivElement>;
} & Omit<HTMLAttributes<HTMLDivElement>, 'children'>;

/** The rows of a menu on its popover; the host positions it. */
export function MenuList({ items, hot = -1, idBase, onHover, onActivate, options, className, ref, ...div }: ListProps) {
  const radio = items.some((i) => isAction(i) && i.checked !== undefined);
  const role = options ? 'option' : radio ? 'menuitemradio' : 'menuitem';
  return (
    <div ref={ref} className={cx(s.pop, className)} {...div}>
      {items.map((it, i) => {
        if (it === 'separator') return <div key={i} role="separator" className={s.sep} />;
        if (!isAction(it)) return <div key={i} className={cx('lbl', s.head)}>{it.header}</div>;
        return (
          <div
            key={i}
            id={idBase && `${idBase}-${i}`}
            data-index={i}
            role={role}
            aria-checked={radio && !options ? !!it.checked : undefined}
            aria-selected={options ? !!it.checked : undefined}
            aria-disabled={it.disabled || undefined}
            aria-haspopup={it.submenu ? 'menu' : undefined}
            className={cx(s.row, i === hot && s.hot, it.danger && s.danger, it.disabled && s.disabled)}
            onPointerMove={(e) => onHover?.(i, e.currentTarget)}
            onClick={(e) => onActivate?.(i, e.currentTarget)}
          >
            {it.strip ? <SwatchStrip colors={it.strip} height={12} className={s.strip} /> : it.swatch !== undefined ? <span className={s.chip} data-colour style={{ background: it.swatch }} /> : it.icon && <Icon name={it.icon} size={16} />}
            <Tooltip content={it.label} overflowOnly>
              <span className={s.text}>{it.label}</span>
            </Tooltip>
            {it.hint && <span className={s.hint}>{it.hint}</span>}
            {it.shortcut && <kbd>{formatKeys(it.shortcut)}</kbd>}
            {it.submenu && <Icon name="chevron_right" size={16} className={s.end} />}
            {/* in a list with a current row, every row keeps the check's place, so hints line up */}
            {it.checked ? <Icon name="check" size={16} className={s.end} /> : radio && !it.submenu && <span className={s.endSpace} />}
          </div>
        );
      })}
    </div>
  );
}

/** Mount once; draws whatever `menu.open` asked for. */
export function MenuHost() {
  const m = useSyncExternalStore(menuStore.subscribe, menuStore.get);
  return m ? createPortal(<Stack key={m.key} m={m} />, document.body) : null;
}

type Level = { items: MenuItem[]; hot: number; anchor: DOMRect; parent: number };

const usable = (it: MenuItem | undefined) => !!it && isAction(it) && !it.disabled;

/** the next usable row from `from` in direction `dir`, wrapping; -1 if none */
function step(items: MenuItem[], from: number, dir: 1 | -1) {
  const n = items.length;
  for (let k = 1; k <= n; k++) {
    const i = (((from + dir * k) % n) + n) % n;
    if (usable(items[i])) return i;
  }
  return -1;
}

const SWITCH_DELAY = 150; // leaving a row with an open submenu, so a diagonal move can reach it

function Stack({ m }: { m: OpenMenu }) {
  const [levels, setLevels] = useState<Level[]>(() => {
    const { initial = -1 } = m.opts;
    const hot = initial < 0 || usable(m.items[initial]) ? initial : step(m.items, initial, 1);
    return [{ items: m.items, hot, anchor: m.anchor, parent: -1 }];
  });
  const live = useRef(levels);
  live.current = levels;
  const root = useRef<HTMLDivElement>(null);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const uid = useId();

  const row = (k: number, i: number) => root.current?.querySelector<HTMLElement>(`[data-level="${k}"] [data-index="${i}"]`) ?? null;

  /** make row i of level k current, and open its submenu (or close a sibling's) */
  const select = (k: number, i: number, el: HTMLElement | null, subHot: number) =>
    setLevels((ls) => {
      const next = ls.slice(0, k + 1).map((l, j) => (j === k ? { ...l, hot: i } : l));
      const it = next[k].items[i];
      if (el && usable(it) && isAction(it) && it.submenu) next.push({ items: it.submenu, hot: subHot, anchor: el.getBoundingClientRect(), parent: i });
      return next;
    });

  const setHot = (k: number, i: number) => setLevels((ls) => (ls[k].hot === i ? ls : ls.map((l, j) => (j === k ? { ...l, hot: i } : l))));
  /** a keyboard move: the row also scrolls into a long list's view (a hovered row is already in it) */
  const keyTo = (k: number, i: number) => {
    setHot(k, i);
    row(k, i)?.scrollIntoView({ block: 'nearest' });
  };

  const activate = (k: number, i: number, el: HTMLElement | null, fromKey: boolean) => {
    const it = live.current[k].items[i];
    if (!usable(it) || !isAction(it)) return;
    if (it.submenu) return select(k, i, el, fromKey ? step(it.submenu, -1, 1) : -1);
    menu.close(); // focus goes back first, so onSelect may move it
    it.onSelect?.();
  };

  const hover = (k: number, i: number, el: HTMLElement) => {
    const ls = live.current;
    const sub = ls[k + 1];
    if (ls[k].hot === i && (!sub || sub.parent === i)) return clearTimeout(timer.current);
    clearTimeout(timer.current);
    if (!usable(ls[k].items[i])) return setHot(k, -1);
    if (!sub) return select(k, i, el, -1);
    setHot(k, i);
    timer.current = setTimeout(() => select(k, i, el, -1), SWITCH_DELAY);
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const ls = live.current;
      const k = ls.length - 1;
      const { items, hot } = ls[k];
      const cur = items[hot];
      switch (e.key) {
        case 'ArrowDown':
        case 'ArrowUp':
          keyTo(k, step(items, hot < 0 && e.key === 'ArrowUp' ? 0 : hot, e.key === 'ArrowDown' ? 1 : -1));
          break;
        case 'Home':
          keyTo(k, step(items, -1, 1));
          break;
        case 'End':
          keyTo(k, step(items, items.length, -1));
          break;
        case 'ArrowRight':
          if (usable(cur) && isAction(cur) && cur.submenu) select(k, hot, row(k, hot), step(cur.submenu, -1, 1));
          break;
        case 'ArrowLeft':
          if (k > 0) setLevels(ls.slice(0, k));
          break;
        case 'Escape':
          if (k > 0) setLevels(ls.slice(0, k));
          else menu.close();
          break;
        case 'Enter':
        case ' ':
          if (hot >= 0) activate(k, hot, row(k, hot), true);
          break;
        case 'Tab':
          return menu.close(); // focus is back on the trigger, and the Tab moves on from there
        case 'Shift':
        case 'Control':
        case 'Alt':
        case 'Meta':
          return;
        default: {
          if (e.key.length !== 1 || e.ctrlKey || e.altKey || e.metaKey) return menu.close(); // a shortcut: let it through
          const ch = e.key.toLowerCase();
          const n = items.length;
          for (let j = 1; j <= n; j++) {
            const i = (hot + j + n) % n;
            const it = items[i];
            if (usable(it) && isAction(it) && it.label.toLowerCase().startsWith(ch)) {
              keyTo(k, i);
              break;
            }
          }
        }
      }
      e.preventDefault();
      e.stopImmediatePropagation();
    };
    const inside = (t: EventTarget | null) => t instanceof Node && (root.current?.contains(t) || m.opts.owner?.contains(t));
    const onDown = (e: PointerEvent) => inside(e.target) || menu.close();
    const onScroll = (e: Event) => inside(e.target) || menu.close();
    const close = () => menu.close();
    addEventListener('keydown', onKey, true);
    addEventListener('pointerdown', onDown, true);
    addEventListener('scroll', onScroll, true);
    addEventListener('blur', close);
    addEventListener('resize', close);
    return () => {
      clearTimeout(timer.current);
      removeEventListener('keydown', onKey, true);
      removeEventListener('pointerdown', onDown, true);
      removeEventListener('scroll', onScroll, true);
      removeEventListener('blur', close);
      removeEventListener('resize', close);
    };
  }, []);

  // keyboard focus sits on the deepest panel, so keys never reach a field underneath
  useEffect(() => {
    root.current?.querySelector<HTMLElement>(`[data-level="${levels.length - 1}"]`)?.focus({ preventScroll: true });
  }, [levels.length]);

  return (
    <div ref={root} className={s.stack}>
      {levels.map((lv, k) => (
        <Panel
          key={k}
          k={k}
          level={lv}
          m={m}
          idBase={`${uid}${k}`}
          onHover={hover}
          onActivate={(k, i, el) => activate(k, i, el, false)}
          onEnter={(k) => {
            clearTimeout(timer.current);
            if (k > 0) setHot(k - 1, live.current[k].parent);
          }}
          onLeave={(k) => {
            if (!live.current[k + 1]) setHot(k, -1);
          }}
        />
      ))}
    </div>
  );
}

type PanelProps = {
  k: number;
  level: Level;
  m: OpenMenu;
  idBase: string;
  onHover(k: number, i: number, el: HTMLElement): void;
  onActivate(k: number, i: number, el: HTMLElement): void;
  onEnter(k: number): void;
  onLeave(k: number): void;
};

function Panel({ k, level, m, idBase, onHover, onActivate, onEnter, onLeave }: PanelProps) {
  const ref = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const el = ref.current!;
    const w = el.offsetWidth;
    const h = el.offsetHeight;
    const a = level.anchor;
    const p = k > 0 ? placeBeside(a, w, h) : m.atPoint ? placeAtPoint(a.x, a.y, w, h) : placeBelow(a, w, h, 'start', 4);
    el.style.left = `${p.x}px`;
    el.style.top = `${p.y}px`;
    el.style.transformOrigin = p.origin;
    // a Select opens on its value, which may sit below the fold of a long list
    if (level.hot >= 0) el.querySelector(`[data-index="${level.hot}"]`)?.scrollIntoView({ block: 'nearest' });
  }, [level.anchor]);
  const width = k === 0 ? m.opts.width : undefined;
  return (
    <MenuList
      ref={ref}
      items={level.items}
      hot={level.hot}
      idBase={idBase}
      data-level={k}
      role={k === 0 ? (m.opts.role ?? 'menu') : 'menu'}
      options={k === 0 && m.opts.role === 'listbox'}
      tabIndex={-1}
      aria-activedescendant={level.hot >= 0 ? `${idBase}-${level.hot}` : undefined}
      className={s.floating}
      style={width === undefined ? undefined : { width, minWidth: width }}
      onHover={(i, el) => onHover(k, i, el)}
      onActivate={(i, el) => onActivate(k, i, el)}
      onPointerEnter={() => onEnter(k)}
      onPointerLeave={() => onLeave(k)}
      onContextMenu={(e) => e.preventDefault()}
    />
  );
}
