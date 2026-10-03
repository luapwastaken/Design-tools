import { useLayoutEffect, useState } from 'react';
import { ticks, type RulerUnit } from './rulers.ts';
import type { ViewTransform } from './Viewport.tsx';
import type { Point } from './viewport.ts';
import s from './Rulers.module.css';

/** the pointer over a Viewport in view px, for the parts that follow it without re-rendering the rest */
export type Hover = Set<(at: Point | null) => void>;

export function useHover(hover: Hover): Point | null {
  const [at, setAt] = useState<Point | null>(null);
  useLayoutEffect(() => {
    hover.add(setAt);
    return () => void hover.delete(setAt);
  }, [hover]);
  return at;
}

/** as thick as the ruler: minor, half-way and labelled ticks */
const LENGTH = [3, 6, 10];
const RULER = 18;

/** Rulers along the top and left of a Viewport (brief §5), 0 at the content's top left, with the pointer marked in signal. */
export function Rulers({ t, unit, hover }: { t: ViewTransform | null; unit: RulerUnit; hover: Hover }) {
  return (
    <>
      <div className={s.corner} />
      <Ruler across t={t} unit={unit} hover={hover} />
      <Ruler across={false} t={t} unit={unit} hover={hover} />
    </>
  );
}

function Ruler({ across, t, unit, hover }: { across: boolean; t: ViewTransform | null; unit: RulerUnit; hover: Hover }) {
  const list = t ? ticks(across ? t.width : t.height, across ? t.x : t.y, t.scale * unit.per, unit.unit) : [];
  const pos = (at: number) => Math.round(at) + 0.5;
  const d = list.map(({ at, size }) => (across ? `M${pos(at)} ${RULER - LENGTH[size]}V${RULER}` : `M${RULER - LENGTH[size]} ${pos(at)}H${RULER}`)).join('');
  return (
    <div className={across ? s.top : s.left} aria-hidden>
      <svg className={s.svg}>
        <path d={d} />
        {list.map(({ at, label }) =>
          !label ? null : across ? (
            <text key={label} x={Math.round(at) + 3} y={9}>
              {label}
            </text>
          ) : (
            <text key={label} transform={`translate(9 ${Math.round(at) + 3}) rotate(-90)`} textAnchor="end">
              {label}
            </text>
          ),
        )}
      </svg>
      <Cursor across={across} hover={hover} />
    </div>
  );
}

function Cursor({ across, hover }: { across: boolean; hover: Hover }) {
  const at = useHover(hover);
  if (!at) return null;
  const p = Math.round(across ? at.x : at.y);
  return <i className={s.cursor} style={{ transform: across ? `translateX(${p}px)` : `translateY(${p}px)` }} />;
}
