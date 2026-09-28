import { cx } from './cx.ts';
import s from './SwatchStrip.module.css';

/** A palette as a strip of equal bands, inside the --edge hairline. Fills its box unless `height` is set. */
export function SwatchStrip({ colors, height, className }: { colors: string[]; height?: number; className?: string }) {
  return (
    <span className={cx(s.strip, className)} style={height === undefined ? undefined : { height }} aria-hidden="true">
      {colors.map((c, i) => (
        <i key={i} style={{ background: c }} />
      ))}
    </span>
  );
}
