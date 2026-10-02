// The halftone core (plan unit H): plates from an image, a screen of cells per ink, the dots, and
// the files. Pure and synchronous, so the preview, the exports and the tests share every number.
export * from './types.ts';
export { NEUTRAL_TONE, TABLE, curveAt, curveTable, encodeTable, lookup, toneAt, toneTable } from './tone.ts';
export { GRID, MAX_SPOT, covering, inksAt, separation, toPlates, type SeparateOptions, type Separation } from './separate.ts';
export { LINE_SPLIT, axes, cells, compensate, dot, dotData, dotEstimate, dots, inkedCoverage, pagePx, printed, splitOf, type Clip, type DotGeom } from './screen.ts';
export { CROSS, ELLIPSE, OVERLAP, extent, sdf } from './shapes.ts';
export { blueNoise, stochastic, type StochasticOptions } from './stochastic.ts';
export { halftoneSvg, svgParts, svgProblem, type SvgDoc } from './svg.ts';
export { writeTiff } from './tiff.ts';
export { knockedOut, stats, totalInk } from './coverage.ts';
export { bilevel } from './bilevel.ts';
