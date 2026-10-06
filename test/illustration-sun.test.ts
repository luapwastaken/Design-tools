import { test } from 'node:test';
import assert from 'node:assert/strict';
import { direction, type Light } from '../src/renderer/tools/illustration/shade.ts';
import { lightAt, lightWords, nudge, PRESETS, presetOf, sunAt, type Arrow } from '../src/renderer/tools/illustration/sun.ts';

const near = (a: number, b: number, e = 1e-9) => Math.abs(a - b) < e;
const ARROWS: [Arrow, number, number][] = [['left', -1, 0], ['right', 1, 0], ['up', 0, 1], ['down', 0, -1]];

test('the sun is drawn where the light is: the same direction seen from the front, a circle and not an ellipse', () => {
  for (let azimuth = 0; azimuth < 360; azimuth += 15) {
    for (const elevation of [-80, -45, -10, 0, 12, 35, 60, 89]) {
      const [lx, ly] = direction({ azimuth, elevation });
      const s = sunAt({ azimuth, elevation });
      assert.ok(near(s.x, lx) && near(s.y, ly), `${azimuth}/${elevation}`);
      assert.ok(Math.hypot(s.x, s.y) <= 1 + 1e-9);
    }
  }
  const rim = sunAt({ azimuth: 45, elevation: 0 });
  assert.ok(near(Math.hypot(rim.x, rim.y), 1), 'the rim is a circle');
  // 45 degrees round is 45 degrees on the screen
  assert.ok(near((Math.atan2(rim.x, rim.y) * 180) / Math.PI, 45));
  // light behind the object is drawn at the same place as the light in front of it
  const [front, back] = [sunAt({ azimuth: 200, elevation: 30 }), sunAt({ azimuth: 200, elevation: -30 })];
  assert.ok(near(front.x, back.x) && near(front.y, back.y));
});

test('a pointer on the circle makes the light the sun is drawn at, on the side the sun is on', () => {
  for (const [azimuth, elevation] of [[320, 35], [90, 10], [180, 60], [10, 80], [270, -40], [45, -75]]) {
    const was: Light = { azimuth, elevation };
    const s = sunAt(was);
    const got = lightAt(s.x, s.y, elevation < 0, was);
    assert.ok(Math.abs(got.azimuth - azimuth) <= 1 && Math.abs(got.elevation - elevation) <= 1, `${azimuth}/${elevation} -> ${got.azimuth}/${got.elevation}`);
  }
  assert.deepEqual(lightAt(0, 0, false, { azimuth: 123, elevation: 20 }), { azimuth: 123, elevation: 90 }, 'the centre keeps the direction');
  assert.deepEqual(lightAt(2, 0, false, { azimuth: 0, elevation: 20 }), { azimuth: 90, elevation: 0 }, 'past the rim is the rim');
  assert.equal(lightAt(1, 0, true, { azimuth: 0, elevation: -20 }).elevation, 0, 'and the rim is the same from behind');
  assert.ok(lightAt(0.5, 0.5, true, { azimuth: 0, elevation: -20 }).elevation < 0);
});

test('arrow keys move the sun the way they point on the screen, wherever it is', () => {
  for (let azimuth = 0; azimuth < 360; azimuth += 20) {
    for (const elevation of [-70, -30, 5, 25, 45, 75]) {
      for (const [arrow, dx, dy] of ARROWS) {
        const was: Light = { azimuth, elevation };
        const now = nudge(was, arrow);
        const [a, b] = [sunAt(was), sunAt(now)];
        const along = (b.x - a.x) * dx + (b.y - a.y) * dy;
        const across = Math.abs((b.x - a.x) * dy) + Math.abs((b.y - a.y) * dx);
        if (Math.abs(elevation) <= 5 && along < 0) continue; // at the rim an arrow pointing out goes nowhere
        assert.ok(along > 0 || (now.azimuth === was.azimuth && now.elevation === was.elevation), `${arrow} at ${azimuth}/${elevation} moved ${along.toFixed(4)}`);
        assert.ok(across < along * 4 + 0.02, `${arrow} at ${azimuth}/${elevation} went sideways: ${across.toFixed(4)} vs ${along.toFixed(4)}`);
        assert.equal(now.elevation < 0, elevation < 0, 'the sun stays on its side of the object');
      }
    }
  }
});

test('arrow keys: the sun at the top goes right with Right and out with Up, and Shift is ten times as far', () => {
  assert.deepEqual(nudge({ azimuth: 0, elevation: 40 }, 'right'), { azimuth: 1, elevation: 40 });
  assert.equal(nudge({ azimuth: 0, elevation: 40 }, 'right', 10).azimuth, 13, 'Shift: ten degrees on the screen, more round the ring');
  assert.deepEqual(nudge({ azimuth: 0, elevation: 40 }, 'up'), { azimuth: 0, elevation: 39 }, 'up at the top is out toward the rim');
  assert.deepEqual(nudge({ azimuth: 0, elevation: 40 }, 'down'), { azimuth: 0, elevation: 41 });
  assert.deepEqual(nudge({ azimuth: 180, elevation: 40 }, 'up'), { azimuth: 180, elevation: 41 }, 'up at the bottom is in toward the centre');
  assert.equal(nudge({ azimuth: 180, elevation: 40 }, 'right').azimuth, 179, 'right at the bottom goes the other way round');
  assert.deepEqual(nudge({ azimuth: 90, elevation: 40 }, 'right'), { azimuth: 90, elevation: 39 }, 'right at the right is out');
  assert.deepEqual(nudge({ azimuth: 270, elevation: 40 }, 'right'), { azimuth: 270, elevation: 41 }, 'right at the left is in');
  assert.deepEqual(nudge({ azimuth: 0, elevation: 40 }, 'up', 10), { azimuth: 0, elevation: 30 });
  assert.deepEqual(nudge({ azimuth: 10, elevation: 90 }, 'left'), { azimuth: 270, elevation: 89 }, 'from the centre it goes the way the arrow points');
  assert.deepEqual(nudge({ azimuth: 270, elevation: 0 }, 'left'), { azimuth: 270, elevation: 0 }, 'and stops at the rim');
  // behind the object the same screen directions, still behind
  assert.deepEqual(nudge({ azimuth: 0, elevation: -40 }, 'up'), { azimuth: 0, elevation: -39 });
  assert.deepEqual(nudge({ azimuth: 180, elevation: -40 }, 'up'), { azimuth: 180, elevation: -41 });
});

test('the presets: classic set-ups as the directions they say', () => {
  const by = Object.fromEntries(PRESETS.map((p) => [p.id, p.light]));
  assert.deepEqual(PRESETS.map((p) => p.id), ['upper-left', 'top', 'side', 'rim', 'back', 'front']);
  assert.deepEqual(by['upper-left'], { azimuth: 320, elevation: 35 }, 'the default light');
  const dir = (id: string) => direction(by[id]);
  // upper left: left, up and toward the viewer
  assert.ok(dir('upper-left')[0] < 0 && dir('upper-left')[1] > 0 && dir('upper-left')[2] > 0);
  // top: straight above, a little toward the viewer
  assert.ok(near(dir('top')[0], 0) && dir('top')[1] > 0.7 && dir('top')[2] > 0);
  // side: raking from the left
  assert.ok(dir('side')[0] < -0.9 && dir('side')[2] > 0 && dir('side')[2] < 0.25);
  // rim: behind the object, from the left
  assert.ok(dir('rim')[0] < 0 && dir('rim')[2] < 0);
  // back: from behind, mostly
  assert.ok(dir('back')[2] < -0.9);
  // front: from the viewer
  assert.ok(near(dir('front')[2], 1));
  assert.equal(presetOf({ azimuth: 0, elevation: -70 }), 'back');
  assert.equal(presetOf({ azimuth: 360, elevation: 90 }), 'front');
  assert.equal(presetOf({ azimuth: 1, elevation: -70 }), null);
});

test('the light in words', () => {
  assert.equal(lightWords({ azimuth: 320, elevation: 35 }), 'from the upper left');
  assert.equal(lightWords({ azimuth: 270, elevation: 12 }), 'from the left');
  assert.equal(lightWords({ azimuth: 270, elevation: 6 }), 'raking from the left');
  assert.equal(lightWords({ azimuth: 0, elevation: 35 }), 'from above');
  assert.equal(lightWords({ azimuth: 300, elevation: -30 }), 'from behind and the upper left');
  assert.equal(lightWords({ azimuth: 0, elevation: -70 }), 'from behind and above');
  assert.equal(lightWords({ azimuth: 0, elevation: -80 }), 'from straight behind');
  assert.equal(lightWords({ azimuth: 0, elevation: 90 }), 'straight on, from where you stand');
  assert.equal(lightWords({ azimuth: 359, elevation: 30 }), 'from above');
});
