// The Viewport rulers' ticks (brief §5 canvas tools), pure so they are unit tested (test/rulers.test.ts).

export type RulerUnit = {
  unit: 'mm' | 'in' | 'px';
  /** content px in one unit: 1 for px, dpi / 25.4 for mm on a print-sized canvas */
  per: number;
};
/** 0 a minor tick, 1 the half-way tick, 2 a labelled one */
export type Tick = { at: number; size: 0 | 1 | 2; label?: string };

/** screen px between labels at least, so the widest label (-1200) never touches the next */
const LABEL_GAP = 64;
const MINOR_GAP = 5;

const DECIMAL = Array.from({ length: 30 }, (_, i) => [1, 2, 5][i % 3] * 10 ** (Math.floor(i / 3) - 3));
/** inches halve below one, as printed rulers do */
const INCH = [1 / 64, 1 / 32, 1 / 16, 1 / 8, 1 / 4, 1 / 2, ...DECIMAL.filter((v) => v >= 1)];
const WHOLE = DECIMAL.filter((v) => v >= 1);

/**
 * The ticks along a ruler `len` screen px long, with content 0 at screen `origin` and one unit
 * `px` screen px long. Labels land on round numbers; the step between them grows as the view zooms out.
 */
export function ticks(len: number, origin: number, px: number, unit: RulerUnit['unit']): Tick[] {
  if (!(px > 0 && len > 0)) return [];
  const majors = unit === 'in' ? INCH : unit === 'px' ? WHOLE : DECIMAL;
  const major = majors.find((m) => m * px >= LABEL_GAP) ?? majors[majors.length - 1];
  const divisions = unit === 'in' && major <= 1 ? [8, 4, 2] : [10, 5, 2];
  // a px ruler never ticks between pixels
  const div = divisions.find((d) => (major / d) * px >= MINOR_GAP && (unit !== 'px' || Number.isInteger(major / d))) ?? 1;
  const step = (major / div) * px;
  const out: Tick[] = [];
  for (let i = Math.ceil(-origin / step), end = Math.floor((len - origin) / step); i <= end; i++) {
    const at = origin + i * step;
    if (i % div === 0) out.push({ at, size: 2, label: String(+((i / div) * major).toFixed(4)) });
    else out.push({ at, size: div % 2 === 0 && i % (div / 2) === 0 ? 1 : 0 });
  }
  return out;
}
