// Dither's keys: the picture Luap approved (docs/rewrite/shortcuts-2026-10-11). Every row is always in
// the list; the ones that work on one state only are `off` there, decided at the keydown. Space is
// shown on Play but never live: the transport's tap owns it.
import type { Shortcut } from '../../shell/tool.ts';
import { showOriginalKey } from '../common/flip.ts';
import { copyOff } from '../common/keyGates.ts';
import type { DocController } from '../../../shared/doc-api.ts';
import { isAnimated, type DitherDoc } from './doc.ts';
import { copier, hasSeed, reseed, stepFrame, stepPixel, togglePlay } from './steps.ts';

/** `open`: pick an image; `flip`: the Original/Result switch (both reach the screen, so the tool passes them in) */
export const ditherShortcuts = (doc: DocController<DitherDoc>, open: () => void, flip: () => void): Shortcut[] => {
  const d = doc.get();
  const animated = isAnimated(d);
  const empty = !d.source;
  const step = (by: number) => () => stepFrame(doc.get(), by);
  return [
    { keys: 'Ctrl+O', label: 'Open an image', group: 'Image', run: open },
    { ...showOriginalKey(flip), off: empty },
    { keys: ',', us: ['['], label: 'Smaller pixels', group: 'Image', off: empty, run: () => stepPixel(doc, -1) },
    { keys: '.', us: [']'], label: 'Larger pixels', group: 'Image', off: empty, run: () => stepPixel(doc, 1) },
    { keys: 'R', label: 'New seed', group: 'Image', when: 'algorithms with a seed', off: !hasSeed(d), run: () => reseed(doc) },
    // Space stays with the transport's tap, which would toggle twice if the keymap took it too
    { keys: 'K', shown: ['Space'], label: 'Play / pause', group: 'Playback', when: 'animated', off: !animated, run: togglePlay },
    { keys: 'ArrowLeft', label: 'Previous frame', group: 'Playback', when: 'animated', off: !animated, run: step(-1) },
    { keys: 'ArrowRight', label: 'Next frame', group: 'Playback', when: 'animated', off: !animated, run: step(1) },
    { keys: 'Shift+ArrowLeft', label: '10 frames back', group: 'Playback', when: 'animated', off: !animated, run: step(-10) },
    { keys: 'Shift+ArrowRight', label: '10 frames forward', group: 'Playback', when: 'animated', off: !animated, run: step(10) },
    { keys: 'Ctrl+Shift+C', label: 'Copy the PNG', group: 'Copy and export', off: !!copier.why || copyOff(), run: () => void copier.run?.() },
  ];
};
