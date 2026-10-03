import { useId } from 'react';
import { Button } from './Button.tsx';
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

/**
 * A live meter, so it may carry the signal (brief §4). Nothing in it moves except the fill growing
 * as work is done; while the amount isn't known it is its text alone, with no bar and no spinner.
 */
export function Progress({ label, value, detail, onCancel }: ProgressProps) {
  const pct = value === null ? null : Math.round(Math.min(Math.max(value, 0), 1) * 100);
  const labelId = useId();
  return (
    <div className={s.prog}>
      <div className={s.head} role={pct === null ? 'status' : undefined}>
        <span id={labelId} className={s.label}>{label}</span>
        {pct !== null && <span className={s.pct}>{pct}%</span>}
      </div>
      {/* the role sits on the bar alone: a progressbar's children are presentational, Cancel isn't */}
      {pct !== null && (
        <div className={s.bar} role="progressbar" aria-labelledby={labelId} aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct} aria-valuetext={detail}>
          <i className={s.track} />
          <i className={s.fill} style={{ width: `${pct}%` }} />
          <Ticks />
        </div>
      )}
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
