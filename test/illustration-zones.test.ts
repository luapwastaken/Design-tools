import assert from 'node:assert/strict';
import { test } from 'node:test';
import { inSrgb, type Oklch } from '../src/shared/color/index.ts';
import { valueOf } from '../src/shared/color/value.ts';
import { DEFAULT_STRENGTHS, RANGE, ZONES } from '../src/shared/palette/zones.ts';
import { addRamp, emptyDoc, type IllustrationDoc } from '../src/renderer/tools/illustration/doc.ts';
import { BACKDROP, cleanColour, cleanStrengths, DEFAULT_GROUND, drawRing, GROUND_ID, PREVIEW, readout, renderZones, ringOf, zoneMap, zoneName, zoneRig, zoneRows, ZONE_ID } from '../src/renderer/tools/illustration/light-zones.ts';
import { LIGHTS, sceneLight } from '../src/renderer/tools/illustration/scene.ts';

const palette = (): IllustrationDoc =>
  ([[[0.74, 0.075, 55], 'Skin', 'skin'], [[0.6, 0.12, 140], 'Leaf', 'foliage'], [[0.55, 0.09, 250], 'Shirt', 'cloth']] as [Oklch, string, 'skin' | 'foliage' | 'cloth'][]).reduce((d, [b, n, m]) => addRamp(d, b, n, null, m).doc, emptyDoc());
const view = (o: object = {}) => ({ zoneStrengths: [...DEFAULT_STRENGTHS], zoneRim: null, zoneGround: DEFAULT_GROUND, ...o });

test('strengths as saved: each in its range, the rest the defaults', () => {
  assert.deepEqual(cleanStrengths([1, 0.3, 0.25, 0.5]), [1, 0.3, 0.25, 0.5]);
  assert.deepEqual(cleanStrengths([9, -3, 7, 99]), [RANGE.key[1], RANGE.fill[0], RANGE.bounce[1], RANGE.rim[1]]);
  assert.deepEqual(cleanStrengths([NaN, 'x', null, Infinity]), [DEFAULT_STRENGTHS[0], DEFAULT_STRENGTHS[1], DEFAULT_STRENGTHS[2], DEFAULT_STRENGTHS[3]]);
  for (const junk of [undefined, null, 'x', 4, {}, [], [1, 2, 3], [1, 2, 3, 4, 5]]) assert.deepEqual(cleanStrengths(junk), [...DEFAULT_STRENGTHS], JSON.stringify(junk));
});

test('colours as saved: three finite numbers made into one sRGB can show, anything else the fallback', () => {
  assert.deepEqual(cleanColour([0.6, 0.1, 140], null), [0.6, 0.1, 140]);
  const wild = cleanColour([5, 9, 725], null)!;
  assert.ok(inSrgb(wild) && wild[0] <= 1 && wild[2] >= 0 && wild[2] < 360, JSON.stringify(wild));
  for (const junk of [undefined, null, 'x', [], [1, 2], [1, 2, 'x'], [1, 2, NaN], [0.5, 0.1, 30, 1], {}]) assert.equal(cleanColour(junk, null), null, JSON.stringify(junk));
  assert.deepEqual(cleanColour('x', DEFAULT_GROUND), DEFAULT_GROUND);
});

test('one row per ramp, from its base and material, under the palette’s own light pair', () => {
  const d = palette();
  const rig = zoneRig(d, view());
  assert.deepEqual(rig.key.colour, sceneLight(d).pair.light);
  assert.deepEqual(rig.fill.colour, sceneLight(d).pair.shadow);
  assert.deepEqual(rig.rim.colour, rig.key.colour);
  const rows = zoneRows(d, rig);
  assert.deepEqual(rows.map((r) => r.name), ['Skin', 'Leaf', 'Shirt']);
  assert.deepEqual(rows.map((r) => r.material), ['skin', 'foliage', 'cloth']);
  assert.equal(zoneName('Skin', 'core'), 'Skin core shadow');
  assert.equal(zoneName('Skin', 'reflected'), 'Skin reflected light');
  assert.match(readout(rows[0].result.split), /^lights \d\.\d\d–\d\.\d\d · shadows \d\.\d\d–\d\.\d\d · gap \d\.\d\d$/);
});

test('a preset changes the key and fill, a rim colour set replaces the key’s, the ground the bounce’s', () => {
  const d = palette();
  const golden = LIGHTS.find((l) => l.id === 'golden')!;
  const lit = { ...d, ramps: d.ramps.map((r) => ({ ...r, light: golden.light, shadow: golden.shadow })) };
  assert.deepEqual(zoneRig(lit, view()).key.colour, golden.light);
  assert.deepEqual(zoneRig(d, view({ zoneRim: [0.7, 0.1, 250] })).rim.colour, [0.7, 0.1, 250]);
  assert.deepEqual(zoneRig(d, view({ zoneGround: [0.5, 0.1, 140] })).bounce.ground, [0.5, 0.1, 140]);
  // the zones follow: a greener ground, a different bounce
  assert.notDeepEqual(zoneRows(d, zoneRig(d, view({ zoneGround: [0.5, 0.12, 140] })))[0].result.zones.reflected, zoneRows(d, zoneRig(d, view()))[0].result.zones.reflected);
});

test('every preset names its four strengths, in range', () => {
  for (const l of LIGHTS) {
    assert.ok(l.strengths && l.strengths.length === 4, l.id);
    assert.deepEqual(cleanStrengths(l.strengths), [...l.strengths!], l.id);
  }
});

test('the preview: under the default sun every zone, the ground and the backdrop are on show, and nothing else', () => {
  const m = zoneMap({ azimuth: 320, elevation: 35 }, 1.2);
  const seen = new Set(m.px);
  for (const id of [0, GROUND_ID, ...Object.values(ZONE_ID)]) assert.ok(seen.has(id), `pixel value ${id}`);
  assert.ok([...seen].every((id) => id >= 0 && id <= GROUND_ID));
  // the same sun and sharpness is the same map, kept
  assert.equal(zoneMap({ azimuth: 320, elevation: 35 }, 1.2), m);
  // the key is on its side: the light zone is on the upper left of the ball, the core shadow on the lower right
  const at = (id: number) => {
    let [x, y, n] = [0, 0, 0];
    m.px.forEach((v, p) => {
      if (v === id) [x, y, n] = [x + (p % PREVIEW), y + Math.floor(p / PREVIEW), n + 1];
    });
    return [x / n, y / n];
  };
  assert.ok(at(ZONE_ID.light)[0] < at(ZONE_ID.core)[0] && at(ZONE_ID.light)[1] < at(ZONE_ID.core)[1]);
  // and the cast shadow falls the other way, on the ground, below the ball’s middle
  assert.ok(at(ZONE_ID.cast)[0] > PREVIEW / 2 && at(ZONE_ID.cast)[1] > PREVIEW / 2);
});

test('the preview is painted with the zone colours and the backdrop only, and a ring is drawn on a zone’s edge', () => {
  const d = palette();
  const row = zoneRows(d, zoneRig(d, view()))[0];
  const m = zoneMap({ azimuth: 320, elevation: 35 }, 1.2);
  const out = new Uint8ClampedArray(PREVIEW * PREVIEW * 4);
  const colours = [BACKDROP, ...ZONES.map((z) => row.result.zones[z]), row.result.zones.light].map((o, i) => [i * 30, i * 30 + 1, i * 30 + 2]);
  renderZones(out, m, colours);
  // the top-left corner is backdrop; a pixel in the middle of the ball's light zone is the light colour
  assert.deepEqual([...out.slice(0, 3)], colours[0]);
  const lightPixel = m.px.findIndex((v, p) => v === ZONE_ID.light && m.ss.slice(p * 4, p * 4 + 4).every((s) => s === ZONE_ID.light));
  assert.deepEqual([...out.slice(lightPixel * 4, lightPixel * 4 + 3)], colours[ZONE_ID.light]);
  const ring = ringOf(m, ZONE_ID.core);
  assert.ok(ring.length > 40 && ring.length % 2 === 0);
  const before = out.slice();
  drawRing(out, ring);
  assert.notDeepEqual(out, before);
  // the ring is neutral: no colour of its own
  for (let k = 0; k < ring.length; k += 2) {
    const p = (ring[k + 1] * PREVIEW + ring[k]) * 4;
    assert.ok(out[p] === out[p + 1] && out[p + 1] === out[p + 2]);
  }
  assert.ok(valueOf(BACKDROP) > 0.3 && valueOf(BACKDROP) < 0.4);
});
