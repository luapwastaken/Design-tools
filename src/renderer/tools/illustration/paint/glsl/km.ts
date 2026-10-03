// Kubelka-Munk in GLSL at km15's groups, its constants written from km15.ts: the same maths as the
// float64 references there, which the tests and the smoke checks hold these to.
// A spectrum is a Spec: four vec4s, the 16th lane padding with no weight, and every function over it
// is written out lane by lane. The same maths over float[15] arrays took the D3D compiler three times
// as long to build (and twice that again, as a loop over lanes), and every pass that mixes paint is
// built at startup.
import { EPS, FIT } from '../../../../../shared/paint/km.ts';
import { BASIS15, N15, W15, type Basis } from '../../../../../shared/paint/km15.ts';

/** a float literal GLSL accepts */
export const glslFloat = (v: number): string => {
  const s = v.toPrecision(9);
  return /[.e]/.test(s) ? s : `${s}.0`;
};
const LANES = [0, 1, 2, 3];
/** `f` for each lane, joined */
const each = (f: (j: number) => string, sep = ' ') => LANES.map(f).join(sep);

/** a group's constants as four zero-padded vec4s; the film holds K in the first 15 of 16 lanes and S in the last */
const lanes = (name: string, a: ArrayLike<number>) => {
  if (N15 > 15) throw new Error('km.ts has more than 15 band groups: the film has no room for them.');
  const v = Array.from({ length: 16 }, (_, i) => (i < N15 ? a[i] : 0));
  return each((j) => `const vec4 ${name}_${j} = vec4(${v.slice(j * 4, j * 4 + 4).map(glslFloat).join(', ')});`, '\n');
};
const basis = (k: Basis) => lanes(`B_${k.toUpperCase()}`, BASIS15[k]);
/** a colour channel's observer weights dotted with a Spec */
const dots = (w: string, s: string) => each((j) => `dot(${w}_${j}, ${s}.v${j})`, ' + ');
const dotsOf = (s: string) => `vec3(${dots('W_R', s)}, ${dots('W_G', s)}, ${dots('W_B', s)})`;
/** Smits' decomposition of one lane: the colour is m of white plus two of the six, picked by which channel is least */
const smitsLane = (j: number) => `{
    vec4 v = m * B_WHITE_${j};
    if (c.r == m) v += (min(c.g, c.b) - c.r) * B_CYAN_${j} + abs(c.b - c.g) * (c.g <= c.b ? B_BLUE_${j} : B_GREEN_${j});
    else if (c.g == m) v += (min(c.r, c.b) - c.g) * B_MAGENTA_${j} + abs(c.b - c.r) * (c.r <= c.b ? B_BLUE_${j} : B_RED_${j});
    else v += (min(c.r, c.g) - c.b) * B_YELLOW_${j} + abs(c.g - c.r) * (c.r <= c.g ? B_GREEN_${j} : B_RED_${j});
    R.v${j} = clamp(v, ${glslFloat(EPS)}, ${glslFloat(1 - EPS)});
  }`;

export const KM = `
${lanes('W_R', W15[0])}
${lanes('W_G', W15[1])}
${lanes('W_B', W15[2])}
${(['white', 'red', 'green', 'blue', 'yellow', 'cyan', 'magenta'] as const).map(basis).join('\n')}
struct Spec { vec4 v0, v1, v2, v3; };
// K as the film holds it: four texels, K of 15 groups in their first 15 lanes (the last is S)
Spec specOf(vec4 a, vec4 b, vec4 c, vec4 d) { return Spec(a, b, c, vec4(d.xyz, 0.0)); }
Spec mixSpec(Spec a, Spec b, float t) { return Spec(${each((j) => `mix(a.v${j}, b.v${j}, t)`, ', ')}); }
vec3 integrate(Spec R) { return ${dotsOf('R')}; }
Spec smits(vec3 c) {
  Spec R;
  float m = min(c.r, min(c.g, c.b));
  ${each(smitsLane, '\n  ')}
  return R;
}
// km.ts reflectance(): Smits' decomposition, then rounds aiming off by the miss
Spec reflectance(vec3 want) {
  vec3 aim = want;
  Spec R;
  for (int k = 0; k < ${FIT}; k++) { R = smits(aim); aim += want - integrate(R); }
  return smits(aim);
}
// the paint (K, at strength s) that has this reflectance as its colour at full cover
Spec paintOf(Spec R, float s) { return Spec(${each((j) => `(1.0 - R.v${j}) * (1.0 - R.v${j}) / (2.0 * R.v${j}) * s`, ', ')}); }
// the reflectance at full cover of K and S; R-infinity in the form that doesn't cancel for dark paints
// (Phthalo reaches K/S 5000)
Spec colourOf(Spec K, float S) {
  ${each((j) => `vec4 q${j} = max(K.v${j}, 0.0) / S;`, '\n  ')}
  return Spec(${each((j) => `1.0 / (1.0 + q${j} + sqrt(q${j} * q${j} + 2.0 * q${j}))`, ', ')});
}
// a layer (K, S) x thick over a backing Rg: Kubelka's hyperbolic solution with e^-2y, which stays
// finite where sinh overflows even in float64; also how much the result moves with the backing
// (dR/dRg): 1 for no layer, 0 for an opaque one
void layerOver2(vec4 K, float S, float x, vec4 Rg, out vec4 R, out vec4 dR) {
  vec4 q = max(K / S, 1e-6);
  vec4 a = 1.0 + q;
  vec4 b = sqrt(q * (q + 2.0));
  vec4 y = b * S * x;
  vec4 e1 = exp(-y);
  vec4 e2 = e1 * e1;
  vec4 sh = mix(1.0 - e2, 2.0 * y * (1.0 - y), lessThan(y, vec4(1e-3)));
  vec4 den = a * sh + b * (1.0 + e2);
  vec4 T = 2.0 * b * e1 / den;
  vec4 r = sh / den;
  vec4 d = 1.0 - r * Rg;
  R = r + T * T * Rg / d;
  dR = T * T / (d * d);
}
// A layer over the painting's colour: the backing's spectrum is only km.ts's fit of that colour,
// so what the fit misses is added back as much as the backing still shows through. No layer gives
// the colour back; an opaque one, the paint alone.
vec3 layerOnColour(vec3 base, Spec under, Spec K, float S, float x) {
  Spec R, dR;
  ${each((j) => `layerOver2(max(K.v${j}, 0.0), S, x, under.v${j}, R.v${j}, dR.v${j});`, '\n  ')}
  return ${dotsOf('R')} + ${dotsOf('dR')} * (base - integrate(under));
}
`;
