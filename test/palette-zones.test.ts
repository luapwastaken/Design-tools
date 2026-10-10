import assert from 'node:assert/strict';
import { test } from 'node:test';
import { hexToOklch, inSrgb, toHex, type Oklch } from '../src/shared/color/index.ts';
import { valueOf } from '../src/shared/color/value.ts';
import { MATERIALS } from '../src/shared/palette/ramp.ts';
import { bounceEmitter, DEFAULT_STRENGTHS, emitter, GAP, GAP_REFLECTED, LIT, linearOf, lum, RANGE, rigOf, SHADOWS, whiteRig, ZONES, zonesOf, type Rgb, type Rig, type ZoneId } from '../src/shared/palette/zones.ts';
import { LIGHTS, SUBJECTS } from '../src/renderer/tools/illustration/scene.ts';

const presetRig = (p: (typeof LIGHTS)[number]) => rigOf(p, p.strengths);
const withStrengths = (rig: Rig, key: number, fill: number, bounce: number, rim: number): Rig => ({
  key: { ...rig.key, strength: key },
  fill: { ...rig.fill, strength: fill },
  rim: { ...rig.rim, strength: rim },
  bounce: { ...rig.bounce, strength: bounce },
});

/** the angular distance between two hues */
const hueGap = (a: number, b: number) => Math.abs(((a - b + 540) % 360) - 180);
/** a zone's value as the hex shows it */
const hexValue = (o: Oklch) => valueOf(hexToOklch(toHex(o)));

test('the value rule holds for every preset, base, material and strength extreme', () => {
  let n = 0;
  for (const preset of LIGHTS) {
    const base = presetRig(preset);
    for (const s of SUBJECTS) {
      for (const m of MATERIALS) {
        for (const fill of RANGE.fill) {
          for (const bounce of RANGE.bounce) {
            for (const rim of RANGE.rim) {
              const rig = withStrengths(base, base.key.strength, fill, bounce, rim);
              const { zones, split } = zonesOf(s.base, m.id, rig);
              const litMin = Math.min(...LIT.map((z) => valueOf(zones[z])));
              for (const sh of SHADOWS) {
                assert.ok(valueOf(zones[sh]) <= litMin - GAP + 1e-9, `${preset.id} ${s.id} ${m.id} fill ${fill} bounce ${bounce} rim ${rim}: ${sh} ${valueOf(zones[sh]).toFixed(3)} vs lights from ${litMin.toFixed(3)}`);
              }
              // and on the hex the swatch shows, which is what the eye and the checks read
              const hexLit = Math.min(...LIT.map((z) => hexValue(zones[z])));
              for (const sh of SHADOWS) assert.ok(hexValue(zones[sh]) <= hexLit - GAP + 0.006, `${preset.id} ${s.id} ${m.id}: ${sh} on the hex`);
              assert.ok(split.gap >= GAP - 1e-9);
              n++;
            }
          }
        }
      }
    }
  }
  assert.equal(n, LIGHTS.length * SUBJECTS.length * MATERIALS.length * 8);
});

test('the value rule holds at the key extremes too', () => {
  for (const key of RANGE.key) {
    for (const fill of RANGE.fill) {
      for (const rim of RANGE.rim) {
        for (const s of SUBJECTS) {
          const rig = withStrengths(presetRig(LIGHTS[0]), key, fill, 1, rim);
          const { split } = zonesOf(s.base, s.material, rig);
          assert.ok(split.gap >= GAP - 1e-9, `${s.id} key ${key} fill ${fill} rim ${rim}`);
        }
      }
    }
  }
});

test('reflected light is darker than every lit zone, and the cast is no lighter than the core', () => {
  for (const preset of LIGHTS) {
    for (const s of SUBJECTS) {
      const base = presetRig(preset);
      for (const rig of [base, withStrengths(base, base.key.strength, 0.2, 1, 1.5), withStrengths(base, base.key.strength, 1, 1, 0)]) {
        const { zones } = zonesOf(s.base, s.material, rig);
        for (const lit of LIT) assert.ok(valueOf(zones.reflected) < valueOf(zones[lit]), `${preset.id} ${s.id} reflected vs ${lit}`);
        assert.ok(valueOf(zones.cast) <= valueOf(zones.core) + 1e-9);
      }
    }
  }
});

test('reflected light sits at least GAP_REFLECTED under every lit zone, at the presets’ strengths', () => {
  for (const p of LIGHTS) for (const s of SUBJECTS) for (const m of MATERIALS) {
    const { zones } = zonesOf(s.base, m.id, presetRig(p));
    const litMin = Math.min(...LIT.map((z) => valueOf(zones[z])));
    assert.ok(litMin - valueOf(zones.reflected) >= GAP_REFLECTED - 0.004, `${p.id} ${s.id} ${m.id}`);
  }
});

test('skin turns the halftone and core toward red-orange more than a material without subsurface', () => {
  const base: Oklch = [0.6, 0.1, 110];
  const rig = whiteRig();
  const skin = zonesOf(base, 'skin', rig).zones;
  const metal = zonesOf(base, 'metal', rig).zones;
  for (const z of ['halftone', 'core'] as const) {
    assert.ok(hueGap(skin[z][2], 40) < hueGap(metal[z][2], 40) - 3, `${z}: skin ${skin[z][2].toFixed(1)} vs metal ${metal[z][2].toFixed(1)}`);
    assert.ok(skin[z][1] > metal[z][1], `${z} chroma`);
  }
  // the zones with no subsurface term are the same
  assert.deepEqual(skin.light, metal.light);
});

test('under a white key and white fill, Light is the local colour, whatever the strengths', () => {
  for (const [k, f] of [[1, 0.3], [0.5, 0.8], [2, 0.1]] as const) {
    for (const s of SUBJECTS) {
      const { zones } = zonesOf(s.base, 'stone', whiteRig(k, f));
      assert.ok(Math.abs(zones.light[0] - s.base[0]) < 0.01, `${s.id} L ${zones.light[0]} vs ${s.base[0]}`);
      assert.ok(Math.abs(zones.light[1] - s.base[1]) < 0.01, `${s.id} chroma`);
      // within one hex step
      assert.ok(Math.abs(hexValue(zones.light) - hexValue(s.base)) <= 1 / 255 + 1e-9, `${s.id} hex`);
    }
  }
  const white = zonesOf([1, 0, 0], 'stone', whiteRig()).zones;
  assert.ok(valueOf(white.light) > 0.98);
});

test('emitters have luminance 1 and a saturated preset colour is tempered', () => {
  for (const preset of LIGHTS) {
    assert.ok(Math.abs(lum(emitter(preset.light)) - 1) < 1e-9);
    assert.ok(Math.abs(lum(emitter(preset.shadow)) - 1) < 1e-9);
  }
  const pink: Oklch = [0.8, 0.1, 20];
  const rgb = linearOf([0.85, pink[1], pink[2]]);
  const raw = rgb.map((v) => v / lum(rgb as Rgb));
  const t = emitter(pink);
  // the tempered colour sits nearer neutral (equal channels) than the untempered one
  const spread = (c: number[]) => Math.max(...c) - Math.min(...c);
  assert.ok(spread(t) < spread(raw) * 0.8, `${spread(t)} vs ${spread(raw)}`);
  assert.deepEqual(emitter([0.9, 0, 0]).map((v) => +v.toFixed(6)), [1, 1, 1]);
});

test('the highlight is lighter than the light, and a metal one jumps closer to the key', () => {
  const rig = presetRig(LIGHTS[1]);
  for (const s of SUBJECTS) {
    const { zones } = zonesOf(s.base, s.material, rig);
    assert.ok(valueOf(zones.highlight) >= valueOf(zones.light) - 1e-9, s.id);
  }
  const metal = zonesOf([0.62, 0.02, 260], 'metal', rig).zones;
  const cloth = zonesOf([0.62, 0.02, 260], 'cloth', rig).zones;
  assert.ok(valueOf(metal.highlight) - valueOf(metal.light) > valueOf(cloth.highlight) - valueOf(cloth.light));
});

test('every zone is inside sRGB', () => {
  for (const preset of LIGHTS) {
    for (const s of SUBJECTS) {
      for (const m of MATERIALS) {
        const rig = withStrengths(presetRig(preset), 2, 0, 1, 1.5);
        for (const z of ZONES) assert.ok(inSrgb(zonesOf(s.base, m.id, rig).zones[z]), `${preset.id} ${s.id} ${m.id} ${z}`);
      }
    }
  }
});

test('deterministic', () => {
  const rig = presetRig(LIGHTS[2]);
  const a = zonesOf(SUBJECTS[1].base, 'skin', rig);
  const b = zonesOf(SUBJECTS[1].base, 'skin', rig);
  assert.equal(JSON.stringify(a), JSON.stringify(b));
});

test('non-finite strengths fall back instead of poisoning the zones', () => {
  const r = zonesOf([0.6, 0.1, 30], 'skin', whiteRig(NaN, -1, NaN, Infinity));
  for (const z of ZONES) assert.ok(r.zones[z].every(Number.isFinite), z);
  // NaN falls back to the default strength, the same as leaving it out
  const d = zonesOf([0.6, 0.1, 30], 'skin', withStrengths(whiteRig(), ...DEFAULT_STRENGTHS));
  const n = zonesOf([0.6, 0.1, 30], 'skin', whiteRig(NaN, DEFAULT_STRENGTHS[1], NaN, DEFAULT_STRENGTHS[3]));
  assert.deepEqual(n.zones, d.zones);
});

test('the Ground colour drives the bounce: a green ground gives a greener reflected zone', () => {
  const warm = rigOf(LIGHTS[0], LIGHTS[0].strengths);
  const lawn = rigOf(LIGHTS[0], LIGHTS[0].strengths, { ground: [0.55, 0.12, 140] });
  const local: Oklch = [0.7, 0.03, 80];
  const a = zonesOf(local, 'stone', warm).zones.reflected;
  const b = zonesOf(local, 'stone', lawn).zones.reflected;
  assert.ok(hueGap(b[2], 140) < hueGap(a[2], 140), `${a[2].toFixed(0)} vs ${b[2].toFixed(0)}`);
  // the bounce emitter itself is greener, and has luminance 1 like the others
  const [r, g] = bounceEmitter(LIGHTS[0].light, [0.55, 0.12, 140]);
  assert.ok(g > r);
  assert.ok(Math.abs(lum(bounceEmitter(LIGHTS[0].light, [0.55, 0.12, 140])) - 1) < 1e-9);
  // a neutral ground leaves the key's tint, with no hue of its own
  const grey = bounceEmitter([0.9, 0, 0], [0.55, 0, 0]);
  assert.deepEqual(grey.map((v) => +v.toFixed(6)), [1, 1, 1]);
});

// ── the reviewer's sweep: the rule on rendered hex values, gamut, finite, cast <= core ──────────

let seed = 12345;
const rnd = () => (seed = (seed * 1664525 + 1013904223) >>> 0) / 2 ** 32;

test('6000 random cases: the rule holds on the hex, every zone is finite and in sRGB, cast <= core', () => {
  const locals: Oklch[] = [[0, 0, 0], [1, 0, 0], [0.5, 0, 0], [0.02, 0.01, 30], [0.98, 0.02, 100], [0.05, 0.2, 30], [0.3, 0.1, 140]];
  for (let i = 0; i < 600; i++) {
    const c: Oklch = [rnd(), rnd() * 0.4, rnd() * 360];
    if (inSrgb(c)) locals.push(c);
  }
  const pick = <T,>(xs: readonly T[]) => xs[Math.floor(rnd() * xs.length)];
  const bad: string[] = [];
  for (let i = 0; i < 6000; i++) {
    const l = locals[i % locals.length];
    const m = pick(MATERIALS).id;
    const p = pick(LIGHTS);
    const base = rigOf(p, p.strengths, { ground: [0.3 + rnd() * 0.5, rnd() * 0.15, rnd() * 360] });
    const rig = withStrengths(
      base,
      pick([0.1, 2, 0.1 + rnd() * 1.9, 1, 0.1 + rnd() * 1.9]),
      pick([0, 1, rnd()]),
      pick([0, 1, rnd()]),
      pick([0, 1.5, rnd() * 1.5]),
    );
    const { zones } = zonesOf(l, m, rig);
    for (const z of ZONES) {
      if (!zones[z].every(Number.isFinite)) bad.push(`nan ${z}`);
      if (!inSrgb(zones[z])) bad.push(`gamut ${z} ${JSON.stringify(l)}`);
    }
    const hv = (z: ZoneId) => hexValue(zones[z]);
    const litMin = Math.min(...LIT.map(hv));
    const shMax = Math.max(...SHADOWS.map(hv));
    if (litMin - shMax < GAP - 0.006) bad.push(`hex gap ${(litMin - shMax).toFixed(4)} ${JSON.stringify(l)} ${m} ${p.id}`);
    if (hv('cast') > hv('core') + 0.003) bad.push(`cast > core ${JSON.stringify(l)}`);
    if (valueOf(zones.highlight) < valueOf(zones.light) - 0.003) bad.push(`highlight < light ${JSON.stringify(l)} ${m}`);
  }
  assert.deepEqual(bad.slice(0, 10), []);
});
