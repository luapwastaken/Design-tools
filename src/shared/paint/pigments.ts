// The 14 generic paints (spec 2026-09-29 §5.4), with the traits that make them behave differently:
//   tint         tinting strength: how hard it pushes a mix (Phthalo bullies, earths are meek)
//   opacity      0 transparent glaze .. 1 opaque cover
//   granulation  0 smooth .. 1 grainy (texture on the canvas)
//   staining     0 lifts clean .. 1 stains (resists the smudge)
// The colour is the masstone straight from the tube (v1's tuned values). Titanium White's tint is
// its scattering power: it covers five or six times harder than a coloured paint, so 1:1 with
// Ultramarine is a mid blue and 16:1 with Cadmium Red a pale pink, as on a real palette.
import { hexToOklch, type Oklch } from '../color/index.ts';

export type Pigment = {
  id: string;
  name: string;
  oklch: Oklch;
  tint: number;
  opacity: number;
  granulation: number;
  staining: number;
};

/** A paint you add yourself, by colour and name. */
export type CustomPigment = Pigment & { custom: true };

const paint = (id: string, name: string, hex: string, tint: number, opacity: number, granulation: number, staining: number): Pigment => ({
  id,
  name,
  oklch: hexToOklch(hex),
  tint,
  opacity,
  granulation,
  staining,
});

export const PIGMENTS: Pigment[] = [
  paint('tiwhite', 'Titanium White', '#f4f4ef', 8.4, 1.0, 0.0, 0.05),
  paint('cadyellow', 'Cadmium Yellow', '#ffb000', 1.7, 0.92, 0.05, 0.15),
  paint('hansa', 'Hansa Yellow', '#f7d000', 1.9, 0.4, 0.0, 0.45),
  paint('yochre', 'Yellow Ochre', '#c08a25', 1.3, 0.82, 0.3, 0.25),
  paint('cadred', 'Cadmium Red', '#e02e1f', 1.8, 0.9, 0.05, 0.25),
  paint('alizarin', 'Alizarin Crimson', '#8a1c2b', 3.4, 0.2, 0.0, 0.85),
  paint('bsienna', 'Burnt Sienna', '#7c3a1d', 1.7, 0.55, 0.35, 0.4),
  paint('rumber', 'Raw Umber', '#4d3d2b', 1.4, 0.58, 0.28, 0.3),
  paint('ultra', 'Ultramarine Blue', '#26358c', 2.2, 0.3, 0.65, 0.25),
  paint('phthaloB', 'Phthalo Blue', '#0e3f63', 5.5, 0.25, 0.0, 0.92),
  paint('phthaloG', 'Phthalo Green', '#0c5a48', 5.0, 0.25, 0.0, 0.9),
  paint('viridian', 'Viridian', '#2f8163', 1.7, 0.35, 0.4, 0.25),
  paint('dioxazine', 'Dioxazine Purple', '#34215c', 3.4, 0.28, 0.05, 0.8),
  paint('lampblack', 'Lamp Black', '#1b1c20', 3.6, 0.66, 0.05, 0.5),
];

/** Your own paint, with middling traits: nothing says how it behaves. */
export const customPigment = (name: string, oklch: Oklch, id: string = crypto.randomUUID()): CustomPigment => ({
  id,
  name,
  oklch,
  tint: 1.5,
  opacity: 0.6,
  granulation: 0.1,
  staining: 0.4,
  custom: true,
});
