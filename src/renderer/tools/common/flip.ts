/**
 * `\` shows the original, and again goes back to the view it came from (not always the result:
 * Halftone's separations, Post FX's split). Each image tool makes one for its own view state.
 */
export function flipOriginal<V extends string>(get: () => V, set: (v: V) => void, original: V, home: V): () => void {
  let was = home;
  return () => {
    const v = get();
    if (v !== original) was = v;
    set(v === original ? was : original);
  };
}
