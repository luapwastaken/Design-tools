import { test } from 'node:test';
import assert from 'node:assert/strict';
import { toHex } from '../src/shared/color/index.ts';
import { parseColours } from '../src/shared/palette/paste.ts';

const hexes = (text: string) => parseColours(text).colours.map(toHex);

const TABLE: [string, string][] = [
  ['#ff8800', '#ff8800'],
  ['ff8800', '#ff8800'],
  ['#F80', '#ff8800'],
  ['f80', '#ff8800'],
  ['#ff880080', '#ff8800'],
  ['#f808', '#ff8800'],
  ['rgb(255, 128, 0)', '#ff8000'],
  ['rgb(255 128 0)', '#ff8000'],
  ['rgba(255, 128, 0, 0.5)', '#ff8000'],
  ['rgb(255 128 0 / 50%)', '#ff8000'],
  ['rgb(100%, 50%, 0%)', '#ff8000'],
  ['RGB(300, -5, 0)', '#ff0000'],
  ['hsl(30, 100%, 50%)', '#ff8000'],
  ['hsl(30deg 100% 50%)', '#ff8000'],
  ['hsla(0.5turn, 100%, 50%, 0.3)', '#00ffff'],
  ['oklch(0.628 0.2577 29.23)', '#ff0000'],
  ['oklch(62.8% 0.2577 29.23)', '#ff0000'],
  ['oklch(62.8% 64.4% 29.23deg / 1)', '#ff0000'],
  ['oklab(0.628 0.2249 0.1258)', '#ff0000'],
  ['lab(54.29 80.8 69.89)', '#ff0000'],
  ['lab(54.29% 64.64% 55.91%)', '#ff0000'],
];

test('each syntax parses to the right colour', () => {
  for (const [input, want] of TABLE) {
    const r = parseColours(input);
    assert.deepEqual(r.rejected, [], input);
    assert.deepEqual(r.colours.map(toHex), [want], input);
    assert.deepEqual(r.names, [null], input);
  }
});

test('rgb(255, 128, 0) stays one colour among comma-separated items', () => {
  assert.deepEqual(hexes('rgb(255, 128, 0), #000, hsl(0, 0%, 100%)'), ['#ff8000', '#000000', '#ffffff']);
});

test('one per line, CRLF, blank lines and spaces', () => {
  assert.deepEqual(hexes('  #ff0000\r\n\n  00ff00  \n#00f\n'), ['#ff0000', '#00ff00', '#0000ff']);
});

test('names around a colour are kept', () => {
  const r = parseColours('Ember: #e8643c\nBone = efe9dd\n--moss-green: rgb(63, 107, 79);\n#8fb8de Sky\n"Iron": "#6b6f76",\n#000');
  assert.deepEqual(r.names, ['Ember', 'Bone', 'moss-green', 'Sky', 'Iron', null]);
  assert.deepEqual(r.colours.map(toHex), ['#e8643c', '#efe9dd', '#3f6b4f', '#8fb8de', '#6b6f76', '#000000']);
  assert.deepEqual(r.rejected, []);
});

test('several colours in one item are each unnamed', () => {
  const r = parseColours('#f00 #0f0 rgb(0 0 255)');
  assert.deepEqual(r.colours.map(toHex), ['#ff0000', '#00ff00', '#0000ff']);
  assert.deepEqual(r.names, [null, null, null]);
});

test('junk is rejected, not guessed', () => {
  const r = parseColours('reddish\n#12345\n#1234567\nrgb(1, 2)\nhsl(10%, 50%, 50%)\nrgb(10deg 0 0)\nrgb(1, 2, 3, 4, 5)\noklch(0.5 0.1 zz)\n#abcdefg\nhello world\n#ff0000');
  assert.deepEqual(r.colours.map(toHex), ['#ff0000']);
  assert.deepEqual(r.rejected, ['reddish', '#12345', '#1234567', 'rgb(1, 2)', 'hsl(10%, 50%, 50%)', 'rgb(10deg 0 0)', 'rgb(1, 2, 3, 4, 5)', 'oklch(0.5 0.1 zz)', '#abcdefg', 'hello world']);
});

test('bare hex only as the whole item or after "name:", so hex-letter words stay names', () => {
  assert.deepEqual(hexes('abc'), ['#aabbcc']);
  assert.deepEqual(parseColours('Beef: #ff0000').names, ['Beef']);
  assert.deepEqual(parseColours('Cafe: bad').names, ['Cafe']);
  assert.deepEqual(hexes('Cafe: bad'), ['#bbaadd']);
  assert.deepEqual(parseColours('Coffee bad').rejected, ['Coffee bad']);
});

test('CSS keywords, hwb(), lch() and color() read like any other colour', () => {
  assert.deepEqual(hexes('white\nPaper: black\nrebeccapurple\nhwb(0 0% 0%)\nlch(29.2 44.5 293)'), ['#ffffff', '#000000', '#663399', '#ff0000', '#3f3d85']);
  assert.deepEqual(parseColours('Paper: black').names, ['Paper']);
  const [p3] = parseColours('color(display-p3 1 0 0)').colours;
  assert.ok(p3 && p3[1] > 0.29, 'a P3 red stays wider than sRGB');
  assert.deepEqual(parseColours('transparent').colours, []);
});

test('hex-letter words without "#" stay words unless they are 3 or 6 digits', () => {
  assert.deepEqual(parseColours('beef\ncafe\nface').colours, []);
  assert.deepEqual(hexes('add\nc0ffee'), ['#aadddd', '#c0ffee']);
});

test('comments, brackets and list numbers are not names; repeats come once', () => {
  const r = parseColours('Ember #E8643C /* primary */\nPrimary (#123456)\n1. #abcdef\nMoss - #3f6b4f // brand\n#abc, #aabbcc, #aabbccdd');
  assert.deepEqual(r.names, ['Ember', 'Primary', null, 'Moss', null]);
  assert.deepEqual(r.colours.map(toHex), ['#e8643c', '#123456', '#abcdef', '#3f6b4f', '#aabbcc']);
});

test('JSON: a list, a tokens object and this tool’s own export', () => {
  assert.deepEqual(parseColours('["#e8643c", "#223344"]').names, [null, null]);
  const tokens = parseColours('{"brand": {"primary": "#e8643c", "ink": "rgb(20 22 26)"}, "size": "12px"}');
  assert.deepEqual(tokens.names, ['primary', 'ink']);
  assert.deepEqual(tokens.rejected, []);
  const own = parseColours(JSON.stringify({ name: 'Brand', swatches: [{ name: 'Laser', hex: '#00ff00', oklch: [0.9, 0.3, 145] }] }));
  assert.deepEqual(own.names, ['Laser']);
  assert.deepEqual(own.colours, [[0.9, 0.3, 145]], 'full-precision OKLCH, wider than the hex');
});

test('hues are 0..360 and nothing is NaN', () => {
  const { colours } = parseColours('oklch(0.5 0.1 -30)\noklch(0.5 0.1 400)\nhsl(none 0% 50%)\nlab(50 0 0)');
  assert.deepEqual(colours.map((o) => Math.round(o[2])).slice(0, 2), [330, 40]);
  assert.ok(colours.flat().every(Number.isFinite));
});

test('plain numbers are one colour: 0-255, or 0-1 (brackets: sRGB as After Effects writes it; none: Linear RGB)', () => {
  for (const text of ['255, 136, 0', '255,136,0', '255 136 0', '[255, 136, 0]', '255, 136, 0, 255']) assert.deepEqual(hexes(text), ['#ff8800'], text);
  assert.deepEqual(hexes('[1, 0.5333, 0, 1]'), ['#ff8800'], 'an After Effects array');
  assert.deepEqual(hexes('1, 0.2462, 0'), ['#ff8800'], 'this tool’s Linear RGB copy');
  assert.deepEqual(parseColours('255, 136, 0, 128').notes, ['Alpha is ignored']);
  assert.deepEqual(parseColours('[1, 0.5333, 0, 1]').notes, ['Alpha is ignored']);
  assert.deepEqual(hexes('250, 250, 250'), ['#fafafa'], 'a run of three 3-digit numbers is a grey, not three hex colours');
  // two numbers, or numbers that fit no scale, are refused whole
  for (const text of ['100, 200', '300, 20, 5', '123, 456, 789']) {
    const r = parseColours(text);
    assert.deepEqual(r.colours, [], text);
    assert.deepEqual(r.rejected.length > 0, true, text);
  }
  // letters make them hex; one number alone is still a 3-digit hex
  assert.deepEqual(hexes('fff, 123'), ['#ffffff', '#112233']);
  assert.deepEqual(hexes('123'), ['#112233']);
});

test('0xRRGGBB, and an 8-digit hex says its alpha is dropped', () => {
  assert.deepEqual(hexes('0xFF8800'), ['#ff8800']);
  assert.deepEqual(parseColours('#ff880080').notes, ['Alpha is ignored']);
  assert.deepEqual(parseColours('#ff8800').notes, []);
});

test('design tokens: $value, key names, role words kept, prefixes dropped, the first name kept', () => {
  const dtcg = parseColours('{"brand": {"primary": {"$value": "#E8643C", "$type": "color"}, "surface": {"$value": "#fbf7f0"}}}');
  assert.deepEqual(dtcg.colours.map(toHex), ['#e8643c', '#fbf7f0']);
  assert.deepEqual(dtcg.names, ['primary', 'surface']);
  const fragment = parseColours('"accent": {"$value": "#E8643C"}');
  assert.deepEqual(fragment.names, ['accent']);
  assert.deepEqual(parseColours('--color-brand-primary: #e8643c;').names, ['brand-primary']);
  const twice = parseColours('#E8643C\nEmber: #E8643C');
  assert.deepEqual(twice.colours.length, 1);
  assert.deepEqual(twice.names, ['Ember'], 'the later name is kept when the first had none');
});
