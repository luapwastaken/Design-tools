// What the Light zones tab shows, apart from how it is drawn: the zone words, the rows (one per ramp),
// the rig the palette's light and the view make, the names a zone is offered under, and the lit preview's
// picture (which zone each pixel of a ball on a ground belongs to). Pure, so it is unit tested.
import type { Oklch } from '../../../shared/color/index.ts';
import { holdValue } from '../../../shared/color/value.ts';
import { fitChroma, wrapHue } from '../../../shared/palette/space.ts';
import { DEFAULT_STRENGTHS, GROUND, RANGE, rigOf, zonesOf, type Rig, type Split, type ZoneId, type ZoneResult } from '../../../shared/palette/zones.ts';
import type { MaterialId } from '../../../shared/types.ts';
import { baseOf, rampName, type IllustrationDoc } from './doc.ts';
import { sceneLight } from './scene.ts';
import { direction, surface, type Light } from './shade.ts';

// ── the words ───────────────────────────────────────────────────────────────────────────────────

/** `src`: one line over the column, where the light comes from; `hint`: a sentence under the preview when the zone is pointed at */
export const ZONE_TEXT: Record<ZoneId, { name: string; src: string; hint: string }> = {
  highlight: { name: 'Highlight', src: 'key, glancing off', hint: 'The brightest glint, tinted by the key.' },
  light: { name: 'Light', src: 'key + fill', hint: 'Facing the key: the local colour.' },
  halftone: { name: 'Halftone', src: 'key + fill, turning', hint: 'Turning away from the key.' },
  core: { name: 'Core shadow', src: 'fill, partly blocked', hint: 'Where the light runs out.' },
  reflected: { name: 'Reflected light', src: 'fill + bounce', hint: 'Light off the ground into the shadow.' },
  cast: { name: 'Cast shadow', src: 'fill, blocked most', hint: 'On the ground, under the form.' },
  rim: { name: 'Rim', src: 'rim + fill', hint: 'A light edge on the shadow side.' },
};

/** the grid's column groups, left to right */
export const BANDS: { id: string; label: string; zones: ZoneId[] }[] = [
  { id: 'light', label: 'Light family', zones: ['highlight', 'light', 'halftone'] },
  { id: 'shadow', label: 'Shadow family', zones: ['core', 'reflected', 'cast'] },
  { id: 'edge', label: 'Lit edge', zones: ['rim'] },
];

/** "lights 0.50–0.82 · shadows 0.19–0.41 · gap 0.09" */
export const readout = (s: Split): string => `lights ${s.lit[0].toFixed(2)}–${s.lit[1].toFixed(2)} · shadows ${s.shadow[0].toFixed(2)}–${s.shadow[1].toFixed(2)} · gap ${s.gap.toFixed(2)}`;

/** the name a zone's colour is offered under: "Skin core shadow" */
export const zoneName = (ramp: string, zone: ZoneId): string => `${ramp} ${ZONE_TEXT[zone].name.toLowerCase()}`;

// ── the view state (Light zones' own part of it) ────────────────────────────────────────────────

/** [min, max] of each strength, in the order key, fill, bounce, rim */
export const STRENGTH_RANGES = [RANGE.key, RANGE.fill, RANGE.bounce, RANGE.rim] as const;
export const STRENGTH_NAMES = ['key', 'fill', 'bounce', 'rim'] as const;

const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

/** the four strengths as saved: each a finite number pulled into its range; anything else is the defaults */
export function cleanStrengths(raw: unknown): number[] {
  if (!Array.isArray(raw) || raw.length !== 4) return [...DEFAULT_STRENGTHS];
  return raw.map((v, i) => (isNum(v) ? Math.min(STRENGTH_RANGES[i][1], Math.max(STRENGTH_RANGES[i][0], v)) : DEFAULT_STRENGTHS[i]));
}

/** a colour as saved: three finite numbers made into one sRGB can show; anything else is `fallback` */
export function cleanColour<T extends Oklch | null>(raw: unknown, fallback: T): Oklch | T {
  if (!Array.isArray(raw) || raw.length !== 3 || !raw.every(isNum)) return fallback;
  return fitChroma([Math.min(1, Math.max(0, raw[0])), Math.min(0.5, Math.max(0, raw[1])), wrapHue(raw[2])]);
}

export const DEFAULT_GROUND: Oklch = [...GROUND];

/** the four lights as the palette and the view make them: the key and fill are the palette's light and shadow */
export function zoneRig(d: IllustrationDoc, v: { zoneStrengths: number[]; zoneRim: Oklch | null; zoneGround: Oklch }, selectedRamp?: string): Rig {
  return rigOf(sceneLight(d, selectedRamp).pair, v.zoneStrengths, { rim: v.zoneRim, ground: v.zoneGround });
}

// ── the rows ────────────────────────────────────────────────────────────────────────────────────

export type ZoneRow = { id: string; name: string; base: Oklch; material: MaterialId; result: ZoneResult };

/** one row per ramp, using the ramp's base and its material */
export const zoneRows = (d: IllustrationDoc, rig: Rig): ZoneRow[] =>
  d.ramps.map((r) => {
    const base = baseOf(d, r.id)?.oklch ?? r.base;
    return { id: r.id, name: rampName(d, r), base, material: r.material, result: zonesOf(base, r.material, rig) };
  });

// ── the lit preview ─────────────────────────────────────────────────────────────────────────────

/** the preview's size in pixels; the ball's normals are read at twice that, so its bands and edges are smooth */
export const PREVIEW = 280;
const SOURCE = PREVIEW * 2;
/** pixel values: 0 is the backdrop, 1 to 7 the zones in order, 8 the lit ground */
export const GROUND_ID = 8;
export const ZONE_ID: Record<ZoneId, number> = { highlight: 1, light: 2, halftone: 3, core: 4, reflected: 5, cast: 6, rim: 7 };
/** where the ground begins, in picture units (y up); the ball stands on it, its foot below */
const HORIZON = -0.3;
const FOOT_Y = -0.66;

export type ZoneMap = {
  /** the top-left sample of each pixel, and the four samples of each */
  px: Uint8Array;
  ss: Uint8Array;
  rings: Map<number, number[]>;
};
const maps = new Map<string, ZoneMap>();
const MAX_MAPS = 8;

/**
 * Which zone each pixel is, for the ball Light & preview draws (`surface('sphere')`) under the same sun.
 * The key's direction sorts the ball's normals: facing it is Light, turning away Halftone, past the
 * terminator Core; a glint where the normal meets the half vector (tighter for a sharper material);
 * Reflected on the underside away from the key; Rim on the limb opposite the key. The cast shadow is an
 * ellipse on the ground on the side away from the sun.
 */
export function zoneMap(light: Light, sharp: number): ZoneMap {
  const key = `${light.azimuth}|${light.elevation}|${sharp}`;
  const kept = maps.get(key);
  if (kept) return kept;
  const sf = surface('sphere', SOURCE);
  const kd = direction(light);
  const half = unit([kd[0], kd[1], kd[2] + 1]);
  const thr = 1 - 0.04 / sharp ** 0.8;
  // the limb opposite the key, in the picture's plane
  const rim2 = unit2(-kd[0], kd[1] * 0.3 + 0.2);
  const cast = { x: Math.max(-0.9, Math.min(0.9, -kd[0] * 0.9)), rx: 0.4 + 0.35 * Math.abs(kd[0]), ry: 0.1 };
  const background = (x: number, y: number) => {
    if (y >= HORIZON) return 0;
    return ((x - cast.x) / cast.rx) ** 2 + ((y - FOOT_Y) / cast.ry) ** 2 <= 1 ? ZONE_ID.cast : GROUND_ID;
  };
  const sphere = (q: number) => {
    const [nx, ny, nz] = [sf.normal[q * 3], sf.normal[q * 3 + 1], sf.normal[q * 3 + 2]];
    const c = nx * kd[0] + ny * kd[1] + nz * kd[2];
    if (nx * half[0] + ny * half[1] + nz * half[2] > thr) return ZONE_ID.highlight;
    if (c < 0.22 && nz < 0.6 && nx * rim2[0] + ny * rim2[1] > 0.5) return ZONE_ID.rim;
    if (c < 0 && ny < -0.35) return ZONE_ID.reflected;
    if (c >= 0.62) return ZONE_ID.light;
    if (c >= 0.14) return ZONE_ID.halftone;
    return ZONE_ID.core;
  };
  const px = new Uint8Array(PREVIEW * PREVIEW);
  const ss = new Uint8Array(PREVIEW * PREVIEW * 4);
  for (let j = 0; j < PREVIEW; j++) {
    for (let i = 0; i < PREVIEW; i++) {
      const p = j * PREVIEW + i;
      for (let b = 0; b < 2; b++) {
        for (let a = 0; a < 2; a++) {
          const [sx, sy] = [2 * i + a, 2 * j + b];
          const q = sy * SOURCE + sx;
          // the shape covers half the sample or more: it is the ball's
          ss[p * 4 + b * 2 + a] = sf.cover[q] >= 0.5 ? sphere(q) : background(((sx + 0.5) / SOURCE) * 2 - 1, 1 - ((sy + 0.5) / SOURCE) * 2);
        }
      }
      px[p] = ss[p * 4];
    }
  }
  if (maps.size >= MAX_MAPS) maps.delete(maps.keys().next().value!);
  const m: ZoneMap = { px, ss, rings: new Map() };
  maps.set(key, m);
  return m;
}

const unit = (v: number[]): number[] => {
  const l = Math.hypot(...v) || 1;
  return v.map((x) => x / l);
};
const unit2 = (x: number, y: number): [number, number] => {
  const l = Math.hypot(x, y) || 1;
  return [x / l, y / l];
};

/** the pixels on the edge of a zone's region, as x, y pairs: where its ring is drawn */
export function ringOf(m: ZoneMap, id: number): number[] {
  const kept = m.rings.get(id);
  if (kept) return kept;
  const out: number[] = [];
  for (let y = 1; y < PREVIEW - 1; y++) {
    for (let x = 1; x < PREVIEW - 1; x++) {
      const i = y * PREVIEW + x;
      if (m.px[i] === id && (m.px[i - 1] !== id || m.px[i + 1] !== id || m.px[i - PREVIEW] !== id || m.px[i + PREVIEW] !== id)) out.push(x, y);
    }
  }
  m.rings.set(id, out);
  return out;
}

/** the neutral the ball and its ground sit on: a warm grey at value 0.35, the same in both themes */
export const BACKDROP: Oklch = holdValue(0.35, 0.012, 70);

/**
 * The picture's pixels: each pixel the mean of its four samples, each sample the colour of its zone.
 * `colours` is indexed by pixel value (0 the backdrop, 1 to 7 the zones in order, 8 the ground) as 0 to 255 triples.
 */
export function renderZones(out: Uint8ClampedArray, m: ZoneMap, colours: readonly (readonly number[])[]): void {
  for (let p = 0; p < PREVIEW * PREVIEW; p++) {
    let [r, g, b] = [0, 0, 0];
    for (let s = 0; s < 4; s++) {
      const c = colours[m.ss[p * 4 + s]];
      r += c[0];
      g += c[1];
      b += c[2];
    }
    out[p * 4] = r / 4;
    out[p * 4 + 1] = g / 4;
    out[p * 4 + 2] = b / 4;
    out[p * 4 + 3] = 255;
  }
}

/** a ring round a zone: a dark outline under a light line, drawn into the pixels so it reads on any colour */
export function drawRing(out: Uint8ClampedArray, ring: readonly number[]): void {
  const dot = (x: number, y: number, r: number, v: number) => {
    for (let dy = -r; dy <= r; dy++) {
      for (let dx = -r; dx <= r; dx++) {
        const p = ((y + dy) * PREVIEW + x + dx) * 4;
        if (p >= 0 && p < out.length) out[p] = out[p + 1] = out[p + 2] = v;
      }
    }
  };
  for (let k = 0; k < ring.length; k += 2) dot(ring[k], ring[k + 1], 2, 0);
  for (let k = 0; k < ring.length; k += 2) dot(ring[k], ring[k + 1], 1, 255);
}
