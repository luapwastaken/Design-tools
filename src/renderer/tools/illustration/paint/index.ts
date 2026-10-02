// The painting engine (plan 2026-09-30 §4): the canvas UI imports only from here.
export * from './types.ts';
export { PaintEngine } from './engine.ts';
export { toSample } from './input.ts';
export { brushWidth } from './bristles.ts';
export { liveEngine } from './probe.ts';
export { renderSheet, type SheetReport } from './sheet.ts';
export { paintEngineChecks } from './smoke-checks.ts';
