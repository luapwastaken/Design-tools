// The stack on the GPU (plan unit F): each layer's effect over the last one's result, in half floats
// all the way (inventory: v1 was 8-bit and clamped at every pass), then the shared composite for
// its opacity and blend. Preview and every export run exactly this; only `scale` and the frame differ.
//
//   const stack = new Stack('post fx preview');   one per lifetime (the view, each export): it owns a gpuScope
//   const src = stack.g.texture(bitmap, 'rgba16f');   the source (straight alpha), in the same scope
//   const out = stack.render(src, doc.stack, { t, frame, scale });   valid until the next render()
//   stack.g.bitmap(out) to show it; stack.bytes(out) for a PNG: RGBA, 8 bits, straight alpha, rows from the top
//   stack.release() frees everything made through stack.g, the source too (a hidden tool)
//
// After a context loss the stack forgets its textures by itself (make the Stack before your own
// onRestore listener, which then uploads the source again and renders).
import { rgb255, type Oklch } from '../../../../shared/color/index.ts';
import { gpuScope, type Gpu, type Texture } from '../../../lib/gpu/index.ts';
import { blendIndex, COMPOSITE } from './composite.ts';
import { fx } from './glsl.ts';
import { effectOf } from './index.ts';
import { valuesFor } from './params.ts';
import type { Blend, Ctx, Memory, ParamValue } from './types.ts';

export type StackLayer = { id: string; effect: string; on: boolean; opacity: number; blend: Blend; params: Readonly<Record<string, ParamValue>> };

export type RenderOptions = {
  /** the loop's phase; wrapped into [0, 1), so t = 1 draws exactly what t = 0 does */
  t?: number;
  /** the source frame for video; null (the default) for a still, which skips video-only layers */
  frame?: number | null;
  /** px of this render per px of the full-resolution image (1 for exports) */
  scale?: number;
  /** the loop's length in seconds, which moving effects' rates a second are measured against (default 2) */
  seconds?: number;
};

type Kept = { textures: Map<string, Texture>; mem: Record<string, number> };

const TO_BYTES = fx(`void main() { o = floor(clamp(here(), 0.0, 1.0) * 255.0 + 0.5) / 255.0; }`);
const sizeKey = (w: number, h: number) => `${w}x${h}`;

export class Stack {
  readonly g: Gpu;
  #free = new Map<string, Texture[]>();
  #busy = new Set<Texture>();
  #kept = new Map<string, Kept>();
  #size = '';
  #unlisten: (() => void) | null = null;

  constructor(label: string) {
    this.g = gpuScope(label);
    this.#listen();
  }

  render(input: Texture, layers: readonly StackLayer[], o: RenderOptions = {}): Texture {
    this.#listen();
    const t = Number.isFinite(o.t) ? o.t! - Math.floor(o.t!) : 0;
    const frame = o.frame ?? null;
    const scale = o.scale && o.scale > 0 ? o.scale : 1;
    const seconds = o.seconds && o.seconds > 0 ? o.seconds : 2;
    const [w, h] = [input.width, input.height];
    for (const tex of this.#busy) this.#put(tex);
    this.#busy.clear();
    if (sizeKey(w, h) !== this.#size) {
      this.#forget();
      this.#size = sizeKey(w, h);
    }
    let cur = input;
    const seen = new Set<string>();
    for (const layer of layers) {
      const effect = effectOf(layer.effect);
      if (!effect) throw new Error(`The stack has an effect called “${layer.effect}” that this version doesn’t have.`);
      if (!layer.on || !(layer.opacity > 0) || (effect.videoOnly && frame === null)) continue;
      seen.add(layer.id);
      const values = valuesFor(effect.params, layer.params);
      const out = effect.passes(this.#ctx(cur, layer.id, values, { t, frame, scale, seconds }));
      const next = layer.blend === 'normal' && layer.opacity >= 1 ? out : this.#composite(cur, out, layer);
      for (const tex of this.#busy) if (tex !== next) this.#put(tex);
      this.#busy = new Set(this.#busy.has(next) ? [next] : []);
      cur = next;
    }
    for (const [id, k] of this.#kept) if (!seen.has(id)) this.#drop(id, k);
    return cur;
  }

  /** what the layer's effect remembers of the frames it drew (datamosh), if it remembers any */
  memory(id: string): Memory {
    const m = this.#kept.get(id)?.mem;
    return m && m.f !== undefined ? { f: m.f, run: m.run ?? 0 } : undefined;
  }

  /** `tex` as 8-bit RGBA, straight alpha, rows from the top: what a PNG holds */
  bytes(tex: Texture): Uint8Array {
    const out = this.g.texture({ width: tex.width, height: tex.height }, 'rgba8');
    try {
      this.g.pass(this.g.program(TO_BYTES), { output: out, inputs: { u_src: tex } });
      return this.g.read(out);
    } finally {
      out.release();
    }
  }

  release(): void {
    this.g.release();
    this.#forget();
    this.#unlisten?.();
    this.#unlisten = null;
  }

  #listen(): void {
    this.#unlisten ??= this.g.onRestore(() => this.#forget());
  }

  #ctx(input: Texture, id: string, values: Record<string, ParamValue>, o: { t: number; frame: number | null; scale: number; seconds: number }): Ctx {
    const g = this.g;
    const kept = this.#kept.get(id) ?? { textures: new Map(), mem: {} };
    this.#kept.set(id, kept);
    const value = <T,>(key: string, kind: string, ok: (v: unknown) => v is T): T => {
      const v = values[key];
      if (!ok(v)) throw new Error(`The effect asked for a ${kind} setting “${key}” it doesn’t have.`);
      return v;
    };
    const w = input.width;
    const h = input.height;
    return {
      g, input, w, h, ...o,
      n: (key) => value(key, 'number', (v): v is number => typeof v === 'number'),
      on: (key) => value(key, 'switch', (v): v is boolean => typeof v === 'boolean'),
      rgb: (key) => rgb255(value(key, 'colour', (v): v is Oklch => Array.isArray(v))).map((c) => c / 255) as [number, number, number],
      run: (fragment, uniforms = {}, r = {}) => {
        const out = r.into ?? this.#take(r.size?.w ?? w, r.size?.h ?? h);
        g.pass(g.program(fragment), { output: out, inputs: { u_src: input, ...r.inputs }, uniforms });
        return out;
      },
      drop: (tex) => {
        if (this.#busy.delete(tex)) this.#put(tex);
      },
      keep: (name) => {
        let tex = kept.textures.get(name);
        if (!tex) kept.textures.set(name, (tex = g.texture({ width: w, height: h }, 'rgba16f')));
        return tex;
      },
      mem: kept.mem,
    };
  }

  #composite(base: Texture, out: Texture, layer: StackLayer): Texture {
    const into = this.#take(base.width, base.height);
    this.g.pass(this.g.program(COMPOSITE), {
      output: into,
      inputs: { u_base: base, u_fx: out },
      uniforms: { u_mode: blendIndex(layer.blend), u_opacity: Math.min(1, layer.opacity) },
    });
    return into;
  }

  #take(w: number, h: number): Texture {
    const tex = this.#free.get(sizeKey(w, h))?.pop() ?? this.g.texture({ width: w, height: h }, 'rgba16f');
    this.#busy.add(tex);
    return tex;
  }

  #put(tex: Texture): void {
    const key = sizeKey(tex.width, tex.height);
    const list = this.#free.get(key) ?? [];
    list.push(tex);
    this.#free.set(key, list);
  }

  #drop(id: string, k: Kept): void {
    for (const tex of k.textures.values()) tex.release();
    this.#kept.delete(id);
  }

  /** frees every texture the stack holds (after a context loss they are gone already; releasing them only forgets them) */
  #forget(): void {
    for (const list of this.#free.values()) list.forEach((t) => t.release());
    for (const t of this.#busy) t.release();
    for (const [id, k] of this.#kept) this.#drop(id, k);
    this.#free.clear();
    this.#busy.clear();
    this.#size = '';
  }
}
