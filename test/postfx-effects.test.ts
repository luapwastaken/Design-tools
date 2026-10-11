import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { Texture } from '../src/renderer/lib/gpu/index.ts';
import { BLENDS, blendIndex, defaultsOf, EFFECT_IDS, EFFECTS, effectOf, fromPalette, GROUPS, isValue, valuesOf, type Ctx, type Effect, type ParamValue } from '../src/renderer/tools/postfx/effects/index.ts';
import { perLoop, tick, turn } from '../src/renderer/tools/postfx/effects/params.ts';
import { score } from '../src/renderer/tools/postfx/effects/search.ts';
import type { Oklch } from '../src/shared/color/index.ts';

test('the curated list: every effect once, in its group, with the spec’s moving and video-only ones', () => {
  assert.deepEqual(EFFECTS.map((e) => e.id), [...EFFECT_IDS]);
  assert.equal(new Set(EFFECT_IDS).size, 23);
  const groups = new Set(GROUPS.map((g) => g.id));
  for (const e of EFFECTS) {
    assert.ok(groups.has(e.group), e.id);
    assert.ok(e.label && e.about, e.id);
    assert.equal(effectOf(e.id), e);
  }
  for (const g of GROUPS) assert.ok(EFFECTS.some((e) => e.group === g.id), g.id);
  assert.deepEqual(EFFECTS.filter((e) => e.moving).map((e) => e.id).sort(), ['glitch', 'grain', 'light-leak', 'vhs', 'wave']);
  assert.deepEqual(EFFECTS.filter((e) => e.videoOnly).map((e) => e.id), ['datamosh']);
  assert.equal(effectOf('halftone'), undefined);
});

test('every setting is well formed: defaults in range and on the step, keys unique', () => {
  for (const e of EFFECTS) {
    assert.equal(new Set(e.params.map((p) => p.key)).size, e.params.length, e.id);
    for (const p of e.params) {
      const where = `${e.id}.${p.key}`;
      assert.ok(p.label, where);
      assert.ok(isValue(p, p.def), where);
      assert.deepEqual(p.fit(p.def), p.def, where);
      if (p.kind === 'number') {
        assert.ok(p.min < p.max && p.step > 0 && p.def >= p.min && p.def <= p.max, where);
        if (p.unit) assert.ok(['%', 'px', '°', '/s'].includes(p.unit), where);
      }
      if (p.kind === 'choice') assert.ok(p.options.length >= 2 && p.def < p.options.length, where);
    }
  }
});

test('values from outside are put back in range, and missing or odd ones take the default', () => {
  const grain = effectOf('grain')!;
  const amount = grain.params.find((p) => p.key === 'amount')!;
  assert.equal(amount.fit(150), 100);
  assert.equal(amount.fit(-3), 0);
  assert.equal(amount.fit(12.4), 12);
  assert.equal(grain.params.find((p) => p.key === 'size')!.fit(0.55), 0.6);
  assert.equal(amount.fit(Number.NaN), 15);
  const v = valuesOf('grain', { amount: 40, colour: 'yes', boil: 2.6, stray: 1 });
  assert.deepEqual(v, { amount: 40, size: 1.5, colour: false, shadows: 0, boil: 3 });
  const tint = effectOf('bloom')!.params.find((p) => p.key === 'tint')!;
  assert.deepEqual(tint.fit([1.2, -0.1, 370]), [1, 0, 10]);
  assert.equal(isValue(tint, [0.5, 0.1]), false);
  const mode = effectOf('wave')!.params.find((p) => p.key === 'mode')!;
  assert.equal(mode.fit(7), 1);
  // defaults are fresh each time: editing one layer's colour can't reach another's
  const a = defaultsOf('duotone');
  (a.dark as Oklch)[0] = 0.9;
  assert.equal((defaultsOf('duotone').dark as Oklch)[0], 0.26);
});

test('a palette gives the colour settings that take one, from its darkest to its lightest', () => {
  const pal: Oklch[] = [[0.7, 0.1, 40], [0.2, 0.05, 250], [0.95, 0.02, 90], [0.5, 0.15, 10]];
  assert.deepEqual(fromPalette('gradient-map', pal), { shadows: [0.2, 0.05, 250], midtones: [0.7, 0.1, 40], highlights: [0.95, 0.02, 90] });
  assert.deepEqual(fromPalette('duotone', pal), { dark: [0.2, 0.05, 250], light: [0.95, 0.02, 90] });
  assert.deepEqual(fromPalette('duotone', []), {});
  assert.deepEqual(fromPalette('grain', pal), {});
});

test('the six blend modes, numbered as the composite shader reads them', () => {
  assert.deepEqual(BLENDS.map((b) => b.id), ['normal', 'multiply', 'screen', 'overlay', 'soft-light', 'add']);
  assert.deepEqual(BLENDS.map((b) => blendIndex(b.id)), [0, 1, 2, 3, 4, 5]);
});

test('the loop’s clocks repeat exactly: t = 1 is t = 0', () => {
  for (const n of [1, 7, 24, 60]) {
    assert.equal(tick(1, n), 0);
    assert.equal(tick(0, n), 0);
    const seen = new Set(Array.from({ length: n }, (_, i) => tick(i / n, n)));
    assert.equal(seen.size, n, `${n} patterns in ${n} frames`);
  }
  assert.equal(tick(0.5, 0), 0);
  assert.equal(turn(1, 3), 0);
  assert.equal(turn(2.25, 1), turn(0.25, 1));
  assert.equal(turn(Number.NaN, 1), 0);
});

// ── every effect's passes, against a stand-in for the GPU ──

type Run = { fragment: string; uniforms: Record<string, unknown>; inputs: string[]; out: Texture };
const tex = (w: number, h: number, name: string) => ({ width: w, height: h, name }) as unknown as Texture;
const ENGINE = new Set(['u_rect', 'u_full', 'u_flip']);
const SIZE: Record<string, number> = { float: 1, int: 1, bool: 1, vec2: 2, vec3: 3, vec4: 4 };

function fake(e: Effect, params: Record<string, ParamValue>, o: { t?: number; frame?: number | null; mem?: Record<string, number>; seconds?: number } = {}) {
  const runs: Run[] = [];
  const kept = new Map<string, Texture>();
  const values = valuesOf(e.id, params);
  const input = tex(640, 360, 'input');
  const ctx: Ctx = {
    g: null as never,
    input, w: 640, h: 360, scale: 1, t: o.t ?? 0, seconds: o.seconds ?? 2, frame: o.frame ?? null,
    n: (k) => values[k] as number,
    on: (k) => values[k] as boolean,
    rgb: () => [0.5, 0.5, 0.5],
    run(fragment, uniforms = {}, r = {}) {
      const out = r.into ?? tex(r.size?.w ?? 640, r.size?.h ?? 360, `run${runs.length}`);
      runs.push({ fragment, uniforms, inputs: ['u_src', ...Object.keys(r.inputs ?? {})], out });
      return out;
    },
    drop: () => {},
    keep: (name) => kept.get(name) ?? (kept.set(name, tex(640, 360, name)), kept.get(name)!),
    mem: o.mem ?? {},
  };
  return { out: e.passes(ctx), runs, input, kept, mem: ctx.mem };
}

/** every uniform a shader declares is given, samplers as inputs, the rest as finite numbers of the right size */
function checkRuns(where: string, runs: Run[]) {
  for (const r of runs) {
    for (const [, type, name, arr] of r.fragment.matchAll(/uniform\s+(\w+)\s+(\w+)(\[\d+\])?\s*;/g)) {
      if (ENGINE.has(name)) continue;
      if (type === 'sampler2D') {
        assert.ok(r.inputs.includes(name), `${where}: no texture for ${name}`);
        continue;
      }
      const v = r.uniforms[name];
      assert.ok(v !== undefined, `${where}: no value for ${name}`);
      const list = typeof v === 'number' ? [v] : typeof v === 'boolean' ? [+v] : Array.from(v as ArrayLike<number>);
      assert.equal(list.length, (SIZE[type] ?? NaN) * (arr ? Number(arr.slice(1, -1)) : 1), `${where}: ${name} is a ${type}`);
      assert.ok(list.every(Number.isFinite), `${where}: ${name} = ${list}`);
      if (type === 'int') assert.ok(Number.isInteger(list[0]), `${where}: ${name} must be whole`);
    }
    assert.doesNotMatch(r.fragment, /#\s*version/);
    assert.ok([...r.fragment].every((ch) => ch <= '\x7f'), `${where}: shader text is ASCII`);
  }
}

/** the defaults, then every number setting at its least and its most (the other settings at default) */
function variants(e: Effect): Record<string, ParamValue>[] {
  const base = defaultsOf(e.id);
  const out = [base];
  for (const p of e.params) {
    if (p.kind === 'number') out.push({ ...base, [p.key]: p.min }, { ...base, [p.key]: p.max });
    if (p.kind === 'choice') p.options.forEach((_, i) => out.push({ ...base, [p.key]: i }));
    if (p.kind === 'toggle') out.push({ ...base, [p.key]: !p.def });
  }
  return out;
}

test('every effect gives each of its shaders every uniform, at any setting', () => {
  for (const e of EFFECTS) {
    for (const [i, params] of variants(e).entries()) {
      for (const t of [0, 0.37, 0.999]) {
        const { runs } = fake(e, params, { t, frame: e.videoOnly ? 3 : null });
        checkRuns(`${e.id} #${i} t=${t}`, runs);
      }
    }
  }
});

test('an effect at nothing (no blur, no length) hands its input on untouched', () => {
  for (const [id, params] of [['gaussian', { radius: 0 }], ['tilt-shift', { blur: 0 }], ['pixel-stretch', { length: 0 }]] as const) {
    const r = fake(effectOf(id)!, params);
    assert.equal(r.out, r.input, id);
    assert.equal(r.runs.length, 0, id);
  }
});

test('pixel stretch looks back in powers of two: a 2000 px streak is 13 passes', () => {
  const r = fake(effectOf('pixel-stretch')!, { length: 2000 });
  assert.equal(r.runs.length, 13);
  assert.deepEqual(r.runs.slice(1, -1).map((x) => x.uniforms.u_jump), [1024, 512, 256, 128, 64, 32, 16, 8, 4, 2, 1]);
});

test('datamosh advances only on the next frame: the same frame redraws from the one before, a jump starts clean', () => {
  const dm = effectOf('datamosh')!;
  const mem: Record<string, number> = {};
  const step = (frame: number) => fake(dm, {}, { frame, mem });
  const moshes = (r: ReturnType<typeof step>) => r.runs.filter((x) => /u_refresh/.test(x.fragment)).length;

  let r = step(4);
  assert.equal(moshes(r), 0, 'the first frame is the picture itself');
  assert.deepEqual({ f: mem.f, back: mem.back }, { f: 4, back: 0 });
  const first = mem.at;

  r = step(5);
  assert.equal(moshes(r), 1);
  assert.equal(mem.back, 1);
  assert.notEqual(mem.at, first, 'frame 5 went into the other slot');
  const at = mem.at;
  assert.equal((r.out as unknown as { name: string }).name, `out${at}`);
  const motion = r.runs.find((x) => /u_reach/.test(x.fragment))!;
  assert.deepEqual([motion.out.width, motion.out.height], [40, 23], 'one texel per 16 px block');

  r = step(5);
  assert.equal(moshes(r), 1, 'redrawn, from frame 4');
  assert.equal(mem.at, at, 'and not advanced');
  const mosh = r.runs.find((x) => /u_refresh/.test(x.fragment))!;
  assert.equal((mosh.out as unknown as { name: string }).name, `out${at}`);

  step(9);
  assert.deepEqual({ f: mem.f, back: mem.back }, { f: 9, back: 0 }, 'a seek starts clean');
});

test('datamosh counts the frames in a row behind it, which a seek or a clean start sets back to none', () => {
  const dm = effectOf('datamosh')!;
  const mem: Record<string, number> = {};
  const step = (frame: number) => fake(dm, {}, { frame, mem });
  step(10);
  assert.equal(mem.run, 0);
  for (const f of [11, 12, 13]) step(f);
  assert.equal(mem.run, 3);
  step(13);
  assert.equal(mem.run, 3, 'a redraw adds none');
  step(40);
  assert.equal(mem.run, 0);
});

test('a rate a second is held to whole counts in the loop, none only for none', () => {
  assert.equal(perLoop(0, 2), 0);
  assert.equal(perLoop(0.5, 2), 1);
  assert.equal(perLoop(12, 2), 24);
  assert.equal(perLoop(12, 120), 1440, 'a long clip runs at the same pace, not a slower one');
  assert.equal(perLoop(0.05, 0.5), 1, 'above 0 is never none, or the loop could not come round');
  assert.equal(perLoop(1.4, 1), 1);
});

test('what moves keeps its pace a second whatever the loop: a clip of 2 s or 2 minutes boils 12 times a second', () => {
  const grain = effectOf('grain')!;
  for (const seconds of [2, 10, 120]) {
    const frames = seconds * 25;
    const seeds = new Set(Array.from({ length: 25 }, (_, i) => fake(grain, { boil: 12 }, { t: i / frames, seconds }).runs[0].uniforms.u_seed));
    assert.ok(seeds.size >= 12 && seeds.size <= 13, `${seconds} s: ${seeds.size} patterns in the first second`);
  }
  const glitch = effectOf('glitch')!;
  const [short, long] = [2, 60].map((seconds) => new Set(Array.from({ length: 25 }, (_, i) => fake(glitch, { changes: 4 }, { t: i / (seconds * 25), seconds }).runs[0].uniforms.u_seed)).size);
  assert.ok(Math.abs(short - long) <= 1, `${short} and ${long} changes in a second`);
});

test('a light leak travels no faster in a short loop: it wanders less, so its brightness never pulses', () => {
  const leak = effectOf('light-leak')!;
  const reach = (seconds: number) => {
    const at = (t: number) => fake(leak, { drift: 100 }, { t, seconds }).runs[0].uniforms.u_p1 as number[];
    const [x0, y0] = at(0);
    return Math.max(...Array.from({ length: 50 }, (_, i) => Math.hypot(at(i / 50)[0] - x0, at(i / 50)[1] - y0)));
  };
  const [slow, fast] = [reach(2), reach(0.5)];
  assert.ok(fast < slow / 3, `0.5 s reaches ${fast.toFixed(1)} px, 2 s ${slow.toFixed(1)} px`);
});

test('typing an effect’s name finds it first: its name, then its group, then what it says of itself', () => {
  const top = (q: string) => [...EFFECTS].map((fx) => ({ fx, at: score(fx, q) })).filter((r) => r.at > 0).sort((a, b) => b.at - a.at)[0]?.fx.label;
  assert.equal(top('edges'), 'Edges', 'Vignette also says “edges”, in its description');
  assert.equal(top('lens'), 'Lens distortion');
  assert.equal(top('light'), 'Light leak');
  assert.equal(top('colour'), 'Grade', 'a group, and its first');
  assert.equal(top('kuw'), 'Kuwahara paint');
  assert.equal(top('aberr'), 'Chromatic aberration', 'a word of its name');
  assert.equal(top('zzz'), undefined);
});
