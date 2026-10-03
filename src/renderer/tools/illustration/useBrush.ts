// What the brush holds: the paint the settings name, from the tray or the well. When that paint
// leaves the tray (unticked, or its swatch deleted) the brush moves to its neighbour and says so,
// and the settings keep the move, so re-ticking never switches it back behind your back.
import { useEffect, useMemo, useRef } from 'react';
import type { Oklch } from '../../../shared/color/index.ts';
import { toast } from '../../ui/index.ts';
import type { Loaded } from './paint/index.ts';
import { loadedOf, neighbourOf, wellMix, type PaintSettings, type Source } from './paint-sources.ts';

export type Brush = { id: string; loaded: Loaded; oklch: Oklch; name: string };

export function useBrush(v: PaintSettings, sources: Source[], onSettings: (patch: Partial<PaintSettings>) => void) {
  const mix = useMemo(() => wellMix(v.well, sources), [v.well, sources]);
  const brush = useMemo((): Brush | null => {
    if (v.paint === 'well') return mix && { id: 'well', loaded: mix.loaded, oklch: mix.oklch, name: 'Well mix' };
    const src = sources.find((x) => x.id === v.paint);
    return src ? { id: src.id, loaded: loadedOf(src.pigment, src.swatch), oklch: src.pigment.oklch, name: src.name } : null;
  }, [v.paint, sources, mix]);

  const prev = useRef<Source[] | null>(null);
  useEffect(() => {
    const was = prev.current;
    prev.current = sources;
    if (!was || v.paint === 'well' || sources.some((x) => x.id === v.paint)) return;
    // only a paint that was in the tray leaves it: one missing from the start (a palette still
    // loading) waits for it
    const gone = was.find((x) => x.id === v.paint);
    const next = gone && sources.find((x) => x.id === neighbourOf(was.map((y) => y.id), sources.map((y) => y.id), gone.id));
    if (!gone || !next) return;
    onSettings({ paint: next.id });
    toast.show({ icon: 'brush', message: `${gone.name} is off the tray, so the brush holds ${next.name} now.` });
  }, [sources]);

  return { brush, mix };
}
