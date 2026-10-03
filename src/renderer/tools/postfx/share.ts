// Share codes (spec §5 q4): `PFX2.` and the stack as base64url JSON, versioned. A code, a saved preset
// and a built-in all come through `layersFrom`, which refuses an effect this version doesn't have in
// a plain sentence and puts every value back in its range, so nothing read from outside can break
// the document. Pure, so it is unit tested.
import { effectOf, valuesOf } from './effects/index.ts';
import { isBlend, LIMIT, newId, type Layer } from './doc.ts';

export const PREFIX = 'PFX2.';
const VERSION = 2;

type Shared = Omit<Layer, 'id'>;

const toBase64Url = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const fromBase64Url = (text: string) => Uint8Array.from(atob(text.replace(/-/g, '+').replace(/_/g, '/')), (c) => c.charCodeAt(0));

/** the stack as a code to paste anywhere; ids stay behind, the receiving stack makes its own */
export function encodeStack(stack: Layer[]): string {
  const layers: Shared[] = stack.map(({ effect, on, opacity, blend, params }) => ({ effect, on, opacity, blend, params }));
  return PREFIX + toBase64Url(new TextEncoder().encode(JSON.stringify({ v: VERSION, layers })));
}

/** a pasted code's stack, or a plain sentence saying why it can't be read */
export function decodeStack(code: string): Layer[] {
  const text = code.trim();
  if (/^PFX1\./i.test(text)) throw new Error('That code is from the old Post FX. Its effects have changed, so it can’t be read here.');
  if (text.slice(0, PREFIX.length).toUpperCase() !== PREFIX) throw new Error(`A Post FX code starts with ${PREFIX}`);
  let raw: unknown;
  try {
    raw = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(fromBase64Url(text.slice(PREFIX.length))));
  } catch {
    throw new Error('That code is cut short or damaged. Copy it again, all of it.');
  }
  const r = (typeof raw === 'object' && raw !== null ? raw : {}) as Record<string, unknown>;
  if (typeof r.v === 'number' && r.v > VERSION) throw new Error('That code is from a newer Design Tools. Update the app to read it.');
  const layers = layersFrom(r.layers, 'That code');
  // a stack with nothing in it would only empty the one that is there
  if (!layers.length) throw new Error('That code holds no effects.');
  return layers;
}

/**
 * Layers from outside (a code, a saved preset), checked one by one: every effect must be known,
 * every value is put back in its range, and a setting it doesn't name takes its default.
 */
export function layersFrom(raw: unknown, what: string): Layer[] {
  if (!Array.isArray(raw)) throw new Error(`${what} holds no stack.`);
  if (raw.length > LIMIT.layers) throw new Error(`${what} has ${raw.length} layers; a stack holds up to ${LIMIT.layers}.`);
  return raw.map((x, n) => {
    const l = (typeof x === 'object' && x !== null ? x : {}) as Record<string, unknown>;
    const fx = typeof l.effect === 'string' ? effectOf(l.effect) : undefined;
    if (!fx) throw new Error(`${what} uses ${typeof l.effect === 'string' ? `an effect called “${l.effect}”` : 'an effect'} (layer ${n + 1}) that this version doesn’t have.`);
    const given = (typeof l.params === 'object' && l.params !== null ? l.params : {}) as Record<string, unknown>;
    const params = valuesOf(fx.id, given);
    const opacity = typeof l.opacity === 'number' && Number.isFinite(l.opacity) ? Math.min(1, Math.max(0, l.opacity)) : 1;
    return { id: newId(), effect: fx.id, on: l.on !== false, opacity, blend: isBlend(l.blend) ? l.blend : 'normal', params };
  });
}
