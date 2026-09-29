import { useMemo } from 'react';
import { lockupSvg } from '../../../shared/logo/svg.ts';
import type { Lockup, LogoDoc, Version } from './doc.ts';
import { useSvgUrl } from './raster.ts';

/** a lockup as the export draws it (the same SVG, not a second renderer), `height` px tall */
export function LockupImg({ d, lockup, version, padding = 'tight', height, className }: { d: LogoDoc; lockup: Lockup; version: Version; padding?: 'tight' | 'clearspace'; height: number; className?: string }) {
  const svg = useMemo(() => lockupSvg(d, lockup, version, { padding, height }), [d.icon, d.wordmark, d.colour, d.clearspace, lockup, version, padding, height]);
  const url = useSvgUrl(svg);
  return url ? <img src={url} alt="" draggable={false} className={className} /> : null;
}
