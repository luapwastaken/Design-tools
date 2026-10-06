import { useLayoutEffect } from 'react';
import { greyMatrix } from '../../shared/color/value.ts';
import { useShell } from './core/index.ts';

/**
 * The greyscale view (Settings.greyscale, key G in the colour tools). Puts data-greyscale on the
 * document root; base.css greys every [data-colour] element with the filter below, which is the
 * value measure (Rec. 709 luma of the shown sRGB), so a greyed swatch is the grey the checks and
 * the value lock call its value. Mounted once.
 */
export function GreyView() {
  const on = useShell((st) => st.settings?.greyscale === true);
  useLayoutEffect(() => {
    if (on) document.documentElement.dataset.greyscale = 'true';
    else delete document.documentElement.dataset.greyscale;
  }, [on]);
  return (
    <svg width="0" height="0" aria-hidden="true" focusable="false" style={{ position: 'absolute' }}>
      <filter id="dt-grey" colorInterpolationFilters="sRGB">
        <feColorMatrix type="matrix" values={greyMatrix()} />
      </filter>
    </svg>
  );
}
