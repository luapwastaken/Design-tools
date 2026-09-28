import { useId } from 'react';
import { Button } from './Button.tsx';
import { Icon } from './Icon.tsx';
import { Ticks } from './Ticks.tsx';
import s from './Progress.module.css';

export type ProgressProps = {
  label: string;
  /** 0 to 1; null while the amount of work isn't known yet */
  value: number | null;
  /** counts: "6,655 of 10,735 dots" */
  detail?: string;
  onCancel?(): void;
};

/** A live meter, so it may carry the signal (brief §4). The spinner turns only while it shows. */
export function Progress({ label, value, detail, onCancel }: ProgressProps) {
  const pct = value === null ? null : Math.round(Math.min(Math.max(value, 0), 1) * 100);
  const labelId = useId();
  return (
    <div className={s.prog}>
      <div className={s.head}>
        <Icon name="progress_activity" size={16} className={s.spin} />
        <span id={labelId} className={s.label}>{label}</span>
        {pct !== null && <span className={s.pct}>{pct}%</span>}
      </div>
      {/* the role sits on the bar alone: a progressbar's children are presentational, Cancel isn't */}
      <div className={s.bar} role="progressbar" aria-labelledby={labelId} aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct ?? undefined} aria-valuetext={detail}>
        <i className={s.track} />
        {pct !== null && <i className={s.fill} style={{ width: `${pct}%` }} />}
        <Ticks />
      </div>
      {(detail || onCancel) && (
        <div className={s.foot}>
          <span className={s.detail}>{detail}</span>
          {onCancel && (
            <Button variant="ghost" size="xs" onClick={onCancel}>
              Cancel
            </Button>
          )}
        </div>
      )}
    </div>
  );
}
