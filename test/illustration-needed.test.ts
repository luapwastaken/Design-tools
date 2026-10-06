// The colours a light needs that the ramp doesn't have (needed.ts): what the picture uses from the glow,
// bounce and highlight tables, less what the palette already holds.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { deltaE, type Oklch } from '../src/shared/color/index.ts';
import { glowColour, neededColours } from '../src/renderer/tools/illustration/needed.ts';
import { lookOf, newStats, shade, surface, type Light, type Look, type Shape } from '../src/renderer/tools/illustration/shade.ts';

const RAMP: Oklch[] = [
  [0.9, 0.06, 75],
  [0.76, 0.12, 55],
  [0.62, 0.14, 40],
  [0.45, 0.115, 30],
  [0.3, 0.08, 18],
];
const UPPER_LEFT: Light = { azimuth: 320, elevation: 35 };
const BEHIND: Light = { azimuth: 300, elevation: -45 };

const look = (material: Parameters<typeof lookOf>[0]['material'], over: Partial<Parameters<typeof lookOf>[0]> = {}): Look =>
  lookOf({ steps: RAMP, material, light: [0.95, 0.05, 85], surround: [0.55, 0.06, 150], ...over });

function frame(l: Look, shape: Shape, light: Light) {
  const stats = newStats();
  shade(surface(shape, 96), l, light, new Uint8ClampedArray(96 * 96 * 4), stats);
  return stats;
}

test('back-lit thin cloth needs a glow the ramp does not have; lit from the front it needs none', () => {
  const l = look('cloth', { surface: { translucency: 0.8 } });
  const back = neededColours(frame(l, 'cloth', BEHIND), l, RAMP, 'Rust');
  assert.ok(back.some((n) => n.kind === 'glow'), JSON.stringify(back.map((n) => n.name)));
  assert.ok(back.every((n) => n.name.startsWith('Rust ')));
  const front = neededColours(frame(l, 'cloth', UPPER_LEFT), l, RAMP, 'Rust');
  assert.ok(!front.some((n) => n.kind === 'glow'), 'no glow in front light');
  const glow = glowColour(frame(l, 'cloth', BEHIND), l);
  assert.ok(glow && glow[0] > 0.3);
  assert.equal(glowColour(frame(l, 'cloth', UPPER_LEFT), l), null, 'nothing glows in front light');
});

test('an opaque material needs no glow', () => {
  const l = look('stone');
  assert.ok(!neededColours(frame(l, 'sphere', BEHIND), l, RAMP, 'Rust').some((n) => n.kind === 'glow'));
});

test('a colour the palette already has is not needed again, and none is listed twice', () => {
  const l = look('cloth', { surface: { translucency: 0.8 } });
  const stats = frame(l, 'cloth', BEHIND);
  const first = neededColours(stats, l, RAMP, 'Rust');
  assert.ok(first.length > 0);
  const again = neededColours(stats, l, [...RAMP, ...first.map((n) => n.oklch)], 'Rust');
  assert.equal(again.length, 0, JSON.stringify(again.map((n) => n.name)));
  first.forEach((a, i) => first.slice(i + 1).forEach((b) => assert.ok(deltaE(a.oklch, b.oklch) > 1, `${a.name} and ${b.name} are the same colour`)));
  // one that is close counts as the colour it is close to
  const nearly = first[0].oklch.map((v, i) => (i === 0 ? v + 0.01 : v)) as Oklch;
  assert.ok(!neededColours(stats, l, [...RAMP, nearly], 'Rust').some((n) => n.name === first[0].name));
});

test('the bounce is offered only when there is a surround to take its colour from, and enough of it shows', () => {
  const tinted = look('stone');
  const bare = look('stone', { surround: null });
  // a low sun leaves the ground-facing side in shadow, and the ground lights it
  const low: Light = { azimuth: 0, elevation: 15 };
  const bounce = neededColours(frame(tinted, 'sphere', low), tinted, RAMP, 'Rust').filter((n) => n.kind === 'bounce');
  assert.equal(bounce.length, 1);
  assert.equal(bounce[0].name, 'Rust bounce');
  assert.ok(neededColours(frame(bare, 'sphere', low), bare, RAMP, 'Rust').every((n) => n.kind !== 'bounce'), 'no surround, no bounce colour');
  // a high sun leaves almost none of the object in the ground's reach
  assert.ok(neededColours(frame(tinted, 'sphere', { azimuth: 0, elevation: 80 }), tinted, RAMP, 'Rust').every((n) => n.kind !== 'bounce'));
});

test('a glossy ball offers its highlight in the light’s own colour; a matte one does not', () => {
  const glossy = look('plastic', { light: [0.97, 0.08, 200] });
  const matte = look('stone', { light: [0.97, 0.08, 200] });
  const g = neededColours(frame(glossy, 'sphere', UPPER_LEFT), glossy, RAMP, 'Rust');
  assert.ok(g.some((n) => n.kind === 'shine'), JSON.stringify(g.map((n) => n.name)));
  assert.ok(!neededColours(frame(matte, 'sphere', UPPER_LEFT), matte, RAMP, 'Rust').some((n) => n.kind === 'shine'));
});

test('an empty frame needs nothing', () => {
  assert.deepEqual(neededColours(newStats(), look('cloth'), RAMP, 'Rust'), []);
});
