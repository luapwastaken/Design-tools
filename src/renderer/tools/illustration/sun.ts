// Where the sun is drawn and how it moves (the Light & preview tab). The ring is a circle, the
// object at its centre: the sun sits where the light is in the picture, so its distance from the
// centre grows with cos(height), the rim being light from the side. Light from the viewer is drawn
// at the object's edge (not over its middle), and light from behind at the same place as the same
// light in front, as a hollow sun. Pure.
import type { Light } from './shade.ts';

const RAD = Math.PI / 180;

/** the classic set-ups, as one click: Height 0 lights from the side, 90 from the viewer, below 0 from behind */
export const PRESETS: { id: string; label: string; tip: string; light: Light }[] = [
  { id: 'upper-left', label: 'Upper left', tip: 'The classic: from the upper left, a little toward you', light: { azimuth: 320, elevation: 35 } },
  { id: 'top', label: 'Top', tip: 'From straight above', light: { azimuth: 0, elevation: 35 } },
  { id: 'side', label: 'Side', tip: 'Raking light from the left, long shadows', light: { azimuth: 270, elevation: 12 } },
  { id: 'rim', label: 'Rim', tip: 'From behind and to the left: an edge of light round the object', light: { azimuth: 300, elevation: -30 } },
  { id: 'back', label: 'Back', tip: 'From behind: thin things glow, solid things go dark', light: { azimuth: 0, elevation: -70 } },
  { id: 'front', label: 'Front', tip: 'From where you stand: flat, little shadow', light: { azimuth: 0, elevation: 90 } },
];

/** the preset this light is, if it is one */
export const presetOf = (l: Light): string | null => PRESETS.find((p) => p.light.azimuth === ((l.azimuth % 360) + 360) % 360 && p.light.elevation === l.elevation)?.id ?? null;

/** How far from the centre, in rings, the sun is drawn when the light is from the viewer or from straight behind: just outside the object, not over its middle */
const HEAD = 0.7;
/** the drawn distance for a true distance (cos of the height): the whole height range is squeezed into the band between the object's edge and the ring */
const drawnR = (r: number) => HEAD + (1 - HEAD) * r;

/**
 * Where the sun is drawn, on the unit circle (x right, y up): in the light's direction as seen
 * from the front, the rim being light from the side. Light from the viewer or from behind is out
 * at the object's edge, not over its middle (the height only moves it between there and the ring).
 */
export function sunAt({ azimuth, elevation }: Light): { x: number; y: number } {
  const r = drawnR(Math.cos(elevation * RAD));
  return { x: r * Math.sin(azimuth * RAD), y: r * Math.cos(azimuth * RAD) };
}

/**
 * The light for a pointer at (x, y) on the unit circle (y up), on the front or the behind side of
 * the object (what `sunAt` draws, the other way round). Inside the object's edge is light from
 * the viewer; the azimuth stays where it was when the pointer is at the centre. Beyond the rim it
 * is on the rim, and from behind never quite 0 (that would read as in front).
 */
export function lightAt(x: number, y: number, behind: boolean, was: Light): Light {
  const r = Math.min(1, Math.max(0, (Math.hypot(x, y) - HEAD) / (1 - HEAD)));
  const azimuth = Math.hypot(x, y) < 0.02 ? was.azimuth : Math.round((Math.atan2(x, y) / RAD + 360) % 360);
  const e = Math.round(Math.acos(r) / RAD);
  return { azimuth: azimuth % 360, elevation: behind ? -Math.max(e, 1) : e };
}

export type Arrow = 'left' | 'right' | 'up' | 'down';
const SCREEN: Record<Arrow, [number, number]> = { left: [-1, 0], right: [1, 0], up: [0, 1], down: [0, -1] };
const AROUND: Record<Arrow, number> = { up: 0, right: 90, down: 180, left: 270 };

/**
 * The light with the sun moved `k` degrees on the screen the way the arrow points: along the ring
 * (the direction), or toward and away from the centre (the height), whichever the arrow is nearer
 * to where the sun is; at the centre it goes the way the arrow points. The sun stays on its side
 * of the object.
 */
export function nudge(l: Light, arrow: Arrow, k = 1): Light {
  const wrap = (a: number) => ((Math.round(a) % 360) + 360) % 360;
  const { azimuth: a, elevation: e } = l;
  if (Math.abs(e) >= 89) return { azimuth: AROUND[arrow], elevation: Math.sign(e || 1) * (90 - k) };
  const [dx, dy] = SCREEN[arrow];
  const [sa, ca] = [Math.sin(a * RAD), Math.cos(a * RAD)];
  // the arrow along the ring (clockwise is positive) and out from the centre
  const along = dx * ca - dy * sa;
  const out = dx * sa + dy * ca;
  const side = e < 0 ? -1 : 1;
  const height = Math.round(Math.max(0, Math.min(90, Math.abs(e) - out * k)));
  // a whole degree or more round the ring whenever the arrow has any of that direction in it
  const turn = Math.abs(along) < 0.2 ? 0 : Math.sign(along) * Math.max(1, Math.round((Math.abs(along) * k) / Math.max(0.25, Math.cos(e * RAD))));
  return { azimuth: wrap(a + turn), elevation: height === 0 ? 0 : side * height };
}

const SECTORS = ['above', 'the upper right', 'the right', 'the lower right', 'below', 'the lower left', 'the left', 'the upper left'];

/** where the light is, in words: "from the upper left", "raking from the left", "from behind and the right", "straight on" */
export function lightWords({ azimuth, elevation }: Light): string {
  const side = SECTORS[Math.round((((azimuth % 360) + 360) % 360) / 45) % 8];
  if (elevation >= 75) return 'straight on, from where you stand';
  if (elevation <= -75) return 'from straight behind';
  if (elevation < -10) return `from behind and ${side}`;
  if (elevation <= 10) return `raking from ${side}`;
  return `from ${side}`;
}
