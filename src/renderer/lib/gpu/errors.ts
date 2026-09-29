/** A shader that won't compile or link, or a call the engine can't honour. Never swallowed (inventory: v1's Post FX silently passed through). */
export class GpuError extends Error {
  name = 'GpuError';
  /** GL's own compile or link log, when there is one */
  readonly log?: string;
  constructor(message: string, log?: string) {
    super(message);
    this.log = log;
  }
}

/** The context was lost (a driver reset, or Chromium reclaiming it) while a read or export needed it. */
export class GpuLost extends GpuError {
  name = 'GpuLost';
  constructor() {
    super('The graphics card was reset while drawing. Try again.');
  }
}
