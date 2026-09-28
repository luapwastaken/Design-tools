import { cloneElement, useEffect, useLayoutEffect, useRef, useState, type PointerEvent, type ReactElement, type Ref } from 'react';
import { createPortal } from 'react-dom';
import { cx } from './cx.ts';
import { formatKeys } from './Kbd.tsx';
import { placeBelow } from './popover.ts';
import s from './Tooltip.module.css';

const DELAY = 500;
const WARM = 300; // after a tooltip closes, the next one within this window shows at once
let lastClosed = -Infinity;

type Trigger = {
  onPointerEnter?(e: PointerEvent<Element>): void;
  onPointerLeave?(e: PointerEvent<Element>): void;
  onPointerDown?(e: PointerEvent<Element>): void;
};

/**
 * Our own tooltip (hard rule 6: never `title`). Wraps one element and listens to its pointer
 * events; shows after 500ms of hover, below the trigger, with no transition.
 */
export function Tooltip({ content, shortcut, children, disabled, overflowOnly }: {
  /** default: the trigger's own text (with `overflowOnly`, for rich content like a toast message) */
  content?: string;
  shortcut?: string;
  children: ReactElement<Trigger>;
  disabled?: boolean;
  /** only when the trigger's text is cut off with an ellipsis (it then shows the full text) */
  overflowOnly?: boolean;
}) {
  const [shown, setShown] = useState<{ anchor: DOMRect; text: string } | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const live = useRef({ disabled, shown: false });
  live.current.disabled = disabled;

  const hide = () => {
    clearTimeout(timer.current);
    if (live.current.shown) lastClosed = performance.now();
    live.current.shown = false;
    setShown(null);
  };

  useEffect(() => () => clearTimeout(timer.current), []);

  useEffect(() => {
    if (!shown) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && hide();
    const opts = { capture: true, passive: true };
    addEventListener('pointerdown', hide, opts);
    addEventListener('scroll', hide, opts);
    addEventListener('keydown', onKey, true);
    addEventListener('blur', hide);
    return () => {
      removeEventListener('pointerdown', hide, opts);
      removeEventListener('scroll', hide, opts);
      removeEventListener('keydown', onKey, true);
      removeEventListener('blur', hide);
    };
  }, [shown]);

  const p = children.props;
  const trigger = cloneElement(children, {
    onPointerEnter(e: PointerEvent<Element>) {
      p.onPointerEnter?.(e);
      if (e.pointerType === 'touch') return;
      const el = e.currentTarget;
      clearTimeout(timer.current);
      timer.current = setTimeout(
        () => {
          if (live.current.disabled || !el.isConnected || (overflowOnly && el.scrollWidth <= el.clientWidth)) return;
          live.current.shown = true;
          setShown({ anchor: el.getBoundingClientRect(), text: content ?? el.textContent ?? '' });
        },
        performance.now() - lastClosed < WARM ? 0 : DELAY,
      );
    },
    onPointerLeave(e: PointerEvent<Element>) {
      p.onPointerLeave?.(e);
      hide();
    },
    onPointerDown(e: PointerEvent<Element>) {
      p.onPointerDown?.(e);
      hide();
    },
  });

  return (
    <>
      {trigger}
      {shown && createPortal(<Floating anchor={shown.anchor} content={shown.text} shortcut={shortcut} />, document.body)}
    </>
  );
}

function Floating({ anchor, content, shortcut }: { anchor: DOMRect; content: string; shortcut?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const el = ref.current!;
    const { x, y } = placeBelow(anchor, el.offsetWidth, el.offsetHeight, 'center', 6);
    el.style.left = `${x}px`;
    el.style.top = `${y}px`;
  }, [anchor]);
  return <TipBubble ref={ref} className={s.floating} content={content} shortcut={shortcut} />;
}

/** The tooltip itself, also drawn in place on the controls board. */
export function TipBubble({ content, shortcut, className, ref }: { content: string; shortcut?: string; className?: string; ref?: Ref<HTMLDivElement> }) {
  return (
    <div ref={ref} role="tooltip" className={cx(s.tip, className)}>
      <span>{content}</span>
      {shortcut && <kbd>{formatKeys(shortcut)}</kbd>}
    </div>
  );
}
