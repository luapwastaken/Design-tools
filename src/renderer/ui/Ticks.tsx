import { cx } from './cx.ts';
import s from './Ticks.module.css';

const TICKS = Array.from({ length: 21 }, (_, i) => i);

/** The scale under a slider or meter: quarters strong, twentieths light. */
export function Ticks({ className }: { className?: string }) {
  return (
    <span className={cx(s.ticks, className)} aria-hidden="true">
      {TICKS.map((i) => (
        <i key={i} className={i % 5 === 0 ? s.major : undefined} style={{ left: `round(calc((100% - 1px) * ${i / 20}), 1px)` }} />
      ))}
    </span>
  );
}
