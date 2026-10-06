// The Mixer's tubes and mixing well (the inspector in Paint mode). Click a tube to load the brush;
// Shift-click it, drag it into the well or use its menu to add a part; the well's mix, by km.ts,
// loads the brush. The palette's colours sit under the tubes, a ramp at a time, and work the same way
// (the Ramps panel's steps load the brush too, and Shift-click or a drag adds a part).
import { useEffect, useRef, type KeyboardEvent, type MouseEvent, type PointerEvent, type RefObject } from 'react';
import { cssColor, deltaE, toHex, type Oklch } from '../../../shared/color/index.ts';
import { Button, IconButton, menu, NumberField, Tooltip } from '../../ui/index.ts';
import { cx } from '../../ui/cx.ts';
import { PARTS_MAX, type Source, type WellPart } from './paint-sources.ts';
import s from './Mixer.module.css';

const SLOP = 4;
const HOW = 'Click to load the brush. Shift-click or drag into the well to add a part.';
const STEP: Record<string, number> = { ArrowLeft: -1, ArrowUp: -1, ArrowRight: 1, ArrowDown: 1 };

function describe(src: Source): string {
  if (src.swatch) return `${src.name} (palette colour)`;
  const { opacity, granulation, staining } = src.pigment;
  const traits = [opacity < 0.45 ? 'transparent' : opacity > 0.8 ? 'opaque' : 'semi-opaque', granulation > 0.25 && 'granulating', staining > 0.7 && 'staining'];
  return `${src.name} · ${traits.filter(Boolean).join(', ')}`;
}

/** `onKey` is this drag's own Esc listener: the one added is the one removed, however often the tray renders */
type Drag = { id: string; pointer: number; x: number; y: number; moving: boolean; over: boolean; onKey(e: globalThis.KeyboardEvent): void };

export function Tray(p: {
  sources: Source[];
  /** the loaded paint's id */
  current: string;
  onLoad(id: string): void;
  onAddToWell(id: string): void;
  well: RefObject<HTMLElement | null>;
  /** a paint is being dragged over the well */
  onOver(over: boolean): void;
}) {
  const drag = useRef<Drag | null>(null);
  /** a drag ends in a click on the chip it started from, which mustn't load the brush */
  const dragged = useRef(false);
  const ghost = useRef<HTMLSpanElement>(null);
  const live = useRef(p);
  live.current = p;

  const overWell = (x: number, y: number) => {
    const r = live.current.well.current?.getBoundingClientRect();
    return !!r && x >= r.left && x <= r.right && y >= r.top && y <= r.bottom;
  };
  const stop = (drop: boolean) => {
    const d = drag.current;
    drag.current = null;
    if (!d) return;
    removeEventListener('keydown', d.onKey, true);
    if (ghost.current) ghost.current.hidden = true;
    live.current.onOver(false);
    dragged.current = d.moving;
    if (drop && d.moving && d.over) live.current.onAddToWell(d.id);
  };
  useEffect(() => () => stop(false), []);

  const down = (e: PointerEvent<HTMLButtonElement>, src: Source) => {
    if (e.button !== 0 || drag.current) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    dragged.current = false;
    const onKey = (k: globalThis.KeyboardEvent) => {
      if (k.key !== 'Escape') return;
      k.preventDefault();
      k.stopPropagation();
      stop(false);
    };
    drag.current = { id: src.id, pointer: e.pointerId, x: e.clientX, y: e.clientY, moving: false, over: false, onKey };
    addEventListener('keydown', onKey, true);
    if (ghost.current) ghost.current.style.background = cssColor(src.pigment.oklch);
  };
  const move = (e: PointerEvent<HTMLButtonElement>) => {
    const d = drag.current;
    if (!d || d.pointer !== e.pointerId) return;
    if (!d.moving && Math.hypot(e.clientX - d.x, e.clientY - d.y) < SLOP) return;
    d.moving = true;
    const g = ghost.current!;
    g.hidden = false;
    g.style.transform = `translate(${e.clientX}px, ${e.clientY}px)`;
    const over = overWell(e.clientX, e.clientY);
    if (over !== d.over) live.current.onOver((d.over = over));
  };
  const context = (e: MouseEvent<HTMLButtonElement>, src: Source) => {
    e.preventDefault();
    const at = e.detail === 0 ? e.currentTarget.getBoundingClientRect() : { x: e.clientX, y: e.clientY };
    menu.open(
      at,
      [
        { label: 'Load the brush', icon: 'brush', onSelect: () => live.current.onLoad(src.id) },
        { label: 'Add a part to the well', icon: 'add', onSelect: () => live.current.onAddToWell(src.id) },
      ],
      { owner: e.currentTarget, initial: e.detail === 0 ? 0 : undefined },
    );
  };

  // one Tab stop: the loaded paint (or the first); arrow keys move along the tray and load
  const at = p.sources.findIndex((x) => x.id === p.current);
  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const n = p.sources.length;
    const i = e.key === 'Home' ? 0 : e.key === 'End' ? n - 1 : e.key in STEP ? (Math.max(at, 0) + STEP[e.key] + n) % n : -1;
    if (i < 0 || !n) return;
    e.preventDefault();
    p.onLoad(p.sources[i].id);
    e.currentTarget.querySelectorAll<HTMLElement>('[role="radio"]')[i]?.focus();
  };

  const chip = (src: Source, i: number) => (
    <Tooltip key={src.id} content={`${describe(src)}. ${HOW}`}>
      <button
        type="button"
        role="radio"
        className={cx(s.chip, src.id === p.current && s.on)}
        data-colour
        style={{ background: cssColor(src.pigment.oklch) }}
        aria-label={src.name}
        aria-checked={src.id === p.current}
        tabIndex={i === at || (at < 0 && i === 0) ? 0 : -1}
        onClick={(e) => {
          if (dragged.current) dragged.current = false;
          else if (e.shiftKey) p.onAddToWell(src.id);
          else p.onLoad(src.id);
        }}
        onPointerDown={(e) => down(e, src)}
        onPointerMove={move}
        onPointerUp={() => stop(true)}
        onLostPointerCapture={() => stop(false)}
        onContextMenu={(e) => context(e, src)}
      />
    </Tooltip>
  );
  const pigments = p.sources.filter((x) => !x.swatch);
  // the palette's colours a ramp at a time, each under its name, so a colour is found by its ramp
  const sets = p.sources
    .filter((x) => x.swatch)
    .reduce<{ key: string; name: string; list: Source[] }[]>((out, x) => {
      const last = out.at(-1);
      if (last && last.key === x.set?.key) last.list.push(x);
      else out.push({ key: x.set?.key ?? x.id, name: x.set?.name ?? '', list: [x] });
      return out;
    }, []);
  return (
    <div className={s.tray} role="radiogroup" aria-label="Paints for the brush" onKeyDown={onKeyDown}>
      <div className={s.tubes}>{pigments.length ? pigments.map((x) => chip(x, p.sources.indexOf(x))) : <span className={s.hint}>Tick the paints you own to fill the tray.</span>}</div>
      {sets.map((set) => (
        <div key={set.key} className={s.set} data-set={set.key}>
          <Tooltip content={set.name} overflowOnly>
            <span className={s.setLabel}>{set.name}</span>
          </Tooltip>
          <div className={s.tubes}>{set.list.map((x) => chip(x, p.sources.indexOf(x)))}</div>
        </div>
      ))}
      <span ref={ghost} className={s.ghost} data-colour hidden aria-hidden="true" />
    </div>
  );
}

export function Well(p: {
  well: WellPart[];
  sources: Source[];
  mix: Oklch | null;
  /** the colour the Mix it recipes aim at (the palette's selected one): the well's distance to it */
  target: Oklch | null;
  /** the brush holds the well's mix */
  loaded: boolean;
  /** a paint is being dragged over it */
  over: boolean;
  onChange(well: WellPart[]): void;
  /** empty it, with an Undo */
  onEmpty(): void;
  onLoad(): void;
  ref: RefObject<HTMLDivElement | null>;
}) {
  const name = (id: string) => p.sources.find((x) => x.id === id)?.name ?? 'A paint no longer in the tray';
  const colour = (id: string) => p.sources.find((x) => x.id === id)?.pigment.oklch;
  const e = p.mix && p.target ? deltaE(p.mix, p.target) : null;
  return (
    <div ref={p.ref} role="group" className={cx(s.well, p.over && s.wellOver)} aria-label="Mixing well">
      <div className={s.wellHead}>
        <Tooltip content={p.mix ? 'Load the brush with this mix' : 'Shift-click paints, or drag them here, to mix them'}>
          <button
            type="button"
            className={cx(s.mix, !p.mix && s.mixEmpty, p.loaded && s.on)}
            data-colour
            style={p.mix ? { background: cssColor(p.mix) } : undefined}
            aria-label={p.mix ? `Well mix ${toHex(p.mix).toUpperCase()}: load the brush` : 'The well is empty'}
            disabled={!p.mix}
            onClick={p.onLoad}
          />
        </Tooltip>
        <div className={s.wellText}>
          <b>The well</b>
          {p.mix ? <span className={s.hex}>{toHex(p.mix).toUpperCase()}</span> : <span className={s.hint}>Empty. Shift-click a tube to add it.</span>}
          {e !== null && (
            <span className={cx(s.de, e < 2 ? s.match : e < 5 && s.close)}>
              dE {e.toFixed(1)} · {e < 2 ? 'match' : e < 5 ? 'close' : 'near'}
            </span>
          )}
        </div>
      </div>
      {p.well.map((w) => (
        <span key={w.id} className={s.part}>
          <i className={s.partChip} data-colour style={colour(w.id) ? { background: cssColor(colour(w.id)!) } : undefined} />
          <span className={s.partName}>{name(w.id)}</span>
          <NumberField
            label={`Parts of ${name(w.id)}`}
            hideLabel
            size="sm"
            width={52}
            value={w.parts}
            min={1}
            max={PARTS_MAX}
            onChange={(parts) => p.onChange(p.well.map((x) => (x.id === w.id ? { ...x, parts } : x)))}
          />
          <IconButton icon="close" label={`Take ${name(w.id)} out`} size="xs" onClick={() => p.onChange(p.well.filter((x) => x.id !== w.id))} />
        </span>
      ))}
      <div className={s.wellActs}>
        <Button size="xs" icon="delete_sweep" disabled={!p.well.length} onClick={p.onEmpty}>
          Empty well
        </Button>
        <Button size="xs" icon="brush" disabled={!p.mix || p.loaded} onClick={p.onLoad}>
          {p.loaded ? 'On the brush' : 'Load brush'}
        </Button>
      </div>
    </div>
  );
}
