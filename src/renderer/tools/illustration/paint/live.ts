// The live canvas's engine, registered for the smoke pass and CDP probes. A store on its own, so nothing
// heavy rides with it into the production chunk.
import { createStore } from '../../common/store.ts';
import type { PaintEngine } from './engine.ts';

export const liveEngine = createStore<PaintEngine | null>(null);

/** the open palette's painting saves, registered for the smoke pass: `settled` waits for the write itself */
export const liveSaves = createStore<{ settled(within: number): Promise<boolean> } | null>(null);
