// GPU time (see index.ts): how long the GPU spent on the commands a function issued, from a timer
// query polled between tasks. Probes only.
import { getEngine, isLost } from './context.ts';

/** ms of GPU time for what `fn` draws; null without EXT_disjoint_timer_query_webgl2, or when the timing was disturbed */
export function timeGpu(fn: () => void): Promise<number | null> {
  const e = getEngine();
  const t = e.ext.timer;
  if (!t || isLost()) {
    fn();
    return Promise.resolve(null);
  }
  const { gl } = e;
  const q = gl.createQuery()!;
  gl.beginQuery(t.TIME_ELAPSED_EXT, q);
  try {
    fn();
  } finally {
    gl.endQuery(t.TIME_ELAPSED_EXT);
  }
  const gen = e.gen;
  return new Promise((ok) => {
    const poll = () => {
      if (isLost() || e.gen !== gen) return ok(null);
      if (!gl.getQueryParameter(q, gl.QUERY_RESULT_AVAILABLE)) return void setTimeout(poll, 2);
      const disjoint = gl.getParameter(t.GPU_DISJOINT_EXT);
      const ns = gl.getQueryParameter(q, gl.QUERY_RESULT) as number;
      gl.deleteQuery(q);
      ok(disjoint ? null : ns / 1e6);
    };
    setTimeout(poll, 2);
  });
}
