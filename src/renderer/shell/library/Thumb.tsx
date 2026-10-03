import { useEffect, useState, type CSSProperties } from 'react';
import type { LibraryItemRef } from '../../../shared/types.ts';
import { Icon, SwatchStrip } from '../../ui/index.ts';
import { noteImageSize, useItemInfo, type ItemInfo } from './item-info.ts';
import { StillThumb } from './StillThumb.tsx';
import s from './Thumb.module.css';

// formats that can animate: their thumbnails show the first frame (StillThumb), never the animation
const MOVES = new Set(['gif', 'webp', 'avif']);
// a pattern thumbnail shows its tile repeating, two rows high
const TILE_H = 15;
const tileStyle = ({ svg, tile }: ItemInfo) =>
  svg && tile ? ({ '--art': `url("${svg}")`, '--art-size': `${(TILE_H * tile.w) / tile.h}px ${TILE_H}px` } as CSSProperties) : undefined;

/** The 44×30 picture inside a LibraryItemRow. Doc items are read only once the row scrolls near view. */
export function Thumb({ item }: { item: LibraryItemRef }) {
  const [el, setEl] = useState<HTMLSpanElement | null>(null);
  const [seen, setSeen] = useState(false);
  const [broken, setBroken] = useState(false);
  const info = useItemInfo(item, seen);

  useEffect(() => {
    if (!el || seen) return;
    const io = new IntersectionObserver(([e]) => e.isIntersecting && setSeen(true), { rootMargin: '200px 0px' });
    io.observe(el);
    return () => io.disconnect();
  }, [el, seen]);
  useEffect(() => setBroken(false), [item.mtimeMs]);

  if (info?.failed || broken) {
    return (
      <span className={s.failed}>
        <Icon name="broken_image" size={16} />
      </span>
    );
  }
  const src = `${item.kind === 'image' ? 'thumb' : 'item'}/${encodeURIComponent(item.id)}?s=88&v=${item.mtimeMs}`;
  switch (item.kind) {
    case 'palette':
      return <span ref={setEl} className={s.box}>{info?.colors && info.colors.length > 0 && <SwatchStrip colors={info.colors} />}</span>;
    case 'pattern':
      return <span ref={setEl} className={s.checker} style={tileStyle(info ?? {})} />;
    case 'logo':
      return <span ref={setEl} className={s.checker}>{info?.svg && <img src={info.svg} alt="" className={s.contain} />}</span>;
    case 'svg':
    case 'image':
      return (
        <span className={s.checker}>
          {item.kind === 'image' && MOVES.has(item.ext.toLowerCase()) ? (
            <StillThumb url={`dt://${src}`} className={s.cover} onSize={(w, h) => noteImageSize(item, w, h)} onError={() => setBroken(true)} />
          ) : (
            <img
              src={`dt://${src}`}
              alt=""
              loading="lazy"
              decoding="async"
              className={item.kind === 'svg' ? s.contain : s.cover}
              onLoad={(e) => item.kind === 'image' && noteImageSize(item, e.currentTarget.naturalWidth, e.currentTarget.naturalHeight)}
              onError={() => setBroken(true)}
            />
          )}
        </span>
      );
  }
}
