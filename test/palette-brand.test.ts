import { test } from 'node:test';
import assert from 'node:assert/strict';
import { contrast, hexToOklch, inSrgb, toHex, type Oklch } from '../src/shared/color/index.ts';
import { ACCENTS, buildRoles, completeRoles, STYLE_LIST, type Accent, type RoleColours } from '../src/shared/palette/brand.ts';
import { contrastPairs, valueCollisions } from '../src/shared/palette/checks.ts';
import { ROLES } from '../src/shared/palette/roles.ts';
import type { Swatch } from '../src/shared/types.ts';

const swatches = (c: RoleColours): Swatch[] => ROLES.map((role) => ({ id: role, name: role, role, oklch: c[role], type: 'process' }));
const on = (c: RoleColours, role: (typeof ROLES)[number], ground: 'Background' | 'Surface') => contrast(c[role], c[ground]);
const lightGround = (c: RoleColours) => c.Background[0] > 0.6;
const turn = (a: number, b: number) => (((b - a) % 360) + 540) % 360 - 180;

/** brand colours over the whole wheel and from near-black to near-white, as hex a user would type */
const BRANDS: Oklch[] = [];
for (let h = 0; h < 360; h += 15) for (const [l, c] of [[0.2, 0.03], [0.35, 0.1], [0.5, 0.15], [0.65, 0.18], [0.8, 0.15], [0.92, 0.04], [0.97, 0.01], [0.6, 0]] as const) BRANDS.push(hexToOklch(toHex([l, c, h])));
const TYPED: Accent[] = ['analogous', 'complementary', 'split', 'triad', 'none'];

/** every contrast the Contrast tab judges a role by: Text 7:1, Muted and Accent 4.5:1, Highlight 3:1, each on Background and on Surface */
function assertReads(c: RoleColours, why: string) {
  for (const g of ['Background', 'Surface'] as const) {
    assert.ok(on(c, 'Text', g) >= 7, `${why}: Text on ${g} ${on(c, 'Text', g).toFixed(2)}`);
    assert.ok(on(c, 'Muted', g) >= 4.5, `${why}: Muted on ${g} ${on(c, 'Muted', g).toFixed(2)}`);
    assert.ok(on(c, 'Accent', g) >= 4.5, `${why}: Accent on ${g} ${on(c, 'Accent', g).toFixed(2)}`);
    assert.ok(on(c, 'Highlight', g) >= 3, `${why}: Highlight on ${g} ${on(c, 'Highlight', g).toFixed(2)}`);
  }
}

test('a typed brand colour: the Primary is exactly it, and every other role is built to read, in every style and accent', () => {
  let builds = 0;
  let collided = 0;
  let primaryUnder3 = 0;
  for (const st of STYLE_LIST) {
    for (const accent of ACCENTS.map((a) => a.value)) {
      BRANDS.forEach((brand, i) => {
        const c = buildRoles({ seed: 1 + i, style: st.id, accent, locked: { Primary: brand } });
        const why = `${st.id}/${accent}/${toHex(brand)}`;
        assert.deepEqual(c.Primary, brand, `${why}: Primary`);
        assert.equal(toHex(c.Primary), toHex(brand), why);
        for (const r of ROLES) if (r !== 'Primary') assert.ok(inSrgb(c[r]), `${why}: ${r} is outside sRGB`);
        assertReads(c, why);
        builds++;
        if (valueCollisions(swatches(c), 0.06).length) collided++;
        if (Math.min(on(c, 'Primary', 'Background'), on(c, 'Primary', 'Surface')) < 3) primaryUnder3++;
      });
    }
  }
  // a brand colour sitting right on 3:1 may fall short on one ground (it is the user's, never moved); the built roles keep their lightness apart
  assert.ok(primaryUnder3 / builds < 0.01, `the Primary holds 3:1 on both grounds in ${builds - primaryUnder3} of ${builds}`);
  assert.equal(collided, 0, `${collided} of ${builds} builds have two roles within 0.06 of lightness`);
});

test('the same options always give the same palette; another seed gives another', () => {
  const o = { seed: 42, style: 'bold', accent: 'triad' as const, locked: { Primary: hexToOklch('#e8643c') } };
  assert.deepEqual(buildRoles(o), buildRoles({ ...o }));
  assert.notDeepEqual(buildRoles(o).Accent, buildRoles({ ...o, seed: 43 }).Accent);
  assert.deepEqual(buildRoles({ seed: 9, style: 'quiet', accent: 'none' }), buildRoles({ seed: 9, style: 'quiet', accent: 'none' }));
});

test('Surprise me (no brand colour): any seed and style reads, the Primary included, in sRGB', () => {
  for (const st of STYLE_LIST) {
    for (let seed = 1; seed <= 120; seed++) {
      const accent = TYPED[seed % TYPED.length];
      const c = buildRoles({ seed, style: st.id, accent });
      const why = `${st.id}/${accent}/${seed}`;
      assertReads(c, why);
      for (const r of ROLES) assert.ok(inSrgb(c[r]), `${why}: ${r} is outside sRGB`);
      for (const g of ['Background', 'Surface'] as const) assert.ok(on(c, 'Primary', g) >= 3, `${why}: Primary on ${g} ${on(c, 'Primary', g).toFixed(2)}`);
    }
  }
});

test('the style sets the ground: light for most, dark for Tech', () => {
  const brand = hexToOklch('#3a7bd5');
  for (const st of STYLE_LIST) assert.equal(lightGround(buildRoles({ seed: 5, style: st.id, accent: 'analogous', locked: { Primary: brand } })), st.id !== 'tech', st.id);
});

test('edge colours: near-white, near-black and pure yellow keep their value and get a ground they hold 3:1 on', () => {
  const edge: [string, string][] = [['#fafaf5', 'near-white'], ['#0a0a0a', 'near-black'], ['#ffff00', 'pure yellow'], ['#ffffff', 'white'], ['#000000', 'black'], ['#ffd400', 'amber'], ['#00ff00', 'pure green']];
  for (const [hex, name] of edge) {
    for (const st of STYLE_LIST) {
      const c = buildRoles({ seed: 3, style: st.id, accent: 'complementary', locked: { Primary: hexToOklch(hex) } });
      assert.equal(toHex(c.Primary), hex, name);
      assertReads(c, `${name}/${st.id}`);
      for (const g of ['Background', 'Surface'] as const) assert.ok(on(c, 'Primary', g) >= 3, `${name}/${st.id}: Primary on ${g} ${on(c, 'Primary', g).toFixed(2)}`);
    }
  }
  const yellow = buildRoles({ seed: 3, style: 'quiet', accent: 'analogous', locked: { Primary: hexToOklch('#ffff00') } });
  assert.equal(lightGround(yellow), false, 'yellow on a light page fails 3:1, so the ground goes dark');
  const navy = buildRoles({ seed: 3, style: 'tech', accent: 'analogous', locked: { Primary: hexToOklch('#0b1f4d') } });
  assert.equal(lightGround(navy), true, 'a navy brand colour cannot hold 3:1 on a dark ground, so Tech goes light');
});

test('a colour outside sRGB stays exactly as typed and the rest still reads', () => {
  const wide: Oklch = [0.7, 0.33, 150];
  assert.ok(!inSrgb(wide));
  const c = buildRoles({ seed: 2, style: 'bold', accent: 'split', locked: { Primary: wide } });
  assert.deepEqual(c.Primary, wide);
  assertReads(c, 'wide');
});

test('neutrals carry a whisper of the brand hue, and the accent follows its harmony', () => {
  const brand = hexToOklch('#e8643c');
  const c = buildRoles({ seed: 4, style: 'quiet', accent: 'complementary', locked: { Primary: brand } });
  for (const r of ['Background', 'Surface', 'Text', 'Muted'] as const) {
    assert.ok(c[r][1] > 0 && c[r][1] <= 0.03, `${r} chroma ${c[r][1]}`);
    assert.ok(Math.abs(turn(c[r][2], brand[2])) < 1, `${r} keeps the brand hue in Quiet`);
  }
  assert.ok(Math.abs(Math.abs(turn(c.Accent[2], brand[2])) - 180) < 0.5, 'complementary');
  const analogous = buildRoles({ seed: 4, style: 'quiet', accent: 'analogous', locked: { Primary: brand } });
  assert.ok(Math.abs(Math.abs(turn(analogous.Accent[2], brand[2])) - 30) < 0.5, 'analogous');
  const none = buildRoles({ seed: 4, style: 'quiet', accent: 'none', locked: { Primary: brand } });
  assert.ok(Math.abs(turn(none.Accent[2], brand[2])) < 0.5, 'None keeps the brand hue');
  const warm = buildRoles({ seed: 4, style: 'warm', accent: 'analogous', locked: { Primary: hexToOklch('#1b6fd1') } });
  assert.ok(Math.abs(turn(warm.Background[2], 70)) < Math.abs(turn(hexToOklch('#1b6fd1')[2], 70)), 'Warm pulls the neutrals towards warm');
});

test('Surface is the Background lifted or lowered, and a near-white page lowers it', () => {
  for (let seed = 1; seed < 40; seed++) {
    const c = buildRoles({ seed, style: 'quiet', accent: 'analogous', locked: { Primary: hexToOklch('#3a7bd5') } });
    assert.ok(Math.abs(c.Surface[0] - c.Background[0]) >= 0.02, `seed ${seed}: card ${c.Surface[0]} on page ${c.Background[0]}`);
  }
});

test('a locked colour is never changed, and the rest is built round it', () => {
  const locked = { Primary: hexToOklch('#e8643c'), Background: hexToOklch('#fffdf6') };
  const a = buildRoles({ seed: 1, style: 'quiet', accent: 'triad', locked });
  const b = buildRoles({ seed: 2, style: 'quiet', accent: 'triad', locked });
  for (const c of [a, b]) {
    assert.deepEqual(c.Primary, locked.Primary);
    assert.deepEqual(c.Background, locked.Background);
    assertReads(c, 'locked');
  }
  assert.notDeepEqual(a.Accent, b.Accent, 'the unlocked colours move with the seed');
  // a dark locked Background makes a dark palette whatever the style says
  const dark = buildRoles({ seed: 1, style: 'quiet', accent: 'triad', locked: { Background: hexToOklch('#14161a') } });
  assert.equal(lightGround(dark), false);
  assertReads(dark, 'dark ground');
  // a locked Accent steers the hue the rest is built round (its harmony turn back)
  const fromAccent = buildRoles({ seed: 1, style: 'quiet', accent: 'complementary', locked: { Accent: hexToOklch('#2fb2a0') } });
  assert.ok(Math.abs(Math.abs(turn(fromAccent.Primary[2], hexToOklch('#2fb2a0')[2])) - 180) < 0.5);
});

test('Complete the palette: only the missing roles are new, the palette’s own colours are the locks', () => {
  const have = { Background: hexToOklch('#f7f5ef'), Text: hexToOklch('#1d1b18'), Primary: hexToOklch('#0f766e') };
  const { missing, colours } = completeRoles(have, { seed: 8, style: 'quiet', accent: 'analogous' });
  assert.deepEqual(missing, ['Surface', 'Muted', 'Accent', 'Highlight']);
  for (const [role, o] of Object.entries(have)) assert.deepEqual(colours[role as keyof typeof have], o);
  for (const g of ['Background', 'Surface'] as const) {
    assert.ok(on(colours, 'Muted', g) >= 4.5);
    assert.ok(on(colours, 'Accent', g) >= 4.5);
    assert.ok(on(colours, 'Highlight', g) >= 3);
  }
  assert.deepEqual(completeRoles(buildRoles({ seed: 1, style: 'quiet', accent: 'none' }), { seed: 2, style: 'bold', accent: 'triad' }).missing, []);
});

test('a built palette passes the Contrast tab: no role pair fails but possibly a user-given Primary', () => {
  for (let seed = 1; seed <= 60; seed++) {
    const c = buildRoles({ seed, style: STYLE_LIST[seed % STYLE_LIST.length].id, accent: TYPED[seed % TYPED.length], locked: { Primary: BRANDS[(seed * 7) % BRANDS.length] } });
    const failing = contrastPairs(swatches(c)).filter((p) => p.ratio < p.target && p.text.role !== 'Primary');
    assert.deepEqual(failing.map((p) => `${p.text.role} on ${p.ground.role} ${p.ratio.toFixed(2)}`), [], `seed ${seed}`);
  }
});
