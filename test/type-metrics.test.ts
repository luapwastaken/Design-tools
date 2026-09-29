import { test } from 'node:test';
import assert from 'node:assert/strict';
import { findType } from '../src/renderer/lib/type-metrics.ts';
import { ASC, bigTrademark, CAP, frame, OVER, raster, registered, script, set, swashCapital, trademark, XH, type Prim } from './fixtures/wordmarks.ts';

/** the metrics of the outlines drawn at `perEm` px per em, and where the em lines fall in px */
function measure(prims: Prim[], perEm: number) {
  const r = raster(prims, perEm);
  return { found: findType(r.rgba, r.w, r.h), row: r.row };
}

/** within a pixel, plus a round letter's overshoot where one may be what sets the line */
function near(actual: number | undefined, expected: number, perEm: number, what: string, round = false) {
  const slack = 1 + (round ? OVER * perEm : 0);
  assert.ok(actual !== undefined && Math.abs(actual - expected) <= slack, `${what}: ${actual} px, expected ${expected.toFixed(1)} ± ${slack.toFixed(1)}`);
}

// 1024 px wide, as the renderer draws a wordmark, and small, as a tiny PNG gives it
const SIZES = [{ name: '1024 px wide', perEm: (width: number) => 1024 / width }, { name: '40 px an em', perEm: () => 40 }];

for (const size of SIZES) {
  test(`all caps: cap height and baseline, no x-height (${size.name})`, () => {
    const word = set('HELLO');
    const perEm = size.perEm(word.width);
    const { found, row } = measure(word.prims, perEm);
    near(found?.capTop, row(CAP), perEm, 'cap top');
    near(found?.baseline, row(0), perEm, 'baseline');
    assert.equal(found?.xTop, undefined);
  });

  test(`bars and stems (where per-row coverage reads a T's bar as a baseline) (${size.name})`, () => {
    for (const text of ['TETE', 'TTT', 'ELITE']) {
      const word = set(text);
      const perEm = size.perEm(word.width);
      const { found, row } = measure(word.prims, perEm);
      near(found?.capTop, row(CAP), perEm, `${text} cap top`);
      near(found?.baseline, row(0), perEm, `${text} baseline`);
    }
  });

  test(`mixed case with descenders: baseline above the descenders, x-height found (${size.name})`, () => {
    const word = set('Hypergly');
    const perEm = size.perEm(word.width);
    const { found, row } = measure(word.prims, perEm);
    near(found?.baseline, row(0), perEm, 'baseline');
    // the tallest letters are the H (cap height) and the l (ascender, a touch taller)
    assert.ok(found && found.capTop >= row(ASC) - 1 && found.capTop <= row(CAP) + 1, `cap top ${found?.capTop} between ${row(ASC)} and ${row(CAP)}`);
    near(found?.xTop, row(XH), perEm, 'x-height top');
  });

  test(`mixed case without descenders, and only round x-height letters (${size.name})`, () => {
    const word = set('Hello');
    const perEm = size.perEm(word.width);
    const { found, row } = measure(word.prims, perEm);
    near(found?.baseline, row(0), perEm, 'baseline');
    assert.ok(found && found.capTop >= row(ASC) - 1 && found.capTop <= row(CAP) + 1);
    near(found?.xTop, row(XH), perEm, 'x-height top', true);
  });

  test(`lowercase with no ascenders: the x-height is the top (${size.name})`, () => {
    for (const text of ['mono', 'yoga']) {
      const word = set(text);
      const perEm = size.perEm(word.width);
      const { found, row } = measure(word.prims, perEm);
      near(found?.capTop, row(XH), perEm, `${text} top`, true);
      near(found?.baseline, row(0), perEm, `${text} baseline`, true);
      assert.equal(found?.xTop, undefined, text);
    }
  });

  test(`italic: slanted letters stand on the same lines (${size.name})`, () => {
    const word = set('Hypergly', { slant: 0.2 });
    const perEm = size.perEm(word.width + 0.2);
    const { found, row } = measure(word.prims, perEm);
    near(found?.baseline, row(0), perEm, 'baseline');
    near(found?.xTop, row(XH), perEm, 'x-height top');
  });
}

test('round letters overshoot: the line is found within the overshoot', () => {
  const word = set('OQO');
  const perEm = 1024 / word.width;
  const { found, row } = measure(word.prims, perEm);
  near(found?.baseline, row(0), perEm, 'baseline', true);
  near(found?.capTop, row(CAP), perEm, 'cap top', true);
});

test('accents above the caps and dots over an i are not the cap height', () => {
  const word = set('ÉLÉ');
  const perEm = 1024 / word.width;
  const { found, row } = measure(word.prims, perEm);
  near(found?.capTop, row(CAP), perEm, 'cap top');
  near(found?.baseline, row(0), perEm, 'baseline');
  const mini = set('mini');
  const m = measure(mini.prims, 1024 / mini.width);
  near(m.found?.capTop, m.row(XH), 1024 / mini.width, 'mini top', true);
});

test('a trademark sign is neither the cap height nor the baseline', () => {
  for (const text of ['HELLO', 'HO', 'mono']) {
    const word = set(text);
    const prims = [...word.prims, ...trademark(word.width)];
    const perEm = 1024 / (word.width + 0.3);
    const { found, row } = measure(prims, perEm);
    near(found?.baseline, row(0), perEm, `${text} baseline`, true);
    near(found?.capTop, row(text === 'mono' ? XH : CAP), perEm, `${text} cap top`, true);
  }
});

test('a trademark or registered sign the size most faces set it is not the baseline either', () => {
  const signs = { 'TM 0.45': (x: number) => bigTrademark(x, 0.45), 'TM 0.56': (x: number) => bigTrademark(x), 'TM 0.62': (x: number) => bigTrademark(x, 0.62), '(R)': (x: number) => registered(x) };
  for (const text of ['HELLO', 'Hello', 'ALE', 'mono']) {
    for (const [sign, draw] of Object.entries(signs)) {
      const word = set(text);
      const prims = [...word.prims, ...draw(word.width)];
      const perEm = 1024 / (word.width + 0.6);
      const { found, row } = measure(prims, perEm);
      near(found?.baseline, row(0), perEm, `${text} ${sign} baseline`, true);
      if (text !== 'mono') near(found?.capTop, row(text === 'Hello' ? ASC : CAP), perEm, `${text} ${sign} cap top`, true);
    }
  }
});

test('a ring joined to the top of an A is not the cap height; a lone capital still is', () => {
  for (const text of ['ÅLE', 'ÅHE', 'Åmo']) {
    const word = set(text);
    const perEm = 1024 / word.width;
    const { found, row } = measure(word.prims, perEm);
    near(found?.capTop, row(CAP), perEm, `${text} cap top`, true);
    near(found?.baseline, row(0), perEm, `${text} baseline`, true);
  }
  for (const text of ['Amo', 'Hemo']) {
    const word = set(text);
    const perEm = 1024 / word.width;
    const { found, row } = measure(word.prims, perEm);
    near(found?.capTop, row(CAP), perEm, `${text} cap top`, true);
    near(found?.xTop, row(XH), perEm, `${text} x-height`, true);
  }
});

test('a letter anti-aliasing broke in two still leaves the lines found', () => {
  const head = set('He');
  // an l in two pieces, the gap a pixel or so at this size
  const l: Prim[] = [[[[head.width + 0.06, 0.3], [head.width + 0.15, 0.3], [head.width + 0.15, ASC], [head.width + 0.06, ASC]]], [[[head.width + 0.06, 0], [head.width + 0.15, 0], [head.width + 0.15, 0.29], [head.width + 0.06, 0.29]]]];
  const tail = set('lo', { dx: head.width + 0.21 });
  const perEm = 1024 / (head.width + 0.21 + tail.width);
  const { found, row } = measure([...head.prims, ...l, ...tail.prims], perEm);
  near(found?.baseline, row(0), perEm, 'baseline', true);
  near(found?.xTop, row(XH), perEm, 'x-height', true);
});

test('a small tagline under the letters leaves their lines alone', () => {
  const word = set('HELLO');
  const tag = set('LOTTE', { size: 0.3, dy: -0.45 });
  const perEm = 1024 / word.width;
  const { found, row } = measure([...word.prims, ...tag.prims], perEm);
  near(found?.capTop, row(CAP), perEm, 'cap top');
  near(found?.baseline, row(0), perEm, 'baseline');
});

test('a frame round the letters is not a letter', () => {
  const word = set('HELLO');
  const perEm = 1024 / (word.width + 0.3);
  const { found, row } = measure([...word.prims, ...frame(-0.15, -0.2, word.width + 0.15, 0.9)], perEm);
  near(found?.capTop, row(CAP), perEm, 'cap top');
  near(found?.baseline, row(0), perEm, 'baseline');
});

test('letters that touch still count, as long as some stand apart', () => {
  // H and E overlap, the rest are set normally
  const he = set('HE', { tracking: -0.12 });
  const rest = set('LLO', { dx: he.width + 0.05 });
  const perEm = 1024 / (he.width + rest.width);
  const { found, row } = measure([...he.prims, ...rest.prims], perEm);
  near(found?.capTop, row(CAP), perEm, 'cap top');
  near(found?.baseline, row(0), perEm, 'baseline');
});

test('a joined run of letters stands on the line its letters stand on', () => {
  const run = set('nnnn', { tracking: -0.14 });
  const rest = set('mo', { dx: run.width + 0.2 });
  const perEm = 1024 / (run.width + rest.width + 0.2);
  const { found, row } = measure([...run.prims, ...rest.prims], perEm);
  near(found?.baseline, row(0), perEm, 'baseline', true);
});

test('a joined run with one descender in it is not standing on the descender line', () => {
  // every piece reaches below the line: the run through its p, the g on its own
  const run = set('nnnp', { tracking: -0.14 });
  const g = set('g', { dx: run.width + 0.2 });
  assert.equal(measure([...run.prims, ...g.prims], 300).found, null);
});

// What doesn't read as one line of type gives no metrics; the lockup uses the artwork box.
test('a joined script falls back to the artwork box', () => {
  assert.equal(measure(script(), 300).found, null);
});

test('a script with a separate swash capital falls back to the artwork box', () => {
  assert.equal(measure([...swashCapital(), ...script(0.75)], 300).found, null);
});

test('a single letter, or letters all joined, fall back to the artwork box', () => {
  assert.equal(measure(set('H').prims, 300).found, null);
  assert.equal(measure(set('HELL', { tracking: -0.14 }).prims, 300).found, null);
});

test('two lines the same size fall back to the artwork box', () => {
  const top = set('HELLO');
  const bottom = set('HELLO', { dy: -1 });
  assert.equal(measure([...top.prims, ...bottom.prims], 300).found, null);
});

test('letters that bounce off the line fall back to the artwork box', () => {
  assert.equal(measure(set('HELLO', { bounce: [0, 0.12, -0.08, 0.16, 0.05] }).prims, 300).found, null);
});

test('a word whose letters mostly descend falls back rather than taking the descender line', () => {
  const found = measure(set('pygmy').prims, 300).found;
  assert.equal(found, null);
});

test('many words, sizes and slants: the lines found are right, or none are', () => {
  // letters by where they stand: descenders hang below the line
  const STAND = 'HELTIOMÉoecadnhmrlit';
  const DESCEND = 'pyg';
  let seed = 7;
  const rand = () => ((seed = (seed * 16807) % 2147483647) - 1) / 2147483646;
  const pick = (s: string) => [...s][Math.floor(rand() * [...s].length)];
  let measured = 0;
  const words = 300;
  for (let n = 0; n < words; n++) {
    const letters = Array.from({ length: 3 + Math.floor(rand() * 6) }, () => (rand() < 0.25 ? pick(DESCEND) : pick(STAND)));
    // two letters at least stand on the line, or there's no line to find
    while (letters.filter((c) => STAND.includes(c)).length < 2) letters[Math.floor(rand() * letters.length)] = pick(STAND);
    const text = letters.join('');
    const slant = rand() < 0.3 ? 0.2 : 0;
    const word = set(text, { slant });
    const perEm = rand() < 0.3 ? 40 : 1024 / (word.width + slant);
    const { found, row } = measure(word.prims, perEm);
    if (!found) continue;
    measured++;
    near(found.baseline, row(0), perEm, `${text} baseline`, true);
    // the cap top is a letter top: at most the ascender's, at least the x-height's
    assert.ok(found.capTop >= row(ASC + OVER) - 1 && found.capTop <= row(XH - OVER) + 1, `${text} cap top ${found.capTop}`);
    if (found.xTop !== undefined) near(found.xTop, row(XH), perEm, `${text} x-height top`, true);
  }
  // falling back is for artwork that isn't a line of type, not for ordinary words
  assert.ok(measured >= words * 0.9, `${measured} of ${words} measured`);
});

test('nothing drawn, or one pixel of noise, gives no metrics', () => {
  assert.equal(findType(new Uint8ClampedArray(40 * 10 * 4), 40, 10), null);
  const one = new Uint8ClampedArray(40 * 10 * 4);
  one[(5 * 40 + 5) * 4 + 3] = 255;
  assert.equal(findType(one, 40, 10), null);
});
