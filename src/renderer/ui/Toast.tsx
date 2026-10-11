import { useEffect, useSyncExternalStore, type CSSProperties, type HTMLAttributes } from 'react';
import { Button } from './Button.tsx';
import { cx } from './cx.ts';
import { Icon } from './Icon.tsx';
import { IconButton } from './IconButton.tsx';
import { Kbd } from './Kbd.tsx';
import { MAX_SHOWN, toast, toastStore, type ToastEntry } from './toast.ts';
import { Tooltip } from './Tooltip.tsx';
import s from './Toast.module.css';

type ViewProps = {
  entry: ToastEntry;
  /** show `Ctrl Z`: only on the one toast Ctrl+Z will undo right now (brief §6) */
  ctrlZ?: boolean;
  onUndo?(): void;
  onDismiss?(): void;
} & Omit<HTMLAttributes<HTMLDivElement>, 'children'>;

/** One toast. The host stacks and moves them. */
export function ToastView({ entry: t, ctrlZ, onUndo, onDismiss, className, ...div }: ViewProps) {
  const error = t.kind === 'error';
  return (
    // toasts never take focus: a press on one keeps it where it was
    <div className={cx(s.toast, className)} onMouseDown={(e) => e.preventDefault()} {...div}>
      {(error || t.icon) && <Icon name={error ? 'error' : t.icon!} className={cx(s.lead, error && s.error)} />}
      <Tooltip overflowOnly clamped>
        <span className={s.msg}>{t.message}</span>
      </Tooltip>
      {t.undo && (
        <Button variant="ghost" className={s.undo} onClick={onUndo}>
          Undo
        </Button>
      )}
      {ctrlZ && <Kbd>Ctrl Z</Kbd>}
      <IconButton icon="close" label="Dismiss" size="sm" onClick={onDismiss} />
    </div>
  );
}

/**
 * Mount once inside the work column (a positioned box whose bottom edge is the top of the status
 * bar). Toasts sit bottom centre, 12px up, and rise out of that edge.
 */
export function ToastHost({ className }: { className?: string }) {
  const list = useSyncExternalStore(toastStore.subscribe, toastStore.get);

  useEffect(() => {
    const hold = () => toastStore.hold(null, 'blur');
    const release = () => toastStore.release(null, 'blur');
    addEventListener('blur', hold);
    addEventListener('focus', release);
    return () => {
      removeEventListener('blur', hold);
      removeEventListener('focus', release);
    };
  }, []);

  const shown = list.filter((t) => !t.leaving);
  const ctrlZ = toast.activeCtrlZ()?.id;
  return (
    <div className={cx(s.host, className)} role="status" aria-live="polite">
      {list.map((t) => {
        const slot = t.leaving ? 0 : shown.length - 1 - shown.indexOf(t);
        return (
          <ToastView
            key={t.id}
            entry={t}
            ctrlZ={t.id === ctrlZ}
            className={s.floating}
            style={{ '--slot': slot } as CSSProperties}
            data-leaving={t.leaving || undefined}
            // past the third, a toast waits out of sight (its clock still runs) until newer ones close
            data-waiting={slot >= MAX_SHOWN || undefined}
            onPointerEnter={() => toastStore.hold(t.id, 'hover')}
            onPointerLeave={() => toastStore.release(t.id, 'hover')}
            onUndo={() => toastStore.undo(t.id)}
            onDismiss={() => toast.dismiss(t.id)}
          />
        );
      })}
    </div>
  );
}
