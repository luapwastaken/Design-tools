// What the keys and the bar share outside React. Kept free of the shell so the keys can be tested in node.
import { createStore } from '../common/store.ts';
import type { PatternDoc } from './doc.ts';

/** the document Surprise me made: it is a proposal while the document is exactly this, so any edit keeps it */
export const made = createStore<PatternDoc | null>(null);

/** the mounted view's Copy the swatch SVG, for the key; null while the tool is not shown */
export const swatchCopier = createStore<(() => void) | null>(null);
