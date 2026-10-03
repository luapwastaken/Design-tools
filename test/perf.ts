// Timing budgets for performance tests. `npm test` runs every file at once, which slows each one, so
// budgets get 2x headroom there; PERF_STRICT=1 checks the real targets (run a file on its own).
export const LOAD = process.env.PERF_STRICT ? 1 : 2;
export const budget = (ms: number): number => ms * LOAD;
