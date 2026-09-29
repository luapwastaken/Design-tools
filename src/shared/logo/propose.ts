// proposeLockups(): the lockups that suit these parts, read from their shapes. All six kinds come back,
// each with its own starting proportions; `on` is the proposal, and the user can switch any of them.
import { capBand, usable } from './layout.ts';
import { KINDS, sideBySide, type Lockup, type LockupKind, type Part } from './types.ts';

const round = (v: number) => Math.round(v * 100) / 100;
const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

export function proposeLockups(icon: Part | null, wordmark: Part | null): Lockup[] {
  const hasIcon = usable(icon);
  const hasWord = usable(wordmark);
  const both = hasIcon && hasWord;
  /** the icon's width ÷ height */
  const aspect = hasIcon ? icon.box.w / icon.box.h : 1;
  const band = hasWord ? capBand(wordmark) : null;
  const cap = band ? band.base - band.top : 1;
  /** the wordmark's length and its artwork's height (descenders, accents, a tagline) in cap heights */
  const long = hasWord ? wordmark.box.w / cap : 4;
  const tall = hasWord ? wordmark.box.h / cap : 1;

  // beside the name the icon stands a little taller than all of it; above it, about half as wide as
  // it is long, and a wide one not much wider than all of it; compact, as wide as it
  const beside = round(Math.max(1.75, 1.15 * tall));
  const above = round(clamp(Math.min(clamp((0.5 * long) / aspect, 2.5, 6), (1.25 * long) / aspect), 0.5, 6));
  const compact = round(clamp(long / aspect, 0.5, 8));

  const on: Record<LockupKind, boolean> = {
    // a very wide icon beside a name runs too long; stacked carries it
    horizontal: both && aspect <= 2.5,
    stacked: both,
    // a compact mark can trail a short name
    'horizontal-rev': both && aspect >= 0.75 && aspect <= 1.33 && long <= 6,
    // a short name under a compact mark makes a block
    compact: both && long <= 4 && aspect >= 0.6 && aspect <= 1.6,
    icon: hasIcon,
    wordmark: hasWord,
  };
  const favoursStacked = both && (aspect < 0.75 || aspect > 2.5);
  const order: LockupKind[] = favoursStacked ? ['stacked', ...KINDS.filter((k) => k !== 'stacked')] : KINDS;
  return order.map((kind) => ({
    kind,
    on: on[kind],
    ratio: kind === 'stacked' ? above : kind === 'compact' ? compact : beside,
    // half an icon height beside; stacked icons are taller, so less of one keeps the pair together
    gap: kind === 'stacked' ? 0.3 : kind === 'compact' ? 0.2 : 0.5,
    align: sideBySide(kind) && wordmark?.type ? 'cap' : 'center',
  }));
}
