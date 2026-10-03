import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { toHex } from '../src/shared/color/index.ts';
import { svgColours } from '../src/shared/svg/index.ts';

const hexes = (svg: string) => svgColours(svg).map(toHex);
const fixture = (name: string) => readFileSync(new URL(`./fixtures/${name}`, import.meta.url), 'utf8');

test('paints from attributes, style attributes and <style> rules, in that order', () => {
  const svg =
    '<svg xmlns="http://www.w3.org/2000/svg"><style>.a{fill:#00ff00}</style><rect fill="#ff0000" stroke="white"/>' +
    '<path style="stroke: rgb(0 0 255); fill-opacity: .5"/><stop stop-color="#ffff00"/><feFlood flood-color="#00ffff"/></svg>';
  assert.deepEqual(hexes(svg), ['#ff0000', '#ffffff', '#0000ff', '#ffff00', '#00ffff', '#00ff00']);
});

test('what paints nothing or points elsewhere is skipped', () => {
  const svg = '<svg xmlns="http://www.w3.org/2000/svg"><rect fill="none" stroke="currentColor"/><path fill="url(#g)" stroke="transparent"/><circle fill="inherit"/><rect fill="#ff0000"/></svg>';
  assert.deepEqual(hexes(svg), ['#ff0000']);
});

test('shapes that name no paint at all draw black; no shapes, no colours', () => {
  assert.deepEqual(hexes('<svg xmlns="http://www.w3.org/2000/svg"><path d="M0 0h1v1z"/></svg>'), ['#000000']);
  assert.deepEqual(hexes('<svg xmlns="http://www.w3.org/2000/svg"><g/></svg>'), []);
});

test('Illustrator exports: class rules, gradient stops, CDATA styles', () => {
  assert.deepEqual(hexes(fixture('svg-illustrator-a.svg')), ['#e6007e', '#312783', '#1d1d1b']);
  assert.deepEqual(hexes(fixture('svg-illustrator-legacy.svg')), ['#e30613', '#1d1d1b']);
});

test('markup that is not an SVG says so', () => {
  assert.throws(() => svgColours('<svg><path></svg>'), /couldn't be read/);
});

test('mask and clip-path paint is how much shows, not a colour: left out, rules reaching only it too', () => {
  const svg =
    '<svg xmlns="http://www.w3.org/2000/svg"><style>.m{fill:#ffffff}.a{fill:#123456}</style><defs><mask id="k"><rect class="m" width="9" height="9"/><rect fill="#000" width="3" height="3"/></mask>' +
    '<clipPath id="c"><rect width="9" height="9"/></clipPath></defs><g clip-path="url(#c)"><rect class="a" mask="url(#k)" width="9" height="9"/></g></svg>';
  assert.deepEqual(hexes(svg), ['#123456']);
});
