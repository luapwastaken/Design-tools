// Small sizes (spec §3): the lockup being edited drawn at exactly 16, 24, 32 and 48 device pixels
// tall, shown pixel for pixel, to judge whether it holds up in a tab or an app bar. v1 squeezed its
// whole padded canvas into a square instead.
import { useEffect, useMemo, useRef } from 'react';
import { layoutLockup } from '../../../shared/logo/layout.ts';
import { lockupSvg, padOf } from '../../../shared/logo/svg.ts';
import { parseSize } from '../../../shared/svg/index.ts';
import { Module } from '../../ui/index.ts';
import { KIND_LABEL, VERSION_LABEL, type Lockup, type LogoDoc } from './doc.ts';
import { drawSvg } from './raster.ts';
import { surroundOf } from './surround.ts';
import type { LogoView } from './view-state.ts';
import s from './SmallSizes.module.css';

const SIZES = [16, 24, 32, 48];

export function SmallSizes({ d, v, lockup }: { d: LogoDoc; v: LogoView; lockup: Lockup | null }) {
  if (!lockup) return null;
  const ground = surroundOf(v.surround, d);
  return (
    <Module title="Small sizes" sub={`${KIND_LABEL[lockup.kind]} · ${VERSION_LABEL[v.version]}`}>
      <div className={s.rows}>
        {SIZES.map((px) => (
          <div key={px} className={s.row}>
            <span className="lbl">{px} px</span>
            <span className={s.mat} style={{ background: ground }}>
              <Pixels d={d} lockup={lockup} version={v.version} px={px} />
            </span>
          </div>
        ))}
      </div>
      <p className={s.note}>Each logo is drawn at exactly that many pixels tall and shown pixel for pixel, as a browser tab or an app bar would show it. A wide one scrolls.</p>
    </Module>
  );
}

function Pixels({ d, lockup, version, px }: { d: LogoDoc; lockup: Lockup; version: LogoView['version']; px: number }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  // the logo is px tall; a knockout's field reaches past it by the clearspace
  const tall = useMemo(() => {
    const h = layoutLockup(d, lockup).h;
    return Math.round((px * (h + 2 * padOf(d, version, 'tight'))) / h);
  }, [d.icon, d.wordmark, d.clearspace, lockup, version, px]);
  const svg = useMemo(() => lockupSvg(d, lockup, version, { padding: 'tight', height: tall }), [d.icon, d.wordmark, d.colour, d.clearspace, lockup, version, tall]);
  useEffect(() => {
    let live = true;
    const width = Math.max(1, Math.round(parseSize(svg).width));
    void drawSvg(svg, width, tall).then(
      (off) => {
        const c = canvas.current;
        if (!live || !c) return;
        const dpr = devicePixelRatio || 1;
        c.width = width;
        c.height = tall;
        c.style.width = `${width / dpr}px`;
        c.style.height = `${tall / dpr}px`;
        c.getContext('2d')!.drawImage(off, 0, 0);
      },
      () => {},
    );
    return () => void (live = false);
  }, [svg, tall]);
  return <canvas ref={canvas} className={s.px} />;
}
