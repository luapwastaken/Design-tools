// Add effect (plan unit V): the effects by group on the shared popover, with a search field that
// has the keys (type to narrow, arrows to move, Enter to add, Esc to close). An effect the source
// can't take (datamosh on a still) stays in its place, unavailable, and says why.
import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { createPortal } from 'react-dom';
import { Icon, Tooltip } from '../../ui/index.ts';
import { cx } from '../../ui/cx.ts';
import { placeBelow } from '../../ui/popover.ts';
import { EFFECTS, GROUPS, type EffectId, type EffectInfo } from './effects/index.ts';
import m from '../../ui/Menu.module.css';
import s from './EffectPicker.module.css';

export const VIDEO_ONLY_TIP = 'Video only: it smears the motion from one frame of a clip into the next, so a still has nothing to smear.';

type Row = { fx: EffectInfo; ok: boolean };

const words = (fx: EffectInfo) => `${fx.label} ${GROUPS.find((g) => g.id === fx.group)?.label ?? ''} ${fx.about}`.toLowerCase();

type Props = {
  anchor: DOMRect;
  /** the control that opened it: focus goes back there, and pressing it again isn't an outside click */
  owner: HTMLElement | null;
  /** whether the source can take a video-only effect */
  video: boolean;
  onPick(id: EffectId): void;
  onClose(): void;
};

export function EffectPicker({ anchor, owner, video, onPick, onClose }: Props) {
  const [query, setQuery] = useState('');
  const [hot, setHot] = useState(0);
  const pop = useRef<HTMLDivElement>(null);
  const list = useRef<HTMLDivElement>(null);
  const uid = useId();

  const groups = useMemo(() => {
    const q = query.trim().toLowerCase();
    return GROUPS.map((g) => ({ ...g, rows: EFFECTS.filter((fx) => fx.group === g.id && (!q || words(fx).includes(q))).map((fx): Row => ({ fx, ok: !fx.videoOnly || video })) })).filter((g) => g.rows.length);
  }, [query, video]);
  const rows = groups.flatMap((g) => g.rows);
  const usable = rows.flatMap((r, i) => (r.ok ? [i] : []));
  const at = usable.includes(hot) ? hot : (usable[0] ?? -1);

  const close = () => {
    onClose();
    owner?.focus();
  };
  const pick = (i: number) => {
    const r = rows[i];
    if (!r?.ok) return;
    close();
    onPick(r.fx.id);
  };

  useLayoutEffect(() => {
    const el = pop.current!;
    const p = placeBelow(anchor, el.offsetWidth, el.offsetHeight, 'start', 4);
    el.style.left = `${p.x}px`;
    el.style.top = `${p.y}px`;
    el.style.transformOrigin = p.origin;
  }, [anchor]);

  useEffect(() => {
    list.current?.querySelector(`[data-index="${at}"]`)?.scrollIntoView({ block: 'nearest' });
  }, [at]);

  useEffect(() => {
    const inside = (t: EventTarget | null) => t instanceof Node && (pop.current?.contains(t) || owner?.contains(t));
    const onDown = (e: PointerEvent) => inside(e.target) || onClose();
    const onScroll = (e: Event) => inside(e.target) || onClose();
    addEventListener('pointerdown', onDown, true);
    addEventListener('scroll', onScroll, true);
    addEventListener('blur', onClose);
    addEventListener('resize', onClose);
    return () => {
      removeEventListener('pointerdown', onDown, true);
      removeEventListener('scroll', onScroll, true);
      removeEventListener('blur', onClose);
      removeEventListener('resize', onClose);
    };
  }, []);

  const onKey = (e: KeyboardEvent<HTMLInputElement>) => {
    const k = usable.indexOf(at);
    const move = (to: number) => usable.length && setHot(usable[(to + usable.length) % usable.length]);
    if (e.key === 'ArrowDown') move(k + 1);
    else if (e.key === 'ArrowUp') move(k < 0 ? usable.length - 1 : k - 1);
    else if (e.key === 'Home' && !query) move(0);
    else if (e.key === 'End' && !query) move(usable.length - 1);
    else if (e.key === 'Enter') pick(at);
    else if (e.key === 'Escape') close();
    else if (e.key === 'Tab') return close();
    else return;
    e.preventDefault();
    e.stopPropagation();
  };

  let n = -1;
  return createPortal(
    <div ref={pop} className={cx(m.pop, s.pop)} role="dialog" aria-label="Add an effect">
      <label className={s.search}>
        <Icon name="search" size={16} />
        <input
          autoFocus
          role="combobox"
          aria-expanded="true"
          aria-controls={`${uid}-list`}
          aria-activedescendant={at >= 0 ? `${uid}-${at}` : undefined}
          aria-autocomplete="list"
          placeholder="Find an effect"
          spellCheck={false}
          autoComplete="off"
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setHot(0);
          }}
          onKeyDown={onKey}
        />
      </label>
      <div ref={list} id={`${uid}-list`} role="listbox" aria-label="Effects" className={s.list}>
        {groups.map((g) => (
          <div key={g.id} role="group" aria-label={g.label}>
            <div className={cx('lbl', m.head)}>{g.label}</div>
            {g.rows.map((r) => {
              const i = ++n;
              const row = (
                <div
                  key={r.fx.id}
                  id={`${uid}-${i}`}
                  data-index={i}
                  role="option"
                  aria-selected={i === at}
                  aria-disabled={!r.ok || undefined}
                  className={cx(m.row, i === at && m.hot, !r.ok && m.disabled)}
                  onPointerMove={() => r.ok && i !== at && setHot(i)}
                  onPointerDown={(e) => e.preventDefault()}
                  onClick={() => pick(i)}
                >
                  <span className={m.text}>{r.fx.label}</span>
                  {r.fx.moving && !r.fx.videoOnly && <Icon name="motion_play" size={16} className={s.moves} />}
                </div>
              );
              return r.ok ? row : <Tooltip key={r.fx.id} content={VIDEO_ONLY_TIP}>{row}</Tooltip>;
            })}
          </div>
        ))}
        {!rows.length && <p className={s.none}>No effect is called “{query.trim()}”.</p>}
      </div>
      <p className={s.foot}>
        <Icon name="motion_play" size={14} /> moves when played
      </p>
    </div>,
    document.body,
  );
}
