import { test } from 'node:test';
import assert from 'node:assert/strict';
import { gifDelays } from '../src/renderer/lib/gif.ts';
import { DEFAULT_FPS, frameOf, gifPlan, isCleanRate, isVideoFile, seekTime, snapFps, timingOf, typicalStep, videoProblem } from '../src/renderer/tools/postfx/media-time.ts';

const sum = (a: readonly number[]) => a.reduce((s, x) => s + x, 0);
const still = (seconds: number, fps: number) => timingOf('image', { frames: 1, fps: null, delays: null }, { seconds, fps });
const clip = (frames: number, fps: number) => timingOf('video', { frames, fps, delays: null }, { seconds: 1, fps: 1 });

test('a frame duration in µs snaps to the rate the encoder meant: NTSC rates stay NTSC, jitter snaps to whole rates', () => {
  assert.equal(snapFps(1e6 / 41708), 24000 / 1001);
  assert.equal(snapFps(1e6 / 33367), 30000 / 1001);
  assert.equal(snapFps(1e6 / 16683), 60000 / 1001);
  assert.equal(snapFps(1e6 / 41667), 24);
  assert.equal(snapFps(1e6 / 40000), 25);
  assert.equal(snapFps(23.99), 24, 'a recording 0.04% slow is still 24');
  assert.equal(snapFps(9.98), 10, 'no NTSC twin below 24');
  assert.equal(snapFps(49 / 2.044), 24000 / 1001, "an NTSC WebM's span on its 1 ms clock is nearer 23.976 than 24");
  assert.equal(snapFps(49 / 2.042), 24);
  assert.equal(snapFps(12.5), 12.5, 'an odd rate stays as measured');
  for (const bad of [0, -3, NaN, Infinity]) assert.equal(snapFps(bad), DEFAULT_FPS);
});

test('the step between presented frames leaves out a dropped frame and averages out a coarse clock', () => {
  // 25 fps with frame 4 dropped
  assert.ok(Math.abs(typicalStep([0, 0.04, 0.08, 0.12, 0.2, 0.24, 0.28, 0.32, 0.36])! - 0.04) < 1e-9);
  // 60 fps on WebM's 1 ms clock: 17, 16, 17 ms… averages to within 1% of 1/60
  const ms = Array.from({ length: 13 }, (_, i) => Math.round((i * 1000) / 60) / 1000);
  assert.ok(Math.abs(1 / typicalStep(ms)! - 60) < 0.6, `${1 / typicalStep(ms)!}`);
  assert.equal(typicalStep([0.5]), null, 'one frame measures nothing');
  assert.equal(typicalStep([0.5, 0.5]), null, 'the same frame twice is no step');
});

test('a frame time that is exactly a rate is a container’s own; a recording’s clock is not', () => {
  for (const fps of [24, 25, 30, 50, 60, 24000 / 1001, 30000 / 1001, 60000 / 1001]) assert.ok(isCleanRate(1 / fps), `${fps}`);
  assert.ok(isCleanRate(0.040001), 'a microsecond off is still 25');
  assert.ok(isCleanRate(0.016667), '60 fps as 16667 µs');
  for (const ms of [0.017, 0.016, 0.0333, 0.0267]) assert.ok(!isCleanRate(ms), `${ms}`);
  for (const bad of [0, NaN, Infinity]) assert.ok(!isCleanRate(bad));
});

test('seeking to the middle of a frame lands on it, even with timestamps up to 40% of a frame early or late', () => {
  for (const fps of [24000 / 1001, 24, 25, 30000 / 1001, 60]) {
    for (const t0 of [0, 0.0417, 1.5]) {
      for (let i = 0; i < 400; i++) {
        const target = seekTime(i, t0, fps);
        assert.ok(target > t0 + i / fps && target < t0 + (i + 1) / fps, 'inside frame i');
        for (const jitter of [-0.4, 0, 0.4]) assert.equal(frameOf(t0 + (i + jitter) / fps, t0, fps), i);
      }
    }
  }
});

test("a still's loop is seconds × fps frames whose phases wrap exactly: frame count is frame 0 again", () => {
  const t = still(2, 25);
  assert.equal(t.count, 50);
  assert.equal(t.seconds, 2);
  assert.equal(t.phase(0), 0);
  assert.equal(t.phase(t.count), t.phase(0));
  assert.ok(t.phase(t.count - 1) < 1);
  for (let i = 0; i < t.count; i++) {
    assert.equal(t.phase(i), i / t.count);
    assert.equal(t.frameAt(t.at(i)), i, 'a frame shows from its own start');
    assert.equal(t.frameAt(t.at(i) + 1000 / 25 - 1e-3), i, 'until the next one starts');
    assert.equal(t.frameAt(t.at(i) + 2000), i, 'and the loop wraps');
  }
  const odd = still(2.05, 24);
  assert.equal(odd.count, 49);
  assert.equal(odd.seconds, 49 / 24, 'the length is whole frames long');
  assert.equal(still(0, 25).count, 1, 'nothing moving: one frame');
});

test("a GIF's own timing: each frame starts where the last ended, and phases follow time, not frame numbers", () => {
  const t = timingOf('gif', { frames: 3, fps: null, delays: [100, 50, 250] }, { seconds: 9, fps: 9 });
  assert.equal(t.count, 3);
  assert.equal(t.seconds, 0.4);
  assert.equal(t.fps, 7.5);
  assert.deepEqual([0, 1, 2, 3].map(t.at), [0, 100, 150, 0]);
  assert.deepEqual([0, 1, 2].map(t.phase), [0, 0.25, 0.375]);
  assert.deepEqual([0, 99.9, 100, 149.9, 150, 399.9, 400, 450].map(t.frameAt), [0, 0, 1, 1, 2, 2, 0, 0]);
  const rate = timingOf('gif', { frames: 3, fps: 12, delays: null }, { seconds: 9, fps: 9 });
  assert.equal(rate.fps, 12, 'a GIF whose timing gave way to a rate plays at that rate');
});

test("a clip's loop is its own frames at its own rate; a clip too short to measure plays at the default", () => {
  const t = clip(29, 10);
  assert.equal(t.count, 29);
  assert.equal(t.seconds, 2.9);
  assert.equal(timingOf('video', { frames: 12, fps: null, delays: null }, { seconds: 1, fps: 1 }).fps, DEFAULT_FPS);
  assert.throws(() => timingOf('image', { frames: 1, fps: null, delays: null }, { seconds: 1, fps: 0 }), /above 0/);
});

test('a GIF of a loop keeps its length exactly; past 50 fps it keeps every second or third frame', () => {
  const cases: [number, number, number][] = [
    // count, fps, the step it keeps
    [90, 30, 1],
    [50, 25, 1],
    [90, 60, 2],
    [29, 60000 / 1001, 2],
    [100, 120, 3],
    [7, 50, 1],
  ];
  for (const [count, fps, step] of cases) {
    const t = clip(count, fps);
    const plan = gifPlan(t, 600);
    assert.equal(plan.frames.length, Math.floor(count / step), `${count} at ${fps}`);
    assert.deepEqual(plan.frames, plan.frames.map((_, k) => k * step));
    assert.ok(Math.abs(sum(plan.delays) - (count * 1000) / fps) < 1e-6, 'as long as the loop');
    // what the encoder writes: every delay plays (at least 2 hundredths), and the loop lasts count / fps to the hundredth
    const cs = gifDelays(plan.frames.length, plan.delays);
    assert.equal(sum(cs), Math.round((count * 100) / fps));
  }
  const own = timingOf('gif', { frames: 3, fps: null, delays: [100, 50, 250] }, { seconds: 1, fps: 1 });
  assert.deepEqual(gifPlan(own, 600), { frames: [0, 1, 2], delays: [100, 50, 250] }, "a GIF's own timing goes through as it is");
  assert.throws(() => gifPlan(clip(900, 30), 600), /at most 600 frames; this loop is 900\. Export a PNG sequence/);
  assert.throws(() => gifPlan(clip(1500, 60), 600), /\(750 at the 30 fps a GIF can play\)/);
});

test('a video is known by its type, or by its extension when the type is vague; images never are', () => {
  assert.ok(isVideoFile('video/mp4', 'clip'));
  assert.ok(isVideoFile('video/quicktime', 'render.mov'));
  assert.ok(isVideoFile('', 'Render 04.MOV'));
  assert.ok(isVideoFile('application/octet-stream', 'take.mxf'));
  assert.ok(!isVideoFile('image/gif', 'loop.gif'));
  assert.ok(!isVideoFile('image/png', 'odd.mp4.png'));
  assert.ok(!isVideoFile('', 'still.png'));
});

test('a video that will not open says why in plain words, and what to export instead', () => {
  const codec = videoProblem('Render.mov', { code: 4, message: 'DEMUXER_ERROR_NO_SUPPORTED_STREAMS: FFmpegDemuxer: no supported streams' });
  assert.match(codec, /^Render\.mov can't be decoded here \(ProRes/);
  assert.match(codec, /Re-export as H\.264 MP4 or VP9 WebM\.$/);
  assert.ok(codec.length < 100, 'one line of a toast');
  assert.equal(videoProblem('Render.mov', null), codec, 'the sound opened but the picture did not: the same reason');
  assert.match(videoProblem('Broken.mp4', { code: 4, message: 'DEMUXER_ERROR_COULD_NOT_OPEN: FFmpegDemuxer: open context failed' }), /^Broken\.mp4 couldn't be read as a video\. The file may be damaged/);
  assert.match(videoProblem('Cut.mp4', { code: 3, message: 'PIPELINE_ERROR_DECODE: VDA Error 4' }), /damaged/);
  assert.match(videoProblem('Deep.mp4', { code: 3, message: 'DECODER_ERROR_NOT_SUPPORTED: video decoder initialization failed' }), /can't be decoded/);
});
